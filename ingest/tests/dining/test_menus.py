"""Dining menus from Brown OIT's service bus.

The block on this source was real but scoped too widely — it named
`dining.brown.edu`'s 403, which is the marketing CMS, and concluded the data
was unreachable. It is not. These tests pin the shape of what actually is.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brownsync_ingest.dining.menus import (
    ICON_LABELS,
    KNOWN_ALLERGENS,
    LOCATION_PLACES,
    MIN_ITEMS,
    Location,
    build_document,
    load_menus,
    normalize,
    run_dining_job,
    unknown_allergens,
)


@pytest.fixture(scope="module")
def locations() -> list[Location]:
    rows, _ = normalize(load_menus())
    return rows


class TestNormalization:
    def test_reads_the_whole_estate(self, locations) -> None:
        assert len(locations) == 7
        assert {loc.location_id for loc in locations} == set(LOCATION_PLACES)

    def test_every_location_binds_to_a_seeded_place(self, locations, repo_root) -> None:
        # A hall with no place id cannot be put on the map or reached from a
        # place page — it silently stops existing.
        seeded = {
            json.loads(line)["id"]
            for line in (repo_root / "db/seeds/places.ndjson").read_text().splitlines()
            if line.strip()
        }
        for location in locations:
            assert location.place_id, location.location_id
            assert location.place_id in seeded, f"{location.location_id} → {location.place_id}"

    def test_summer_closure_is_not_an_error(self, locations) -> None:
        # Four halls legitimately carry zero services out of term. They must
        # still be PRESENT, with an empty service list — dropping them would
        # make "is the Ratty open?" unanswerable rather than answerable "no".
        closed = [loc for loc in locations if not loc.is_open_somewhere]
        assert closed, "expected some halls closed in the recorded fixture"
        for location in closed:
            assert location.name
            assert location.place_id
            assert location.services == ()

    def test_services_are_date_ordered(self, locations) -> None:
        for location in locations:
            keys = [(s.date, s.start or "", s.meal) for s in location.services]
            assert keys == sorted(keys), location.location_id

    def test_hours_keep_their_offset(self, locations) -> None:
        # These are wall-clock campus hours. Normalizing to UTC would throw
        # away the thing that makes "closes at 3pm" renderable without a tz
        # database on the client.
        for location in locations:
            for service in location.services:
                if service.start:
                    assert service.start.endswith(("-04:00", "-05:00")), service.start

    def test_empty_stations_are_dropped(self) -> None:
        # The source emits station headings for things not served today; they
        # would render as an empty accordion row.
        document = [
            {
                "locationId": "BR",
                "name": "Blue Room",
                "meals": {
                    "2026-07-29": [
                        {
                            "meal": "Lunch",
                            "menu": {
                                "date": "2026-07-29",
                                "hours": {"start": "2026-07-29T07:30:00-04:00", "end": None},
                                "stations": [
                                    {"name": "Empty", "items": []},
                                    {
                                        "name": "Pastry",
                                        "items": [{"item": "Muffin", "allergens": ["DAIRY"]}],
                                    },
                                ],
                            },
                        }
                    ]
                },
            }
        ]
        rows, _ = normalize(document)
        assert [s.name for s in rows[0].services[0].stations] == ["Pastry"]

    def test_a_service_with_no_stations_is_dropped(self) -> None:
        document = [
            {
                "locationId": "BR",
                "name": "Blue Room",
                "meals": {"2026-07-29": [{"meal": "Lunch", "menu": {"stations": []}}]},
            }
        ]
        rows, _ = normalize(document)
        assert rows[0].services == ()

    def test_an_unmapped_location_is_reported_not_dropped(self) -> None:
        document = [{"locationId": "NEW", "name": "New Hall", "meals": {}}]
        rows, diagnostics = normalize(document)
        assert len(rows) == 1
        assert rows[0].place_id is None
        assert any("NEW" in message for message in diagnostics)


class TestAllergens:
    def test_the_recorded_vocabulary_is_fully_known(self, locations) -> None:
        assert unknown_allergens(locations) == set()

    def test_an_unrecognised_allergen_is_published_anyway(self) -> None:
        # Swallowing an allergen the vocabulary has not seen is the dangerous
        # outcome. It is surfaced as a diagnostic AND kept on the item.
        document = [
            {
                "locationId": "BR",
                "name": "Blue Room",
                "meals": {
                    "2026-07-29": [
                        {
                            "meal": "Lunch",
                            "menu": {
                                "date": "2026-07-29",
                                "stations": [
                                    {
                                        "name": "S",
                                        "items": [{"item": "X", "allergens": ["MUSTARD"]}],
                                    }
                                ],
                            },
                        }
                    ]
                },
            }
        ]
        rows, _ = normalize(document)
        item = rows[0].services[0].stations[0].items[0]
        assert item.allergens == ("MUSTARD",)
        assert unknown_allergens(rows) == {"MUSTARD"}

    def test_allergens_are_uppercased_and_deduped(self) -> None:
        document = [
            {
                "locationId": "BR",
                "name": "Blue Room",
                "meals": {
                    "2026-07-29": [
                        {
                            "meal": "Lunch",
                            "menu": {
                                "date": "2026-07-29",
                                "stations": [
                                    {
                                        "name": "S",
                                        "items": [
                                            {"item": "X", "allergens": ["dairy", "DAIRY", " Egg "]}
                                        ],
                                    }
                                ],
                            },
                        }
                    ]
                },
            }
        ]
        rows, _ = normalize(document)
        assert rows[0].services[0].stations[0].items[0].allergens == ("DAIRY", "EGG")

    def test_every_known_allergen_stays_in_the_vocabulary(self) -> None:
        assert "WHEAT/GLUTEN" in KNOWN_ALLERGENS
        assert "TREE NUTS" in KNOWN_ALLERGENS


class TestJob:
    def test_publishes_when_the_gates_pass(self, tmp_path: Path) -> None:
        result = run_dining_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            generated_at="2026-07-29T20:00:00-04:00",
        )
        assert result.gate_failures == ()
        assert result.published_count and result.published_count >= MIN_ITEMS
        document = json.loads((tmp_path / "dining_menus.json").read_text())
        assert document["schema_version"] == 1
        assert len(document["locations"]) == 7
        assert "Brown University Dining" in document["attribution"]
        assert document["icon_labels"]["VGN"] == ICON_LABELS["VGN"]

    def test_a_dead_feed_fails_closed(self, tmp_path: Path) -> None:
        # Every hall reporting zero services is not a holiday, it is a broken
        # upstream — and it must not overwrite yesterday's good artifact.
        empty = tmp_path / "empty.json"
        empty.write_text(
            json.dumps(
                [
                    {"locationId": key, "name": key, "meals": {}}
                    for key in LOCATION_PLACES
                ]
            )
        )
        result = run_dining_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", menus_path=empty
        )
        assert result.gate_failures
        assert result.published_count is None
        assert not (tmp_path / "dining_menus.json").exists()

    def test_a_new_hall_fails_loudly(self, tmp_path: Path) -> None:
        source = tmp_path / "new.json"
        source.write_text(json.dumps([{"locationId": "NEW", "name": "New Hall", "meals": {}}]))
        result = run_dining_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", menus_path=source
        )
        assert any("unmapped" in failure for failure in result.gate_failures)


class TestDocument:
    def test_omits_empty_optional_fields(self, locations) -> None:
        # 1,143 items × four always-present keys is most of the payload.
        document = build_document(locations, "2026-07-29T20:00:00-04:00")
        for location in document["locations"]:
            for service in location["services"]:
                for station in service["stations"]:
                    for item in station["items"]:
                        assert "name" in item
                        for key in ("allergens", "icons", "description"):
                            if key in item:
                                assert item[key]

    def test_closed_halls_still_appear(self, locations) -> None:
        document = build_document(locations, "2026-07-29T20:00:00-04:00")
        ids = {location["locationId"] for location in document["locations"]}
        assert ids == set(LOCATION_PLACES)
