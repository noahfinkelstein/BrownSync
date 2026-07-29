"""Places job tests: fail-closed gates, atomic publication, determinism.

The CLI and db/seeds/manifest.json bundling remain Task 9; this seam owns
exactly the places.ndjson publication.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.job import MIN_PLACES, run_places_job


def write_catalog(tmp_path: Path, *, with_coordinates: bool) -> tuple[Path, Path]:
    coordinates = "\n    lat: 41.83\n    lng: -71.4" if with_coordinates else ""
    aliases_path = tmp_path / "aliases.yaml"
    aliases_path.write_text(
        "schema_version: 1\n"
        'attribution: "(c) OpenStreetMap contributors, ODbL 1.0"\n'
        "places:\n"
        "  - name: Test Hall\n"
        "    kind: academic\n"
        f"    aliases: [Test Hall]{coordinates}\n",
        encoding="utf-8",
    )
    overpass_path = tmp_path / "overpass.json"
    overpass_path.write_text(json.dumps({"elements": []}), encoding="utf-8")
    return aliases_path, overpass_path


def run_job(tmp_path: Path, **overrides):
    defaults = dict(
        seeds_path=tmp_path / "seeds" / "places.ndjson",
        staging_root=tmp_path / "staging",
    )
    defaults.update(overrides)
    return run_places_job(**defaults)


class TestSyntheticGates:
    def test_a_dropped_entry_fails_closed_and_never_publishes(self, tmp_path: Path) -> None:
        aliases_path, overpass_path = write_catalog(tmp_path, with_coordinates=False)
        result = run_job(
            tmp_path, aliases_path=aliases_path, overpass_path=overpass_path, min_places=1
        )
        assert result.published_count is None
        assert any("dropped" in failure for failure in result.gate_failures)
        assert not (tmp_path / "seeds" / "places.ndjson").exists()

    def test_too_few_places_fails_closed_and_preserves_existing_seeds(
        self, tmp_path: Path
    ) -> None:
        aliases_path, overpass_path = write_catalog(tmp_path, with_coordinates=True)
        seeds_path = tmp_path / "seeds" / "places.ndjson"
        seeds_path.parent.mkdir(parents=True)
        seeds_path.write_text("PREVIOUS PUBLICATION\n", encoding="utf-8")
        result = run_job(
            tmp_path, aliases_path=aliases_path, overpass_path=overpass_path, min_places=2
        )
        assert result.published_count is None
        assert any("places" in failure for failure in result.gate_failures)
        assert seeds_path.read_text(encoding="utf-8") == "PREVIOUS PUBLICATION\n"

    def test_a_passing_synthetic_catalog_publishes_one_contract_valid_row(
        self, tmp_path: Path
    ) -> None:
        aliases_path, overpass_path = write_catalog(tmp_path, with_coordinates=True)
        result = run_job(
            tmp_path, aliases_path=aliases_path, overpass_path=overpass_path, min_places=1
        )
        assert result.gate_failures == ()
        assert result.published_count == 1
        [line] = (tmp_path / "seeds" / "places.ndjson").read_text(encoding="utf-8").splitlines()
        row = PlaceRow.model_validate(json.loads(line))
        assert row.id == "test-hall"
        assert row.source == "curated"


class TestRealCatalogPublication:
    @pytest.fixture(scope="class")
    def published(self, tmp_path_factory: pytest.TempPathFactory):
        tmp_path = tmp_path_factory.mktemp("places-job")
        return run_job(tmp_path), tmp_path

    def test_default_floor_is_the_task_4_catalog_floor(self) -> None:
        assert MIN_PLACES == 120

    def test_publishes_the_full_grown_catalog(self, published) -> None:
        result, tmp_path = published
        assert result.gate_failures == ()
        assert result.published_count == len(result.rows) >= 160
        assert not list((tmp_path / "staging").iterdir()), "staging must be clean"

    def test_rows_are_contract_valid_sorted_and_include_the_dining_six(
        self, published
    ) -> None:
        _, tmp_path = published
        lines = (tmp_path / "seeds" / "places.ndjson").read_text(encoding="utf-8").splitlines()
        rows = [PlaceRow.model_validate(json.loads(line)) for line in lines]
        ids = [row.id for row in rows]
        assert ids == sorted(ids) and len(ids) == len(set(ids))
        for place_id in (
            "sharpe-refectory",
            "andrews-commons",
            "verney-woolley-dining-hall",
            "blue-room",
            "ivy-room",
            "josiahs",
        ):
            assert place_id in ids

    def test_task_6b_places_carry_their_evidence(self, published) -> None:
        _, tmp_path = published
        lines = (tmp_path / "seeds" / "places.ndjson").read_text(encoding="utf-8").splitlines()
        by_id = {row.id: row for row in (PlaceRow.model_validate(json.loads(line)) for line in lines)}
        assert by_id["67-george-street"].osm_id == "way/177187123"
        assert by_id["67-george-street"].polygon is not None
        assert by_id["2-stimson-avenue"].osm_id == "way/195508291"
        assert by_id["2-stimson-avenue"].polygon is not None
        assert by_id["135-thayer-street"].osm_id == "way/177016169"
        assert by_id["steinert-hall"].osm_id == "way/177187119"
        assert by_id["feinstein-building"].address == "130 Hope Street, Providence, RI"
        assert by_id["vartan-gregorian-quad"].source == "curated"
        assert by_id["vartan-gregorian-quad"].polygon is None
        assert by_id["warren-alpert-medical-school"].source == "curated"
        assert by_id["warren-alpert-medical-school"].lat == pytest.approx(41.818885)
        assert by_id["warren-alpert-medical-school"].lng == pytest.approx(-71.408416)

    def test_attribution_credits_openstreetmap_and_odbl(self, published) -> None:
        result, _ = published
        assert "OpenStreetMap" in result.attribution
        assert "ODbL" in result.attribution

    def test_publication_is_deterministic(self, published, tmp_path: Path) -> None:
        _, first_tmp = published
        second = run_job(tmp_path)
        assert second.gate_failures == ()
        first_bytes = (first_tmp / "seeds" / "places.ndjson").read_bytes()
        second_bytes = (tmp_path / "seeds" / "places.ndjson").read_bytes()
        assert first_bytes == second_bytes
