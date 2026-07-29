"""Task 8: athletics venue mapping from the recorded SIDEARM composite ICS.

The recorded feed proves the classification problem is subtler than a city
prefix: "Chapey Field at Anderson Stadium" carries the ``Providence, R.I.``
prefix but is Providence College's soccer stadium (the feed shows only
``... at Providence`` games there). Home-venue observation therefore requires
all three signals — Providence city prefix, a venue segment, and a SIDEARM
home-game summary ("vs", not "at") — plus an explicit non-Brown-venue
blocklist so a hypothetical PC-hosted neutral "vs" game can never leak in.
Every excluded location carries a machine-readable reason; nothing is
silently dropped.
"""
from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path

import pytest

from brownsync_ingest import athletics_venues as av
from brownsync_ingest.gazetteer.aliases import load_curated_catalog
from brownsync_ingest.gazetteer.catalog import build_catalog_from_files


FIXTURES_ROOT = Path(__file__).resolve().parents[1] / "fixtures"
RECORDED_ICS = FIXTURES_ROOT / "recorded" / "athletics" / "calendar.ics"

OBSERVED_HOME_VENUES = {
    "Goldberger Family Field",
    "Katherine Moran Coleman Aquatics Center",
    "Richard Gouse Field at Brown Stadium",
    "Stevenson-Pincince Field",
}

# DATA_CONTRACT.md section 5: "resolve home venues via gazetteer aliases
# (Brown Stadium, Meehan Auditorium, Pizzitola, OMAC, Stevenson-Pincince)".
CONTRACT_REQUIRED_VARIANTS = {
    "Brown Stadium",
    "Meehan Auditorium",
    "Pizzitola",
    "OMAC",
    "Stevenson-Pincince",
}


def ics(*events: tuple[str, str]) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Brown University Athletics"]
    for summary, location in events:
        lines += ["BEGIN:VEVENT", f"SUMMARY:{summary}", f"LOCATION:{location}", "END:VEVENT"]
    lines += ["END:VCALENDAR", ""]
    return "\r\n".join(lines)


class TestIcsParsing:
    def test_unfolds_continuation_lines_and_unescapes_text_values(self) -> None:
        text = ics(
            ("Brown University Women's Soccer vs New Haven", "Providence\\, R.I., Stevenson-Pincince Field")
        ).replace(
            "LOCATION:Providence\\, R.I., Stevenson-Pincince Field",
            "LOCATION:Providence\\, R.I., Stevenson-Pincince \r\n Field",
        )
        observations = av.parse_location_observations(text)
        assert len(observations) == 1
        assert observations[0].location_raw == "Providence, R.I., Stevenson-Pincince Field"

    def test_unescape_handles_backslash_semicolon_and_newline(self) -> None:
        assert av.unescape_ics_text("A\\, B\\; C\\nD\\\\E") == "A, B; C\nD\\E"


class TestClassificationRule:
    def classify(self, summary: str, location: str) -> av.LocationObservation:
        observations = av.parse_location_observations(ics((summary, location)))
        return observations[0]

    def test_home_venue_requires_providence_prefix_venue_and_vs_summary(self) -> None:
        observation = self.classify(
            "Brown University Women's Soccer vs New Haven",
            "Providence\\, R.I., Stevenson-Pincince Field",
        )
        assert observation.classification == "home-venue"
        assert observation.venue == "Stevenson-Pincince Field"
        assert observation.city == "Providence, R.I."

    def test_away_city_is_excluded_even_for_neutral_vs_games(self) -> None:
        observation = self.classify(
            "Brown University Football vs Harvard",
            "Pawtucket\\, R.I., Centreville Bank Stadium",
        )
        assert observation.classification == "away-city"
        assert observation.venue == "Centreville Bank Stadium"

    def test_an_at_game_in_providence_is_excluded_as_away(self) -> None:
        # Providence College's stadium carries the same city prefix.
        observation = self.classify(
            "Brown University Men's Soccer at Providence",
            "Providence\\, R.I., Chapey Field at Anderson Stadium",
        )
        assert observation.classification == "away-game"

    def test_known_non_brown_providence_venues_are_blocked_even_with_vs(self) -> None:
        observation = self.classify(
            "Brown University Men's Soccer vs Somebody",
            "Providence\\, R.I., Chapey Field at Anderson Stadium",
        )
        assert observation.classification == "non-brown-venue"

    def test_city_only_tba_and_empty_locations_are_excluded_with_reasons(self) -> None:
        assert self.classify("Brown University X vs Y", "Providence\\, R.I.").classification == "city-only"
        assert self.classify("Brown University X at Y", "TBA").classification == "tba"
        assert self.classify("Brown University X vs Y", "").classification == "no-location"

    def test_every_recorded_location_is_classified_never_silently_dropped(self) -> None:
        observations = av.parse_location_observations(RECORDED_ICS.read_text(encoding="utf-8"))
        assert len(observations) == 170  # one per VEVENT
        assert all(observation.classification for observation in observations)
        home = {o.venue for o in observations if o.classification == "home-venue"}
        assert home == OBSERVED_HOME_VENUES

    def test_the_recorded_feed_yields_the_known_exclusion_reasons(self) -> None:
        observations = av.parse_location_observations(RECORDED_ICS.read_text(encoding="utf-8"))
        reasons = {o.classification for o in observations}
        assert reasons == {"home-venue", "away-city", "away-game", "tba", "no-location"}


class TestVenueMappings:
    def test_every_observed_home_venue_is_mapped(self) -> None:
        assert OBSERVED_HOME_VENUES <= set(av.VENUE_MAPPINGS)

    def test_the_contract_required_variants_are_mapped(self) -> None:
        assert CONTRACT_REQUIRED_VARIANTS <= set(av.VENUE_MAPPINGS)

    def test_every_mapped_place_id_exists_in_the_curated_catalog(self) -> None:
        catalog_ids = {place.id for place in load_curated_catalog().places}
        missing = {
            place_id for place_id in av.VENUE_MAPPINGS.values() if place_id not in catalog_ids
        }
        assert not missing, f"sidecar targets unknown place ids: {sorted(missing)}"

    def test_variants_of_one_venue_agree_on_their_canonical_place(self) -> None:
        assert av.VENUE_MAPPINGS["Brown Stadium"] == av.VENUE_MAPPINGS["Richard Gouse Field at Brown Stadium"]
        assert av.VENUE_MAPPINGS["OMAC"] == av.VENUE_MAPPINGS["Olney-Margolies Athletic Center"]
        assert av.VENUE_MAPPINGS["Pizzitola"] == av.VENUE_MAPPINGS["Pizzitola Sports Center"]
        assert av.VENUE_MAPPINGS["Stevenson-Pincince"] == av.VENUE_MAPPINGS["Stevenson-Pincince Field"]


class TestNewGazetteerVenues:
    def test_goldberger_family_field_is_catalogued_with_osm_derived_coordinates(self) -> None:
        by_id = {place.id: place for place in load_curated_catalog().places}
        place = by_id["goldberger-family-field"]
        assert place.kind == "athletic"
        # OSM way 141129272 (leisure=pitch) centroid, Erickson Athletic Complex.
        assert place.lat == pytest.approx(41.83083, abs=0.0005)
        assert place.lng == pytest.approx(-71.39523, abs=0.0005)

    def test_the_aquatics_center_is_catalogued_inside_the_nelson_footprint(self) -> None:
        build = build_catalog_from_files()
        by_id = {row.id: row for row in build.rows}
        aquatics = by_id["coleman-aquatics-center"]
        assert aquatics.kind == "athletic"
        assert aquatics.osm_id == "way/195508288"  # Nelson Fitness Center building
        assert aquatics.polygon is not None
        assert not build.diagnostics


class TestSidecar:
    def test_the_sidecar_document_has_exactly_the_schema_v1_shape(self) -> None:
        document = av.build_sidecar(generated_at=datetime(2026, 7, 29, 12, 0, tzinfo=UTC))
        assert set(document) == {"schema_version", "generated_at", "mappings"}
        assert document["schema_version"] == 1
        assert document["generated_at"] == "2026-07-29T12:00:00Z"
        assert document["mappings"], "sidecar must not be empty"
        for mapping in document["mappings"]:
            assert set(mapping) == {"source_name", "place_id"}
            assert isinstance(mapping["source_name"], str) and mapping["source_name"]
            assert isinstance(mapping["place_id"], str) and mapping["place_id"]

    def test_mappings_are_sorted_and_unique_by_source_name(self) -> None:
        document = av.build_sidecar(generated_at=datetime(2026, 7, 29, 12, 0, tzinfo=UTC))
        names = [mapping["source_name"] for mapping in document["mappings"]]
        assert names == sorted(names)
        assert len(names) == len(set(names))

    def test_generated_at_defaults_to_utc_now_in_z_form(self) -> None:
        document = av.build_sidecar()
        parsed = datetime.fromisoformat(document["generated_at"].replace("Z", "+00:00"))
        assert parsed.tzinfo is not None
        assert abs((datetime.now(UTC) - parsed).total_seconds()) < 60


class TestJob:
    def test_the_job_publishes_the_sidecar_from_the_recorded_feed(self, tmp_path: Path) -> None:
        sidecar = tmp_path / "athletics_venues.json"
        result = av.run_athletics_venues_job(
            ics_path=RECORDED_ICS, sidecar_path=sidecar, staging_root=tmp_path / "staging"
        )
        assert result.gate_failures == ()
        assert result.home_venues == tuple(sorted(OBSERVED_HOME_VENUES))
        document = json.loads(sidecar.read_text(encoding="utf-8"))
        assert document["schema_version"] == 1
        assert result.published_count == len(document["mappings"]) == len(av.VENUE_MAPPINGS)
        assert not list((tmp_path / "staging").iterdir()), "staging must be left clean"

    def test_an_unmapped_home_venue_fails_closed_without_touching_the_sidecar(
        self, tmp_path: Path
    ) -> None:
        sidecar = tmp_path / "athletics_venues.json"
        sidecar.write_text("PREVIOUS CONTENT", encoding="utf-8")
        feed = ics(
            ("Brown University Quidditch vs Yale", "Providence\\, R.I., Imaginary Bowl"),
            ("Brown University Football vs Bryant", "Providence\\, R.I., Richard Gouse Field at Brown Stadium"),
        )
        source = tmp_path / "feed.ics"
        source.write_text(feed, encoding="utf-8")
        result = av.run_athletics_venues_job(
            ics_path=source, sidecar_path=sidecar, staging_root=tmp_path / "staging"
        )
        assert result.published_count is None
        assert any("Imaginary Bowl" in failure for failure in result.gate_failures)
        assert sidecar.read_text(encoding="utf-8") == "PREVIOUS CONTENT"

    def test_exclusions_are_reported_per_reason_with_counts(self) -> None:
        result = av.run_athletics_venues_job(
            ics_path=RECORDED_ICS, sidecar_path=None, staging_root=None
        )
        assert result.published_count is None  # dry run: no destination
        exclusions = dict(result.exclusion_counts)
        assert exclusions["away-city"] > 0
        assert exclusions["away-game"] == 1  # Chapey Field at Anderson Stadium
        assert exclusions["tba"] == 6
        assert exclusions["no-location"] == 3
        assert "home-venue" not in exclusions
