"""Campus amenity points — five ArcGIS layers in three different shapes.

The failure mode this guards is quiet: an upstream layer starts returning an
empty FeatureCollection, or a column is renamed, and the artifact publishes
with a kind silently missing. Nothing else in the pipeline notices.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brownsync_ingest.campus.amenities import (
    AMENITY_KINDS,
    MAX_DETAIL_CHARS,
    MIN_BY_KIND,
    Amenity,
    aed_amenities,
    bike_amenities,
    blue_light_amenities,
    building_resource_amenities,
    build_amenities_document,
    collect_amenities,
    counts_by_kind,
    load_layer,
    resolve_labels,
    restroom_amenities,
    run_campus_amenities_job,
)
from brownsync_ingest.campus.arcgis import load_arcgis_geojson, normalize_features


@pytest.fixture(scope="module")
def amenities() -> list[Amenity]:
    return collect_amenities()


@pytest.fixture(scope="module")
def buildings():
    rows, _ = normalize_features(load_arcgis_geojson())
    return rows


@pytest.fixture(scope="module")
def resolved(amenities, buildings):
    rows, _ = resolve_labels(amenities, buildings)
    return rows


class TestSources:
    def test_every_declared_kind_is_actually_produced(self, amenities) -> None:
        counts = counts_by_kind(amenities)
        for kind in AMENITY_KINDS:
            assert counts.get(kind, 0) > 0, f"{kind} declared but never produced"

    def test_no_undeclared_kind_leaks_out(self, amenities) -> None:
        assert set(counts_by_kind(amenities)) <= set(AMENITY_KINDS)

    def test_counts_clear_their_gates_with_headroom(self, amenities) -> None:
        counts = counts_by_kind(amenities)
        for kind, floor in MIN_BY_KIND.items():
            assert counts.get(kind, 0) >= floor, f"{kind}: {counts.get(kind, 0)} < {floor}"

    def test_ids_are_unique(self, amenities) -> None:
        # The id is the GeoJSON feature id; duplicates make feature-state and
        # click-through target whichever one MapLibre saw last.
        ids = [a.id for a in amenities]
        assert len(ids) == len(set(ids))

    def test_output_is_deterministic(self, amenities) -> None:
        assert [a.id for a in amenities] == [a.id for a in sorted(amenities, key=lambda a: (a.kind, a.id))]

    def test_every_point_lands_on_college_hill(self, amenities) -> None:
        # ArcGIS returns [0, 0] for rows whose geometry was never set. One
        # Null Island point drags the artifact bbox into the Atlantic.
        for amenity in amenities:
            assert -71.45 < amenity.lng < -71.37, amenity.id
            assert 41.75 < amenity.lat < 41.87, amenity.id


class TestNarcanComesFromTheAedTable:
    def test_narcan_is_a_subset_of_aed_locations(self, amenities) -> None:
        # Brown publishes Narcan_2_view_esri_test (41 rows) AND a `narcan`
        # column on the AED layer (43 flagged). Two tables can disagree with
        # each other; one cannot. Every Narcan point must sit on an AED.
        aed = {(round(a.lng, 6), round(a.lat, 6)) for a in amenities if a.kind == "aed"}
        narcan = {(round(a.lng, 6), round(a.lat, 6)) for a in amenities if a.kind == "narcan"}
        assert narcan <= aed
        assert len(narcan) < len(aed)

    def test_only_flagged_rows_become_narcan(self) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.40, 41.826]},
                    "properties": {"OBJECTID": 1, "Name": "Has it", "narcan": "Y"},
                },
                {
                    "geometry": {"type": "Point", "coordinates": [-71.41, 41.827]},
                    "properties": {"OBJECTID": 2, "Name": "No narcan", "narcan": "N"},
                },
                {
                    "geometry": {"type": "Point", "coordinates": [-71.42, 41.828]},
                    "properties": {"OBJECTID": 3, "Name": "Unknown", "narcan": None},
                },
            ],
        }
        out = aed_amenities(document)
        assert counts_by_kind(out) == {"aed": 3, "narcan": 1}

    def test_restricted_access_is_surfaced(self) -> None:
        # "There is an AED here" is actively harmful if you cannot reach it.
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.40, 41.826]},
                    "properties": {"OBJECTID": 1, "Name": "X", "restricted": "Restricted"},
                }
            ],
        }
        assert "Restricted" in (aed_amenities(document)[0].detail or "")


class TestTheUnionTable:
    def test_one_row_can_yield_several_amenities(self) -> None:
        # All_Building_Resources is 127 buildings with a boolean column per
        # amenity — a single row is a hydration station AND a printer AND a
        # dining hall. Reading it once is why the per-kind counts cannot
        # disagree with the filtered per-kind views Brown also publishes.
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.4025, 41.8305]},
                    "properties": {
                        "ID": "ANDREWHALL",
                        "Name": "ANDREWHALL",
                        "Dining": 1,
                        "DiningText": "Andrews Commons",
                        "HydrationStation": 1,
                        "HydrationStationText": "Lower level",
                        "Printers": 1,
                        "PrintersText": "Study space",
                        "MenstrualProducts": None,
                        "LactationRooms": None,
                    },
                }
            ],
        }
        assert counts_by_kind(building_resource_amenities(document)) == {
            "dining": 1,
            "hydration": 1,
            "printer": 1,
        }

    def test_the_misspelled_text_column_is_read(self, amenities) -> None:
        # The source spells it `MestrualProductsText` — no `n`. Deriving the
        # text column name would silently produce None for all 31 rows.
        menstrual = [a for a in amenities if a.kind == "menstrual"]
        assert any(a.detail for a in menstrual)

    def test_a_null_flag_is_not_truthy_text(self) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.4025, 41.8305]},
                    "properties": {
                        "ID": "X",
                        "Name": "X",
                        "Printers": None,
                        "PrintersText": "a stale description with no printer",
                    },
                }
            ],
        }
        assert building_resource_amenities(document) == []


class TestRestrooms:
    def test_room_lists_are_split_on_the_pipe(self) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.3976, 41.826]},
                    "properties": {
                        "Property_Code": 100326,
                        "Property_Name": "Hope St 170",
                        "AlL_Restrooms___vlookup": "114 | 116 | 201 | 301",
                        "single_occupancy___vlookup": "114 | 116",
                        "Gender_Inclusive___vlookup": None,
                    },
                }
            ],
        }
        out = restroom_amenities(document)
        assert [a.kind for a in out] == ["restroom"]
        assert "4 restrooms" in (out[0].detail or "")
        assert "2 single-occupancy" in (out[0].detail or "")
        assert out[0].property_code == "100326"

    def test_gender_inclusive_is_its_own_point(self) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "Point", "coordinates": [-71.3976, 41.826]},
                    "properties": {
                        "Property_Code": 100326,
                        "Property_Name": "Hope St 170",
                        "AlL_Restrooms___vlookup": "114 | 201",
                        "Gender_Inclusive___vlookup": "114",
                    },
                }
            ],
        }
        assert sorted(a.kind for a in restroom_amenities(document)) == [
            "restroom",
            "restroom-inclusive",
        ]

    def test_property_codes_join_to_the_buildings_artifact(self, resolved, repo_root) -> None:
        document = json.loads((repo_root / "db/seeds/campus_buildings.geojson").read_text())
        known = {f["properties"]["propertyCode"] for f in document["features"]}
        joined = [a for a in resolved if a.kind == "restroom" and a.property_code in known]
        # Not all 147 restroom rows are Active Buildings, but most must join —
        # a near-zero overlap means the key changed upstream.
        assert len(joined) > 80


class TestLabels:
    def test_asset_codes_are_replaced_with_building_names(self, resolved) -> None:
        # The resource table's `Name` is an internal code — "ANDREWHALL",
        # "KQARCHBRON", "BENE026" — and empty for 27 of 127 rows.
        for amenity in resolved:
            assert amenity.label, amenity.id
            # An asset code is one shouty token. A multi-word all-caps string
            # is a real (if loud) description, softened rather than replaced.
            if " " not in amenity.label and amenity.label.isupper() and amenity.label.isalnum():
                pytest.fail(f"{amenity.id} kept an asset code label {amenity.label!r}")

    def test_nearest_building_wins_within_the_snap_radius(self, buildings) -> None:
        target = buildings[0]
        amenity = Amenity(
            id="hydration:X", kind="hydration", lat=target.lat, lng=target.lng, label=""
        )
        out, _ = resolve_labels([amenity], buildings)
        assert out[0].label == target.label
        assert out[0].property_code == target.property_code

    def test_a_point_far_from_campus_keeps_a_placeholder(self, buildings) -> None:
        # Nothing within 60 m, so nothing to inherit — inventing a name here
        # would put "Sciences Library" on a point 2 km away.
        amenity = Amenity(id="x:1", kind="hydration", lat=41.78, lng=-71.44, label="")
        out, diagnostics = resolve_labels([amenity], buildings)
        assert out[0].label == "Campus"
        assert diagnostics


class TestDetail:
    def test_newlines_are_collapsed(self, resolved) -> None:
        # 110 source rows carry literal CRLF; the AED directions are multi-
        # paragraph. A map popover is one line.
        for amenity in resolved:
            assert "\n" not in (amenity.detail or "")
            assert "\r" not in (amenity.detail or "")

    def test_a_composed_detail_obeys_the_same_cap_as_a_source_column(self, resolved) -> None:
        # The restroom detail is BUILT here from room lists rather than read
        # from a column, so it originally bypassed the length cap entirely —
        # the BioMed Center's 37 rooms rendered as 245 characters.
        longest = max(resolved, key=lambda a: len(a.detail or ""))
        assert len(longest.detail or "") <= MAX_DETAIL_CHARS + 1

    def test_long_detail_is_truncated_on_a_word_boundary(self, resolved) -> None:
        for amenity in resolved:
            detail = amenity.detail or ""
            assert len(detail) <= MAX_DETAIL_CHARS + 1  # +1 for the ellipsis
            if detail.endswith("…"):
                assert not detail[:-1].endswith(" ")


class TestJob:
    def test_publishes_and_gates(self, tmp_path: Path) -> None:
        result = run_campus_amenities_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging"
        )
        assert result.gate_failures == ()
        assert result.published_count and result.published_count > 700
        published = json.loads((tmp_path / "campus_amenities.geojson").read_text())
        assert published["type"] == "FeatureCollection"
        assert "Brown University Facilities" in published["attribution"]
        assert published["counts"]["blue-light"] > 100

    def test_a_gate_failure_publishes_nothing(self, tmp_path: Path, monkeypatch) -> None:
        # Fail-closed: the previous artifact must survive a bad drop.
        monkeypatch.setattr(
            "brownsync_ingest.campus.amenities.MIN_BY_KIND", {"blue-light": 10_000}
        )
        result = run_campus_amenities_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging"
        )
        assert result.gate_failures
        assert result.published_count is None
        assert not (tmp_path / "campus_amenities.geojson").exists()


class TestDocument:
    def test_carries_only_the_properties_the_map_reads(self, resolved) -> None:
        document = build_amenities_document(resolved[:20], "attribution")
        for feature in document["features"]:
            assert set(feature["properties"]) <= {"id", "kind", "label", "detail", "propertyCode"}
            assert feature["id"] == feature["properties"]["id"]

    def test_coordinates_are_rounded(self, resolved) -> None:
        document = build_amenities_document(resolved, "attribution")
        for feature in document["features"]:
            for value in feature["geometry"]["coordinates"]:
                assert round(value, 6) == value
