"""Brown-owned buildings sidecar (enrichment round, Codex drop).

``db/seeds/brown_owned_buildings.json`` closes the deferred map-tint item
(handoff section 5: "Brown-owned buildings slightly lighter"). Classification
is evidence-only:

* tier 1 (direct): the CSV row's ``operator``/``owner`` names Brown
  University;
* tier 2 (catalog): the way backs a curated gazetteer place whose kind
  asserts an institutional campus function (academic, residence, dining,
  athletic, library, admin) — those places were themselves curated from
  Brown-only evidence in Tasks 4/6B/8/10 and this enrichment round.

``brown_relevant_hint`` is corroboration only and never classifies: the drop
itself proves it name-matches RISD buildings (Chace Center, Memorial Hall).
Catalog places of kind ``other`` (campus center, Hillel, retail, RISD's
Chace Center, commercial complexes) form the reported ambiguous middle and
stay out of the sidecar rather than being guessed in.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from brownsync_ingest.brown_owned_buildings import (
    BROWN_OWNED_SIDECAR_KEYS,
    INSTITUTIONAL_KINDS,
    BuildingRow,
    build_sidecar,
    classify_buildings,
    load_buildings_csv,
    run_brown_owned_buildings_job,
    snapshot_drift,
)
from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.catalog import build_catalog_from_files
from brownsync_ingest.gazetteer.overpass import load_overpass_elements

INGEST_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = (
    INGEST_ROOT / "fixtures" / "user_provided" / "brown_college_hill_buildings.csv"
)
OVERPASS_PATH = (
    INGEST_ROOT / "fixtures" / "recorded" / "overpass" / "college-hill-buildings.json"
)
SEEDS_DIR = INGEST_ROOT.parent / "db" / "seeds"


def place(place_id: str, kind: str, osm_id: str | None) -> PlaceRow:
    return PlaceRow(
        id=place_id,
        name=place_id,
        aliases=[place_id],
        kind=kind,
        lat=41.826,
        lng=-71.403,
        polygon=None,
        address=None,
        osm_id=osm_id,
        source="osm" if osm_id else "curated",
    )


def building(
    way_id: int,
    *,
    name: str | None = None,
    operator: str | None = None,
    owner: str | None = None,
    hint: bool = False,
    building_type: str | None = "yes",
) -> BuildingRow:
    return BuildingRow(
        way_id=way_id,
        name=name,
        operator=operator,
        owner=owner,
        brown_relevant_hint=hint,
        building_type=building_type,
    )


class TestLoader:
    def test_the_drop_loads_2150_unique_ways(self) -> None:
        rows = load_buildings_csv(CSV_PATH)
        assert len(rows) == 2150
        assert len({row.way_id for row in rows}) == 2150

    def test_a_non_way_row_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "bad.csv"
        path.write_text(
            "osm_type,osm_id,name,brown_relevant_hint,building_type,operator,owner\n"
            "relation,7,X,false,yes,,\n",
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="osm_type"):
            load_buildings_csv(path)

    def test_a_duplicate_way_id_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "dup.csv"
        path.write_text(
            "osm_type,osm_id,name,brown_relevant_hint,building_type,operator,owner\n"
            "way,7,X,false,yes,,\n"
            "way,7,Y,false,yes,,\n",
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="duplicate"):
            load_buildings_csv(path)


class TestClassification:
    def test_operator_and_owner_evidence_is_direct_and_case_insensitive(self) -> None:
        rows = (
            building(1, operator="Brown University"),
            building(2, owner="BROWN UNIVERSITY"),
            building(3, operator="Brown University Dining Services"),
            building(4, operator="Rhode Island School of Design"),
            building(5),
        )
        result = classify_buildings(rows, ())
        assert result.direct_way_ids == (1, 2, 3)
        assert result.way_ids == (1, 2, 3)

    def test_catalog_institutional_kinds_classify_and_other_reports(self) -> None:
        rows = (building(10), building(11), building(12, hint=True))
        places = (
            place("sayles-hall", "academic", "way/10"),
            place("some-center", "other", "way/11"),
            place("a-quad", "outdoor", None),
        )
        result = classify_buildings(rows, places)
        assert result.catalog_way_ids == (10,)
        assert result.way_ids == (10,)
        assert result.place_ids == ("sayles-hall",)
        assert result.ambiguous_other_place_ids == ("some-center",)
        assert result.ambiguous_hint_way_ids == (12,)

    def test_the_hint_alone_never_classifies(self) -> None:
        rows = (building(20, name="Chace Center", hint=True, building_type="university"),)
        result = classify_buildings(rows, ())
        assert result.way_ids == ()
        assert result.ambiguous_hint_way_ids == (20,)

    def test_a_non_brown_operator_on_a_catalog_way_is_a_conflict(self) -> None:
        rows = (building(30, operator="Rhode Island School of Design"),)
        places = (place("mistaken-hall", "academic", "way/30"),)
        result = classify_buildings(rows, places)
        assert result.conflict_way_ids == (30,)
        assert result.way_ids == ()
        assert result.place_ids == ()

    def test_a_catalog_way_absent_from_the_export_is_gated_drift(self) -> None:
        rows = (building(50),)
        places = (place("ghost-hall", "academic", "way/51"),)
        result = classify_buildings(rows, places)
        assert result.way_ids == ()
        assert result.place_ids == ()
        assert result.catalog_ways_missing_from_export == (51,)

    def test_relation_backed_institutional_places_join_place_ids_only(self) -> None:
        rows = (building(40),)
        places = (
            place("kassar-like", "academic", "relation/900"),
            place("other-relation", "other", "relation/901"),
        )
        result = classify_buildings(rows, places)
        assert result.way_ids == ()
        assert result.place_ids == ("kassar-like",)


@pytest.fixture(scope="module")
def real_classification():
    rows = load_buildings_csv(CSV_PATH)
    build = build_catalog_from_files()
    return classify_buildings(rows, build.rows)


class TestRealAcceptance:
    def test_the_institutional_kind_set_is_exactly_the_plan_taxonomy_minus_other_and_outdoor(
        self,
    ) -> None:
        assert INSTITUTIONAL_KINDS == frozenset(
            {"academic", "residence", "dining", "athletic", "library", "admin"}
        )

    def test_the_drop_yields_140_brown_ways_and_142_places(
        self, real_classification
    ) -> None:
        assert len(real_classification.way_ids) == 140
        assert len(real_classification.place_ids) == 142
        assert real_classification.conflict_way_ids == ()

    @pytest.mark.parametrize(
        "way_id",
        [
            166668947,  # University Hall (catalog tier)
            176918226,  # BERT / 85 Waterman Street (enrichment footprint)
            141129271,  # Penner Field House (operator=Brown University)
            166668948,  # John Carter Brown Library (operator + catalog)
            425352336,  # Soldiers Memorial Gate (operator; catalog kind=other)
            177075298,  # Power Street Parking Structure (operator; no place)
        ],
    )
    def test_evidence_backed_ways_are_included(self, real_classification, way_id) -> None:
        assert way_id in real_classification.way_ids

    @pytest.mark.parametrize(
        "way_id",
        [
            1032446275,  # Chace Center — RISD, hint=true must not classify
            710679438,  # Wexford Innovation Complex — commercial
            185225906,  # 271 Thayer Street — retail
            141535672,  # Hospital Trust Building — RISD operator
            141567727,  # Metcalf Building — RISD, hint=true
        ],
    )
    def test_non_brown_and_ambiguous_ways_stay_out(
        self, real_classification, way_id
    ) -> None:
        assert way_id not in real_classification.way_ids

    def test_relation_backed_brown_places_are_carried_by_place_id(
        self, real_classification
    ) -> None:
        for place_id in ("barbour-hall", "kassar-house", "verney-woolley-dining-hall"):
            assert place_id in real_classification.place_ids

    def test_the_ambiguous_middle_is_reported_not_guessed(
        self, real_classification
    ) -> None:
        assert len(real_classification.ambiguous_hint_way_ids) == 17
        assert 1032446275 in real_classification.ambiguous_hint_way_ids  # Chace
        others = real_classification.ambiguous_other_place_ids
        assert len(others) == 13
        for place_id in ("chace-center", "stephen-robert-62-campus-center", "brown-risd-hillel"):
            assert place_id in others
        # soldiers-memorial-gate is kind=other but proven by its operator tag
        assert "soldiers-memorial-gate" in real_classification.place_ids
        assert "soldiers-memorial-gate" not in others


class TestSidecarDocument:
    def test_schema_v1_shape(self, real_classification) -> None:
        moment = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
        document = build_sidecar(real_classification, generated_at=moment)
        assert set(document) == BROWN_OWNED_SIDECAR_KEYS
        assert document["schema_version"] == 1
        assert document["generated_at"] == "2026-07-29T12:00:00Z"
        attribution = document["attribution"]
        assert "OpenStreetMap" in attribution and "ODbL" in attribution
        way_ids = document["osm_way_ids"]
        assert way_ids == sorted(way_ids)
        assert all(isinstance(way_id, int) for way_id in way_ids)
        place_ids = document["place_ids"]
        assert place_ids == sorted(place_ids)

    def test_a_naive_timestamp_is_rejected(self, real_classification) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            build_sidecar(real_classification, generated_at=datetime(2026, 7, 29))


class TestJob:
    def test_green_gates_publish_atomically(self, tmp_path: Path) -> None:
        sidecar_path = tmp_path / "seeds" / "brown_owned_buildings.json"
        result = run_brown_owned_buildings_job(
            csv_path=CSV_PATH,
            sidecar_path=sidecar_path,
            staging_root=tmp_path / "staging",
        )
        assert result.gate_failures == ()
        assert result.published_count == 140
        document = json.loads(sidecar_path.read_text(encoding="utf-8"))
        assert len(document["osm_way_ids"]) == 140
        assert len(document["place_ids"]) == 142
        assert not list((tmp_path / "staging").iterdir())

    def test_dry_run_writes_nothing(self, tmp_path: Path) -> None:
        result = run_brown_owned_buildings_job(
            csv_path=CSV_PATH,
            sidecar_path=None,
            staging_root=None,
        )
        assert result.gate_failures == ()
        assert result.published_count is None
        assert not list(tmp_path.iterdir())

    def test_publishing_without_a_staging_root_is_refused(
        self, tmp_path: Path
    ) -> None:
        with pytest.raises(ValueError, match="staging_root"):
            run_brown_owned_buildings_job(
                csv_path=CSV_PATH,
                sidecar_path=tmp_path / "sidecar.json",
                staging_root=None,
            )

    def test_an_evidence_free_export_fails_the_empty_classification_gate(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "no-evidence.csv"
        path.write_text(
            "osm_type,osm_id,name,brown_relevant_hint,building_type,operator,owner\n"
            "way,7,Some Building,false,yes,,\n",
            encoding="utf-8",
        )
        result = run_brown_owned_buildings_job(
            csv_path=path,
            sidecar_path=tmp_path / "sidecar.json",
            staging_root=tmp_path / "staging",
            min_rows=1,
        )
        assert any(
            failure.startswith("empty-classification")
            for failure in result.gate_failures
        )
        assert result.published_count is None
        assert not (tmp_path / "sidecar.json").exists()

    def test_a_failed_gate_never_touches_an_existing_sidecar(
        self, tmp_path: Path
    ) -> None:
        sidecar_path = tmp_path / "brown_owned_buildings.json"
        sidecar_path.write_text('{"previous": true}\n', encoding="utf-8")
        result = run_brown_owned_buildings_job(
            csv_path=CSV_PATH,
            sidecar_path=sidecar_path,
            staging_root=tmp_path / "staging",
            min_rows=99999,
        )
        assert result.gate_failures
        assert result.published_count is None
        assert sidecar_path.read_text(encoding="utf-8") == '{"previous": true}\n'


class TestSnapshotDrift:
    def test_the_two_overpass_snapshots_agree_way_for_way(self) -> None:
        csv_rows = load_buildings_csv(CSV_PATH)
        elements = load_overpass_elements(OVERPASS_PATH)
        drift = snapshot_drift(
            {row.way_id for row in csv_rows},
            {element["id"] for element in elements if element.get("type") == "way"},
        )
        assert drift.csv_only == ()
        assert drift.fixture_only == ()

    def test_every_catalog_way_is_present_in_both_snapshots(self) -> None:
        csv_ways = {row.way_id for row in load_buildings_csv(CSV_PATH)}
        fixture_ways = {
            element["id"]
            for element in load_overpass_elements(OVERPASS_PATH)
            if element.get("type") == "way"
        }
        for row in build_catalog_from_files().rows:
            if row.osm_id and row.osm_id.startswith("way/"):
                way_id = int(row.osm_id.split("/")[1])
                assert way_id in csv_ways, row.id
                assert way_id in fixture_ways, row.id


class TestPublishedSeeds:
    def test_the_committed_sidecar_matches_a_rebuild_except_generated_at(self) -> None:
        committed = json.loads(
            (SEEDS_DIR / "brown_owned_buildings.json").read_text(encoding="utf-8")
        )
        rows = load_buildings_csv(CSV_PATH)
        rebuilt = build_sidecar(classify_buildings(rows, build_catalog_from_files().rows))
        committed.pop("generated_at")
        rebuilt.pop("generated_at")
        assert committed == rebuilt

    def test_every_sidecar_place_id_is_a_published_place(self) -> None:
        committed = json.loads(
            (SEEDS_DIR / "brown_owned_buildings.json").read_text(encoding="utf-8")
        )
        published = {
            json.loads(line)["id"]
            for line in (SEEDS_DIR / "places.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        }
        missing = set(committed["place_ids"]) - published
        assert missing == set()
