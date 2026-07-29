from __future__ import annotations

from pathlib import Path

import pytest

from brownsync_ingest.gazetteer.geometry import parse_multipolygon_wkt
from brownsync_ingest.gazetteer.models import OsmBuilding
from brownsync_ingest.gazetteer.overpass import index_buildings, load_overpass_elements
from brownsync_ingest.policy import validate_coordinates, validate_multipolygon_wkt


FIXTURE = Path(__file__).resolve().parents[2] / "fixtures/recorded/overpass/college-hill-buildings.json"


def way(name: str | None = "Test Hall", **overrides: object) -> dict:
    element = {
        "type": "way",
        "id": 101,
        "bounds": {"minlat": 41.0, "minlon": -71.5, "maxlat": 41.2, "maxlon": -71.3},
        "geometry": [
            {"lat": 41.0, "lon": -71.5},
            {"lat": 41.0, "lon": -71.3},
            {"lat": 41.2, "lon": -71.3},
            {"lat": 41.2, "lon": -71.5},
            {"lat": 41.0, "lon": -71.5},
        ],
        "tags": {"building": "university"},
    }
    if name is not None:
        element["tags"]["name"] = name
    element.update(overrides)
    return element


class TestSyntheticElements:
    def test_closed_way_produces_polygon_wkt_centroid_and_identity(self) -> None:
        buildings = index_buildings([way()])
        building = buildings["Test Hall"]
        assert isinstance(building, OsmBuilding)
        assert building.osm_type == "way"
        assert building.osm_id == "way/101"
        assert building.name == "Test Hall"
        assert building.geometry_error is None
        assert building.wkt is not None
        assert validate_multipolygon_wkt(building.wkt) == building.wkt
        [(outer, holes)] = parse_multipolygon_wkt(building.wkt)
        assert len(outer) == 5 and holes == []
        assert building.centroid == (pytest.approx(41.1), pytest.approx(-71.4))
        assert building.fallback_center == (pytest.approx(41.1), pytest.approx(-71.4))

    def test_unnamed_elements_without_a_full_address_are_skipped(self) -> None:
        assert index_buildings([way(name=None)]) == {}
        partial = way(name=None)
        partial["tags"]["addr:housenumber"] = "2"
        assert index_buildings([partial]) == {}
        street_only = way(name=None)
        street_only["tags"]["addr:street"] = "Stimson Avenue"
        assert index_buildings([street_only]) == {}

    def test_unnamed_element_with_full_address_is_indexed_under_addr_key(self) -> None:
        unnamed = way(name=None)
        unnamed["tags"].update({"addr:housenumber": "2", "addr:street": "Stimson Avenue"})
        buildings = index_buildings([unnamed])
        building = buildings["addr:2 Stimson Avenue"]
        assert building.name == "addr:2 Stimson Avenue"
        assert building.osm_id == "way/101"
        assert building.wkt is not None
        assert building.address == "2 Stimson Avenue"

    def test_named_elements_are_never_indexed_under_an_addr_key(self) -> None:
        named = way()
        named["tags"].update({"addr:housenumber": "101", "addr:street": "Thayer Street"})
        buildings = index_buildings([named])
        assert set(buildings) == {"Test Hall"}

    def test_duplicate_names_keep_the_first_element(self) -> None:
        first = way()
        second = way(id=202)
        buildings = index_buildings([first, second])
        assert buildings["Test Hall"].osm_id == "way/101"

    def test_duplicate_addr_keys_keep_the_first_unnamed_element(self) -> None:
        first = way(name=None)
        first["tags"].update({"addr:housenumber": "66", "addr:street": "Benefit Street"})
        second = way(name=None, id=202)
        second["tags"].update({"addr:housenumber": "66", "addr:street": "Benefit Street"})
        buildings = index_buildings([first, second])
        assert buildings["addr:66 Benefit Street"].osm_id == "way/101"

    def test_relation_stitches_outer_fragments_and_assigns_inner_hole(self) -> None:
        relation = {
            "type": "relation",
            "id": 55,
            "bounds": {"minlat": 41.0, "minlon": -71.5, "maxlat": 41.2, "maxlon": -71.3},
            "members": [
                {
                    "type": "way",
                    "ref": 1,
                    "role": "outer",
                    "geometry": [
                        {"lat": 41.0, "lon": -71.5},
                        {"lat": 41.0, "lon": -71.3},
                        {"lat": 41.2, "lon": -71.3},
                    ],
                },
                {
                    "type": "way",
                    "ref": 2,
                    "role": "outer",
                    "geometry": [
                        {"lat": 41.2, "lon": -71.3},
                        {"lat": 41.2, "lon": -71.5},
                        {"lat": 41.0, "lon": -71.5},
                    ],
                },
                {
                    "type": "way",
                    "ref": 3,
                    "role": "inner",
                    "geometry": [
                        {"lat": 41.05, "lon": -71.45},
                        {"lat": 41.05, "lon": -71.4},
                        {"lat": 41.1, "lon": -71.4},
                        {"lat": 41.1, "lon": -71.45},
                        {"lat": 41.05, "lon": -71.45},
                    ],
                },
                {"type": "node", "ref": 9, "role": "label"},
            ],
            "tags": {"building": "yes", "name": "Relation Hall", "type": "multipolygon"},
        }
        building = index_buildings([relation])["Relation Hall"]
        assert building.osm_id == "relation/55"
        assert building.geometry_error is None
        [(outer, holes)] = parse_multipolygon_wkt(building.wkt)
        assert outer[0] == outer[-1]
        assert len(holes) == 1

    def test_broken_geometry_yields_diagnostic_and_bounds_fallback_not_a_crash(self) -> None:
        open_way = way()
        open_way["geometry"] = open_way["geometry"][:-1]  # no longer closed
        building = index_buildings([open_way])["Test Hall"]
        assert building.wkt is None
        assert building.centroid is None
        assert building.geometry_error is not None
        assert "closed" in building.geometry_error
        assert building.fallback_center == (pytest.approx(41.1), pytest.approx(-71.4))

    def test_missing_geometry_and_missing_bounds_stay_survivable(self) -> None:
        bare = way()
        del bare["geometry"]
        del bare["bounds"]
        building = index_buildings([bare])["Test Hall"]
        assert building.wkt is None
        assert building.fallback_center is None
        assert building.geometry_error is not None

    def test_address_composes_available_addr_parts(self) -> None:
        tagged = way()
        tagged["tags"].update(
            {
                "addr:housenumber": "81",
                "addr:street": "Waterman Street",
                "addr:city": "Providence",
                "addr:state": "RI",
                "addr:postcode": "02912",
            }
        )
        building = index_buildings([tagged])["Test Hall"]
        assert building.address == "81 Waterman Street, Providence, RI 02912"

    def test_address_with_partial_parts_and_none_when_absent(self) -> None:
        partial = way()
        partial["tags"].update({"addr:housenumber": "81", "addr:street": "Waterman Street", "addr:postcode": "02912"})
        assert index_buildings([partial])["Test Hall"].address == "81 Waterman Street, 02912"
        assert index_buildings([way()])["Test Hall"].address is None


class TestRecordedFixture:
    @pytest.fixture(scope="class")
    def buildings(self) -> dict[str, OsmBuilding]:
        return index_buildings(load_overpass_elements(FIXTURE))

    def test_loads_all_recorded_elements(self) -> None:
        assert len(load_overpass_elements(FIXTURE)) == 2155

    def test_indexes_every_named_element_and_unnamed_addressed_footprint(
        self, buildings: dict[str, OsmBuilding]
    ) -> None:
        named = [b for key, b in buildings.items() if not key.startswith("addr:")]
        assert len(named) == 329
        assert len(buildings) == 769  # 329 named + 440 unnamed with full address
        assert "Sayles Hall" in buildings
        assert "Barus & Holley" in buildings
        assert "Barus Building" in buildings

    @pytest.mark.parametrize(
        ("addr_key", "osm_id"),
        [
            ("addr:2 Stimson Avenue", "way/195508291"),
            ("addr:135 Thayer Street", "way/177016169"),
            ("addr:59 Charlesfield Street", "way/177075425"),
            ("addr:8 Fones Alley", "way/177075314"),
            ("addr:271 Thayer Street", "way/185225906"),
        ],
    )
    def test_task_6b_unnamed_class_venues_are_reachable_by_address(
        self, buildings: dict[str, OsmBuilding], addr_key: str, osm_id: str
    ) -> None:
        building = buildings[addr_key]
        assert building.osm_id == osm_id
        assert building.geometry_error is None
        assert building.wkt is not None
        assert building.centroid is not None

    def test_kassar_house_relation_has_two_outer_parts(self, buildings: dict[str, OsmBuilding]) -> None:
        kassar = buildings["Kassar House"]
        assert kassar.osm_id == "relation/14295043"
        assert kassar.geometry_error is None
        polygons = parse_multipolygon_wkt(kassar.wkt)
        assert len(polygons) == 2
        assert all(not holes for _, holes in polygons)

    @pytest.mark.parametrize(
        ("name", "osm_id"),
        [("Barbour Hall", "relation/2723887"), ("Verney-Woolley Hall", "relation/14553488")],
    )
    def test_relations_with_holes_parse_into_valid_wkt(
        self, buildings: dict[str, OsmBuilding], name: str, osm_id: str
    ) -> None:
        building = buildings[name]
        assert building.osm_id == osm_id
        assert building.geometry_error is None
        [(outer, holes)] = parse_multipolygon_wkt(building.wkt)
        assert len(holes) == 1

    def test_every_emitted_wkt_passes_policy_and_centroids_are_plausible(
        self, buildings: dict[str, OsmBuilding]
    ) -> None:
        with_geometry = [b for b in buildings.values() if b.wkt is not None]
        assert len(with_geometry) >= 300
        for building in with_geometry:
            assert validate_multipolygon_wkt(building.wkt) == building.wkt
            lat, lng = building.centroid
            validate_coordinates(lat, lng)
            assert 41.7 < lat < 42.0, building.name
            assert -71.5 < lng < -71.3, building.name

    def test_sayles_hall_address_matches_recorded_tags(self, buildings: dict[str, OsmBuilding]) -> None:
        assert buildings["Sayles Hall"].address == "81 Waterman Street, 02912"
