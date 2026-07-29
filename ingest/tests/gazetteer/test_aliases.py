from __future__ import annotations

from pathlib import Path
import textwrap

import pytest
import yaml

from brownsync_ingest.gazetteer.aliases import (
    DEFAULT_ALIASES_PATH,
    load_curated_catalog,
    normalize_alias,
)
from brownsync_ingest.policy import validate_slug


VALID_HEADER = textwrap.dedent(
    """\
    schema_version: 1
    attribution: "Building footprints (c) OpenStreetMap contributors, ODbL 1.0"
    places:
    """
)


def write_catalog(tmp_path: Path, body: str, header: str = VALID_HEADER) -> Path:
    path = tmp_path / "aliases.yaml"
    path.write_text(header + textwrap.dedent(body), encoding="utf-8")
    return path


class TestNormalizeAlias:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("B&H", "b h"),
            ("Jo's", "jos"),
            ("Jo’s", "jos"),
            ("OMAC", "omac"),
            ("The  Ratty ", "the ratty"),
            ("Verney-Woolley Hall", "verney woolley hall"),
            ("Café Carré", "cafe carre"),
            ("Barus & Holley", "barus holley"),
            ("Barus and Holley", "barus and holley"),
        ],
    )
    def test_normalizes_case_punctuation_and_accents(self, text: str, expected: str) -> None:
        assert normalize_alias(text) == expected

    @pytest.mark.parametrize("text", ["", "  ", "&,-"])
    def test_rejects_text_that_normalizes_to_nothing(self, text: str) -> None:
        with pytest.raises(ValueError):
            normalize_alias(text)


class TestLoader:
    def test_loads_a_minimal_place_and_derives_the_id_from_the_name(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall, Sayles]
            """,
        )
        catalog = load_curated_catalog(path)
        assert catalog.attribution.startswith("Building footprints")
        [place] = catalog.places
        assert place.id == "sayles-hall"
        assert place.kind == "academic"
        assert place.aliases == ("Sayles Hall", "Sayles")
        assert place.osm_name == "Sayles Hall"
        assert place.lat is None and place.lng is None

    def test_explicit_id_osm_name_and_coordinates_are_honored(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - id: josiahs
                name: Josiah's
                kind: dining
                aliases: [Josiah's, Jo's]
                osm: Vartan Gregorian Quad B
                lat: 41.8233
                lng: -71.3998
            """,
        )
        [place] = load_curated_catalog(path).places
        assert place.id == "josiahs"
        assert place.osm_name == "Vartan Gregorian Quad B"
        assert (place.lat, place.lng) == (41.8233, -71.3998)

    def test_place_name_must_itself_be_listed_in_aliases(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles]
            """,
        )
        with pytest.raises(ValueError, match="name.*aliases"):
            load_curated_catalog(path)

    def test_normalized_alias_collision_across_places_is_a_load_error(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall, "sayles--hall"]
              - name: Sayles Annex
                kind: academic
                aliases: [Sayles Annex]
            """,
        )
        with pytest.raises(ValueError, match="alias"):
            load_curated_catalog(path)

    def test_normalized_alias_collision_between_two_places_is_a_load_error(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall, Sayles]
              - name: Sayles Annex
                kind: academic
                aliases: [Sayles Annex, SAYLES]
            """,
        )
        with pytest.raises(ValueError, match="alias.*sayles|sayles.*alias"):
            load_curated_catalog(path)

    @pytest.mark.parametrize(
        ("field", "value"),
        [("kind", "cafeteria"), ("id", "Not A Slug"), ("name", "''")],
    )
    def test_invalid_field_values_are_load_errors(self, tmp_path: Path, field: str, value: str) -> None:
        path = write_catalog(
            tmp_path,
            f"""\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
                {field}: {value}
            """,
        )
        with pytest.raises(ValueError):
            load_curated_catalog(path)

    def test_duplicate_ids_are_a_load_error(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
              - id: sayles-hall
                name: Sayles Hall Basement
                kind: academic
                aliases: [Sayles Hall Basement]
            """,
        )
        with pytest.raises(ValueError, match="id"):
            load_curated_catalog(path)

    def test_latitude_without_longitude_is_a_load_error(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
                lat: 41.8
            """,
        )
        with pytest.raises(ValueError, match="lat.*lng|lng.*lat"):
            load_curated_catalog(path)

    def test_unknown_keys_and_wrong_schema_version_are_load_errors(self, tmp_path: Path) -> None:
        bad_version = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
            """,
            header=VALID_HEADER.replace("schema_version: 1", "schema_version: 2"),
        )
        with pytest.raises(ValueError, match="schema_version"):
            load_curated_catalog(bad_version)
        unknown_key = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
                nickname: old main
            """,
        )
        with pytest.raises(ValueError, match="unknown"):
            load_curated_catalog(unknown_key)

    def test_attribution_must_credit_openstreetmap_and_odbl(self, tmp_path: Path) -> None:
        path = write_catalog(
            tmp_path,
            """\
              - name: Sayles Hall
                kind: academic
                aliases: [Sayles Hall]
            """,
            header=VALID_HEADER.replace(
                'attribution: "Building footprints (c) OpenStreetMap contributors, ODbL 1.0"',
                'attribution: "no credit"',
            ),
        )
        with pytest.raises(ValueError, match="attribution"):
            load_curated_catalog(path)


class TestRealCatalog:
    @pytest.fixture(scope="class")
    def catalog(self):
        return load_curated_catalog()

    def test_default_path_is_the_packaged_aliases_yaml(self) -> None:
        assert DEFAULT_ALIASES_PATH.name == "aliases.yaml"
        assert DEFAULT_ALIASES_PATH.is_file()

    def test_has_verified_inventory_for_at_least_120_places(self, catalog) -> None:
        assert len(catalog.places) >= 120

    def test_all_ids_are_valid_slugs(self, catalog) -> None:
        for place in catalog.places:
            assert validate_slug(place.id) == place.id

    def test_canonical_dining_entries_exist_with_kind_dining(self, catalog) -> None:
        by_id = {place.id: place for place in catalog.places}
        expectations = {
            "sharpe-refectory": "Ratty",
            "andrews-commons": "Andrews Commons",
            "verney-woolley-dining-hall": "V-Dub",
            "blue-room": "Blue Room",
            "ivy-room": "Ivy Room",
            "josiahs": "Jo's",
        }
        for place_id, mandated_alias in expectations.items():
            assert place_id in by_id, f"missing dining place {place_id}"
            place = by_id[place_id]
            assert place.kind == "dining", f"{place_id} must have kind='dining'"
            normalized = {normalize_alias(alias) for alias in place.aliases}
            assert normalize_alias(mandated_alias) in normalized

    def test_athletics_venue_aliases_cover_the_sidearm_names(self, catalog) -> None:
        all_normalized = {
            normalize_alias(alias) for place in catalog.places for alias in place.aliases
        }
        for venue in (
            "Brown Stadium",
            "Meehan Auditorium",
            "Pizzitola",
            "OMAC",
            "Stevenson-Pincince Field",
        ):
            assert normalize_alias(venue) in all_normalized, f"missing athletics alias {venue}"

    def test_barus_building_is_distinct_from_barus_and_holley(self, catalog) -> None:
        by_id = {place.id: place for place in catalog.places}
        assert "barus-holley" in by_id
        assert "barus-building" in by_id
        assert normalize_alias(by_id["barus-holley"].name) != normalize_alias(
            by_id["barus-building"].name
        )

    def test_every_normalized_alias_is_unique_across_the_catalog(self, catalog) -> None:
        seen: dict[str, str] = {}
        for place in catalog.places:
            for alias in place.aliases:
                key = normalize_alias(alias)
                assert key not in seen or seen[key] == place.id
                seen[key] = place.id

    def test_the_raw_yaml_matches_the_declared_schema_version(self) -> None:
        raw = yaml.safe_load(DEFAULT_ALIASES_PATH.read_text(encoding="utf-8"))
        assert raw["schema_version"] == 1
