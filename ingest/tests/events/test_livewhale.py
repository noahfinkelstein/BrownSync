"""LiveWhale snapshot normalization: poller parity is the contract.

The parity pins in :class:`TestPollerSourceIdParity` were derived from the
app lane's recorded poller fixture
(``services/poller/fixtures/livewhale-events.json``, captured 2026-07-28,
1000 rows, read read-only on ``main``): for each sampled row the expected
value is the poller's own ``${id}:${date_ts}`` — ``date_ts`` verified to
equal the epoch of ``date_iso`` on ALL 1000 fixture rows, and 982/1000
rows of this CSV overlap the fixture on ``(id, epoch)``. If any pin
breaks, the bootstrap seeds would FORK from the poller's upserts instead
of converging on ``(source, source_id)`` — do not "fix" the expectation
without re-deriving it from the poller.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path

import pytest

from brownsync_ingest.events.csv_source import load_upcoming_events_csv
from brownsync_ingest.events.livewhale import (
    UpcomingEventError,
    load_org_livewhale_groups,
    normalize_upcoming_event,
    source_id_for,
)
from brownsync_ingest.events.models import UpcomingEventRecord
from brownsync_ingest.gazetteer.resolver import Resolution


INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_UPCOMING = (
    INGEST_ROOT / "fixtures" / "user_provided" / "brown_upcoming_events.csv"
)

# (csv event_id, csv start_date_iso) -> the poller's id:date_ts, hardcoded
# from the recorded poller fixture. Sample deliberately covers: a
# duplicate-id repeat series, entity-encoded organizer and title rows,
# online-only, hybrid, all-day, an end-dated exhibit, both cost shapes,
# and a location-less admin row.
POLLER_PARITY_PINS: tuple[tuple[str, str, str], ...] = (
    ("329077", "2026-07-29T00:00:00-04:00", "329077:1785297600"),
    ("334336", "2026-07-29T10:00:00-04:00", "334336:1785333600"),
    ("334225", "2026-07-29T16:00:00-04:00", "334225:1785355200"),
    ("334202", "2026-07-29T12:00:00-04:00", "334202:1785340800"),
    ("323876", "2026-07-31T10:00:00-04:00", "323876:1785506400"),
    ("334851", "2026-07-29T00:00:00-04:00", "334851:1785297600"),
    ("330831", "2026-07-29T09:00:00-04:00", "330831:1785330000"),
    ("334219", "2026-08-21T10:00:00-04:00", "334219:1787320800"),
    ("326614", "2026-07-29T10:00:00-04:00", "326614:1785333600"),
    ("325404", "2026-07-29T00:00:00-04:00", "325404:1785297600"),
)


def record(**overrides: str) -> UpcomingEventRecord:
    values: dict[str, str] = dict(
        event_id="334851",
        title="Workshop",
        start_date_iso="2026-07-29T00:00:00-04:00",
        end_date_iso="",
        all_day="false",
        canceled="false",
        online="false",
        online_type="",
        location="",
        latitude="",
        longitude="",
        cost="",
        organizer="Carney Institute for Brain Science",
        event_types="",
        tags="",
        source_url="https://events.brown.edu/live/events/334851",
    )
    fields = set(values)
    raw_extras = {
        key: value for key, value in overrides.items() if key not in fields
    }
    values.update(
        (key, value) for key, value in overrides.items() if key in fields
    )
    raw = dict(values)
    raw.setdefault("contact", "")
    raw.setdefault("contact_emails", "")
    raw.update(raw_extras)  # columns the record does not surface (repeats, …)
    return UpcomingEventRecord(**values, raw=raw)


@dataclass
class FakeResolver:
    """Scripted resolver; records every query it was asked."""

    outcomes: dict[str, Resolution] = field(default_factory=dict)
    queries: list[str] = field(default_factory=list)

    def resolve(self, value: str) -> Resolution:
        self.queries.append(value)
        return self.outcomes.get(
            value,
            Resolution(
                query=value,
                place_id=None,
                room=None,
                method="unresolved",
                reason="below-threshold",
                score=0.0,
                candidates=(),
            ),
        )


def resolved(place_id: str, query: str) -> Resolution:
    return Resolution(
        query=query,
        place_id=place_id,
        room=None,
        method="trigram",
        reason=None,
        score=0.8,
        candidates=(),
    )


def normalize(record_, *, org_by_group=None, resolver=None):
    return normalize_upcoming_event(
        record_,
        org_by_group=org_by_group or {},
        resolver=resolver or FakeResolver(),
    )


class TestPollerSourceIdParity:
    @pytest.mark.parametrize(
        ("event_id", "start_iso", "expected"), POLLER_PARITY_PINS
    )
    def test_source_id_for_matches_the_poller_derivation(
        self, event_id: str, start_iso: str, expected: str
    ) -> None:
        assert source_id_for(event_id, start_iso) == expected

    def test_the_pinned_rows_exist_in_the_export_and_normalize_to_the_pins(
        self,
    ) -> None:
        records = {
            (item.event_id, item.start_date_iso): item
            for item in load_upcoming_events_csv(REAL_UPCOMING)
        }
        for event_id, start_iso, expected in POLLER_PARITY_PINS:
            item = records[(event_id, start_iso)]
            decision = normalize(item)
            assert decision.row.source_id == expected
            assert decision.row.source == "livewhale"

    def test_naive_start_fails_instead_of_machine_dependent_epochs(
        self,
    ) -> None:
        with pytest.raises(UpcomingEventError, match="no UTC offset"):
            source_id_for("1", "2026-07-29T00:00:00")

    def test_unparseable_start_fails_loudly(self) -> None:
        with pytest.raises(UpcomingEventError, match="unparseable"):
            source_id_for("1", "July 29")


class TestCoordinates:
    def test_coords_carry_through(self) -> None:
        decision = normalize(
            record(latitude="41.828299", longitude="-71.401003")
        )
        assert decision.row.lat == pytest.approx(41.828299)
        assert decision.row.lng == pytest.approx(-71.401003)

    def test_zero_is_the_null_island_sentinel(self) -> None:
        decision = normalize(record(latitude="0", longitude="-71.4"))
        assert decision.row.lat is None
        assert decision.row.lng is None

    def test_one_missing_side_nulls_both(self) -> None:
        decision = normalize(record(latitude="41.8", longitude=""))
        assert decision.row.lat is None
        assert decision.row.lng is None

    def test_unparseable_and_out_of_range_null_like_the_poller(self) -> None:
        assert normalize(record(latitude="north", longitude="-71.4")).row.lat is None
        assert normalize(record(latitude="97.0", longitude="-71.4")).row.lat is None


class TestTextParity:
    def test_title_is_entity_decoded_and_trimmed(self) -> None:
        decision = normalize(
            record(title=" Study Abroad in Australia &amp; New Zealand ")
        )
        assert decision.row.title == "Study Abroad in Australia & New Zealand"

    def test_empty_title_fails_loudly(self) -> None:
        with pytest.raises(UpcomingEventError, match="empty title"):
            normalize(record(title="  "))

    def test_location_raw_is_decoded_trimmed_or_none(self) -> None:
        assert (
            normalize(record(location="Barus &amp; Holley")).row.location_raw
            == "Barus & Holley"
        )
        assert normalize(record(location="  ")).row.location_raw is None

    def test_tags_are_split_decoded_and_empties_dropped(self) -> None:
        decision = normalize(
            record(tags="Biology, Medicine, Public Health | CCBS |  ")
        )
        assert decision.row.tags == [
            "Biology, Medicine, Public Health",
            "CCBS",
        ]

    def test_rrule_stays_null_repeats_is_prose(self) -> None:
        decision = normalize(
            record(repeats="every weekday (Monday to Friday)")
        )
        assert decision.row.rrule is None


class TestFlagsAndScalars:
    def test_all_day_and_canceled_flags(self) -> None:
        decision = normalize(record(all_day="true", canceled="true"))
        assert decision.row.is_all_day is True
        assert decision.row.is_canceled is True

    def test_non_boolean_flag_fails_loudly(self) -> None:
        with pytest.raises(UpcomingEventError, match="all_day"):
            normalize(record(all_day="yes"))

    def test_end_ts_optional(self) -> None:
        decision = normalize(
            record(end_date_iso="2026-07-29T17:00:00-04:00")
        )
        assert decision.row.end_ts is not None
        assert normalize(record()).row.end_ts is None

    def test_cost_and_url_blank_to_none(self) -> None:
        decision = normalize(record(cost="Free"))
        assert decision.row.cost == "Free"
        assert normalize(record(cost=" ")).row.cost is None
        assert normalize(record()).row.url == (
            "https://events.brown.edu/live/events/334851"
        )

    def test_description_is_none_the_csv_has_no_column(self) -> None:
        assert normalize(record()).row.description is None

    def test_confidence_is_structured_feed(self) -> None:
        assert normalize(record()).row.confidence == 1.0


class TestCategoryAndOrg:
    def test_category_from_event_types(self) -> None:
        decision = normalize(
            record(event_types="Free Food |  Open to the Public")
        )
        assert decision.row.category == "food"

    def test_group_fallback_via_organizer(self) -> None:
        assert normalize(record(organizer="Athletics")).row.category == (
            "athletics"
        )

    def test_unknown_event_types_are_reported_not_fatal(self) -> None:
        decision = normalize(record(event_types="Brand New Type"))
        assert decision.unknown_event_types == ("Brand New Type",)
        assert decision.row.category == "academic"  # poller fall-through

    def test_org_attribution_uses_the_normalized_group_key(self) -> None:
        decision = normalize(
            record(organizer="Alumni &amp; Friends"),
            org_by_group={"alumni & friends": "alumni-friends"},
        )
        assert decision.row.org_id == "alumni-friends"
        assert decision.org_attributed is True

    def test_unlinked_group_leaves_org_null(self) -> None:
        decision = normalize(record(), org_by_group={"other": "x"})
        assert decision.row.org_id is None
        assert decision.org_attributed is False


class TestPlaceResolution:
    def test_resolves_only_when_coords_are_absent(self) -> None:
        resolver = FakeResolver(
            outcomes={"Sayles Hall": resolved("sayles-hall", "Sayles Hall")}
        )
        decision = normalize(
            record(location="Sayles Hall"), resolver=resolver
        )
        assert decision.row.place_id == "sayles-hall"
        assert decision.resolution is not None
        assert resolver.queries == ["Sayles Hall"]

    def test_coords_present_skips_the_resolver(self) -> None:
        resolver = FakeResolver()
        decision = normalize(
            record(
                location="Sayles Hall",
                latitude="41.826",
                longitude="-71.403",
            ),
            resolver=resolver,
        )
        assert decision.row.place_id is None
        assert resolver.queries == []

    def test_online_only_events_are_never_resolved(self) -> None:
        resolver = FakeResolver()
        decision = normalize(
            record(
                online="true",
                online_type="Online only",
                location="Zoom (registration required)",
            ),
            resolver=resolver,
        )
        assert decision.row.place_id is None
        assert decision.row.location_raw == "Zoom (registration required)"
        assert resolver.queries == []

    def test_hybrid_events_without_coords_are_resolved(self) -> None:
        resolver = FakeResolver()
        decision = normalize(
            record(online="true", online_type="Hybrid", location="Sayles"),
            resolver=resolver,
        )
        assert resolver.queries == ["Sayles"]
        assert decision.unknown_online_type is None

    def test_unknown_online_type_is_reported_and_not_resolved(self) -> None:
        resolver = FakeResolver()
        decision = normalize(
            record(online="true", online_type="Metaverse", location="Sayles"),
            resolver=resolver,
        )
        assert decision.unknown_online_type == "Metaverse"
        assert resolver.queries == []

    def test_unresolved_location_keeps_raw_and_null_place(self) -> None:
        decision = normalize(record(location="TBD Room"))
        assert decision.row.place_id is None
        assert decision.row.location_raw == "TBD Room"
        assert decision.resolution is not None
        assert decision.resolution.reason == "below-threshold"


class TestRawPayload:
    def test_raw_retains_the_row_minus_published_contact_columns(self) -> None:
        item = record()
        item.raw["contact"] = "someone@brown.edu"
        item.raw["contact_emails"] = "someone@brown.edu"
        decision = normalize(item)
        assert isinstance(decision.row.raw, dict)
        assert "contact" not in decision.row.raw
        assert "contact_emails" not in decision.row.raw
        assert decision.row.raw["event_id"] == "334851"
        assert decision.dropped_contact_columns == (
            "contact",
            "contact_emails",
        )

    def test_blank_contact_columns_are_not_counted_as_drops(self) -> None:
        assert normalize(record()).dropped_contact_columns == ()


class TestOrgSidecarLoading:
    def test_missing_file_is_an_empty_map_like_the_poller(
        self, tmp_path: Path
    ) -> None:
        assert load_org_livewhale_groups(tmp_path / "absent.json") == {}

    def test_higher_score_wins_a_contested_group(self, tmp_path: Path) -> None:
        path = tmp_path / "sidecar.json"
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_at": "2026-07-29T00:00:00Z",
                    "mappings": [
                        {
                            "organization_id": "org-a",
                            "livewhale_group": "Chess Club",
                            "match_method": "fuzzy",
                            "score": 92,
                        },
                        {
                            "organization_id": "org-b",
                            "livewhale_group": "Chess &amp; Club",
                            "match_method": "exact",
                            "score": 100,
                        },
                        {
                            "organization_id": "org-c",
                            "livewhale_group": "chess club",
                            "match_method": "fuzzy",
                            "score": 95,
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )
        lookup = load_org_livewhale_groups(path)
        assert lookup["chess club"] == "org-c"  # 95 beats 92
        assert lookup["chess & club"] == "org-b"  # keys entity-decoded

    def test_malformed_sidecar_fails_loudly(self, tmp_path: Path) -> None:
        path = tmp_path / "sidecar.json"
        path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
        with pytest.raises(UpcomingEventError, match="schema v1"):
            load_org_livewhale_groups(path)
        path.write_text(
            json.dumps({"schema_version": 1, "mappings": [{"nope": 1}]}),
            encoding="utf-8",
        )
        with pytest.raises(UpcomingEventError, match="malformed mapping"):
            load_org_livewhale_groups(path)

    def test_the_published_task7_sidecar_loads_and_is_empty(self) -> None:
        # measured truth of the task-7 linkage: no student group is a
        # LiveWhale publisher, so attribution is honestly zero
        repo_root = INGEST_ROOT.parent
        sidecar = repo_root / "db" / "seeds" / "organization_livewhale_groups.json"
        assert load_org_livewhale_groups(sidecar) == {}
