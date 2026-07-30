"""Offline integration: the real CLI, real fixtures, one full bundle run.

``ingest run all --out ndjson`` is driven through :func:`execute_run` with the
default registry against the recorded Overpass/athletics fixtures and the
user-provided Fall 2026 CAB export, into a temporary seeds directory. The
published bundle is then validated end to end: contract rows, unique sorted
identities, place-id foreign keys, sidecar schema v1, gate minima (including
the signed-off 1,500-row CAB revision), WKT for every non-null polygon,
manifest generation/hashes, exactly one finalized ``ok`` source run per job,
and no staged leftovers beyond the run-log lock.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from brownsync_ingest.cli import JobContext, execute_run
from brownsync_ingest.contract import (
    CourseMeetingRow,
    EventRow,
    OrganizationRow,
    PlaceRow,
)
from brownsync_ingest.gazetteer.geometry import parse_multipolygon_wkt
from brownsync_ingest.output import model_identity
from brownsync_ingest.seeds_manifest import MANIFEST_NAME, validate_seeds_manifest

INGEST_ROOT = Path(__file__).resolve().parents[1]
REAL_CSV = (
    INGEST_ROOT / "fixtures" / "user_provided" / "brown_fall_2026_classes_and_locations.csv"
)
REAL_ICS = INGEST_ROOT / "fixtures" / "recorded" / "athletics" / "calendar.ics"

SEED_ARTIFACTS = (
    "places.ndjson",
    "course_meetings.ndjson",
    "organizations.ndjson",
    "organization_livewhale_groups.json",
    "athletics_venues.json",
    "brown_owned_buildings.json",
    "events.ndjson",
)
DINING_IDS = {
    "sharpe-refectory",  # Ratty
    "andrews-commons",
    "verney-woolley-dining-hall",  # V-Dub
    "blue-room",
    "ivy-room",
    "josiahs",  # Jo's
}


@dataclass(frozen=True)
class BundleRun:
    code: int
    out: tuple[str, ...]
    err: tuple[str, ...]
    seeds_dir: Path
    staging_root: Path


@pytest.fixture(scope="module")
def bundle(tmp_path_factory: pytest.TempPathFactory) -> BundleRun:
    """One real `run all --out ndjson` shared by every assertion below."""
    root = tmp_path_factory.mktemp("offline-bundle")
    context = JobContext(
        out="ndjson",
        seeds_dir=root / "seeds",
        staging_root=root / "staging",
        cab_csv_path=REAL_CSV,
        cab_report_path=root / "reports" / "cab_fall_2026_place_resolution.md",
        athletics_ics_path=REAL_ICS,
    )
    out: list[str] = []
    err: list[str] = []
    code = execute_run("all", context, echo=out.append, error=err.append)
    return BundleRun(
        code=code,
        out=tuple(out),
        err=tuple(err),
        seeds_dir=context.seeds_dir,
        staging_root=context.staging_root,
    )


def read_ndjson(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


@pytest.fixture(scope="module")
def places(bundle: BundleRun) -> list[PlaceRow]:
    return [
        PlaceRow.model_validate(payload)
        for payload in read_ndjson(bundle.seeds_dir / "places.ndjson")
    ]


@pytest.fixture(scope="module")
def meetings(bundle: BundleRun) -> list[CourseMeetingRow]:
    return [
        CourseMeetingRow.model_validate(payload)
        for payload in read_ndjson(bundle.seeds_dir / "course_meetings.ndjson")
    ]


@pytest.fixture(scope="module")
def organizations(bundle: BundleRun) -> list[OrganizationRow]:
    return [
        OrganizationRow.model_validate(payload)
        for payload in read_ndjson(bundle.seeds_dir / "organizations.ndjson")
    ]


@pytest.fixture(scope="module")
def sidecar(bundle: BundleRun) -> dict[str, object]:
    return json.loads(
        (bundle.seeds_dir / "athletics_venues.json").read_text(encoding="utf-8")
    )


@pytest.fixture(scope="module")
def org_sidecar(bundle: BundleRun) -> dict[str, object]:
    return json.loads(
        (bundle.seeds_dir / "organization_livewhale_groups.json").read_text(
            encoding="utf-8"
        )
    )


@pytest.fixture(scope="module")
def buildings_sidecar(bundle: BundleRun) -> dict[str, object]:
    return json.loads(
        (bundle.seeds_dir / "brown_owned_buildings.json").read_text(
            encoding="utf-8"
        )
    )


@pytest.fixture(scope="module")
def events(bundle: BundleRun) -> list[EventRow]:
    return [
        EventRow.model_validate(payload)
        for payload in read_ndjson(bundle.seeds_dir / "events.ndjson")
    ]


class TestBundleRun:
    def test_run_all_succeeds_and_reports_the_declared_gaps(
        self, bundle: BundleRun
    ) -> None:
        assert bundle.code == 0, bundle.err
        gap_lines = [line for line in bundle.out if "GAP" in line]
        # clubs became a real job in Task 7; dining is the only gap left
        assert not any("clubs" in line for line in gap_lines)
        assert any("dining" in line and "403" in line for line in gap_lines)

    def test_every_seed_artifact_is_published(self, bundle: BundleRun) -> None:
        for name in SEED_ARTIFACTS:
            assert (bundle.seeds_dir / name).is_file(), name

    def test_srcdb_is_logged_loudly(self, bundle: BundleRun) -> None:
        assert any("SRCDB discovered: 202610" in line for line in bundle.out)

    def test_osm_attribution_is_loud(self, bundle: BundleRun) -> None:
        assert any("OpenStreetMap" in line for line in bundle.out)


class TestContractRows:
    def test_places_meet_the_gate_minimum_with_six_dining_places(
        self, places: list[PlaceRow]
    ) -> None:
        assert len(places) >= 120
        dining = {row.id for row in places if row.kind == "dining"}
        assert dining == DINING_IDS

    def test_course_meetings_meet_the_revised_minima(
        self, meetings: list[CourseMeetingRow]
    ) -> None:
        # 1,500-row revision signed off in Task 6B (export maximum is 1,828
        # physically-scheduled rows); >=50 subjects unchanged from the plan.
        assert len(meetings) >= 1500
        subjects = {row.course_code.split()[0] for row in meetings}
        assert len(subjects) >= 50

    def test_organizations_meet_the_gate_minimum(
        self, organizations: list[OrganizationRow]
    ) -> None:
        assert len(organizations) >= 400
        assert {row.kind for row in organizations} == {"club"}
        assert {row.source for row in organizations} == {"studentactivities", "gsc"}

    def test_events_meet_the_definition_of_done_gates(
        self, events: list[EventRow]
    ) -> None:
        livewhale = [row for row in events if row.source == "livewhale"]
        registrar = [row for row in events if row.source == "registrar"]
        assert {row.source for row in events} == {"livewhale", "registrar"}
        assert len(livewhale) >= 900
        assert len(registrar) >= 100
        # app handoff §4 DoD: >= 300 upcoming events with coords
        with_coords = [
            row
            for row in livewhale
            if row.lat is not None
            and row.lng is not None
            and not row.is_canceled
        ]
        assert len(with_coords) >= 300
        assert all(row.category == "admin" for row in registrar)
        assert all(row.is_all_day for row in registrar)

    def test_livewhale_event_source_ids_are_poller_shaped(
        self, events: list[EventRow]
    ) -> None:
        # the poller upserts on (source, source_id); ids must be id:epoch
        for row in events:
            if row.source != "livewhale":
                continue
            event_id, _, epoch = row.source_id.partition(":")
            assert event_id.isdigit() and epoch.isdigit(), row.source_id

    def test_no_published_contact_emails_in_events(
        self, bundle: BundleRun
    ) -> None:
        text = (bundle.seeds_dir / "events.ndjson").read_text(encoding="utf-8")
        for payload in read_ndjson(bundle.seeds_dir / "events.ndjson"):
            raw = payload.get("raw")
            if isinstance(raw, dict):
                assert "contact" not in raw
                assert "contact_emails" not in raw
        assert "contact_emails" not in text

    @pytest.mark.parametrize(
        "artifact",
        [
            "places.ndjson",
            "course_meetings.ndjson",
            "organizations.ndjson",
            "events.ndjson",
        ],
    )
    def test_identities_are_unique_and_sorted(
        self, bundle: BundleRun, artifact: str
    ) -> None:
        model = {
            "places.ndjson": PlaceRow,
            "course_meetings.ndjson": CourseMeetingRow,
            "organizations.ndjson": OrganizationRow,
            "events.ndjson": EventRow,
        }[artifact]
        rows = [
            model.model_validate(payload)
            for payload in read_ndjson(bundle.seeds_dir / artifact)
        ]
        identities = [model_identity(row) for row in rows]
        assert len(set(identities)) == len(identities)
        assert identities == sorted(identities)

    def test_every_meeting_place_id_is_a_published_place(
        self, places: list[PlaceRow], meetings: list[CourseMeetingRow]
    ) -> None:
        place_ids = {row.id for row in places}
        placed = [row for row in meetings if row.place_id is not None]
        assert placed, "expected resolved meetings"
        missing = {row.place_id for row in placed} - place_ids
        assert missing == set()

    def test_every_organization_default_place_is_a_published_place(
        self, places: list[PlaceRow], organizations: list[OrganizationRow]
    ) -> None:
        place_ids = {row.id for row in places}
        defaults = {
            row.default_place_id
            for row in organizations
            if row.default_place_id is not None
        }
        assert defaults - place_ids == set()
        # measured Task 7 evidence outcome: no organization qualifies
        assert defaults == set()

    def test_every_event_place_id_is_a_published_place(
        self, places: list[PlaceRow], events: list[EventRow]
    ) -> None:
        place_ids = {row.id for row in places}
        placed = [row for row in events if row.place_id is not None]
        assert placed, "expected resolver-placed events"
        assert {row.place_id for row in placed} - place_ids == set()

    def test_every_event_org_id_is_a_published_organization(
        self, organizations: list[OrganizationRow], events: list[EventRow]
    ) -> None:
        org_ids = {row.id for row in organizations}
        attributed = {row.org_id for row in events if row.org_id is not None}
        assert attributed - org_ids == set()
        # measured Task 7 sidecar truth: no student group is a LiveWhale
        # publisher, so attribution is honestly zero in this bootstrap
        assert attributed == set()

    def test_every_nonnull_polygon_is_plain_multipolygon_wkt(
        self, places: list[PlaceRow]
    ) -> None:
        with_polygon = [row for row in places if row.polygon is not None]
        assert with_polygon, "expected OSM-backed footprints"
        for row in with_polygon:
            polygons = parse_multipolygon_wkt(row.polygon)
            assert polygons, row.id


class TestSidecar:
    def test_schema_v1_shape(self, sidecar: dict[str, object]) -> None:
        assert set(sidecar) == {"schema_version", "generated_at", "mappings"}
        assert sidecar["schema_version"] == 1
        assert isinstance(sidecar["generated_at"], str) and sidecar["generated_at"]
        assert isinstance(sidecar["mappings"], list) and sidecar["mappings"]
        for mapping in sidecar["mappings"]:
            assert set(mapping) == {"source_name", "place_id"}

    def test_every_mapping_place_id_is_a_published_place(
        self, sidecar: dict[str, object], places: list[PlaceRow]
    ) -> None:
        place_ids = {row.id for row in places}
        missing = {m["place_id"] for m in sidecar["mappings"]} - place_ids
        assert missing == set()


class TestOrganizationSidecar:
    def test_schema_v1_shape_with_the_measured_empty_mappings(
        self, org_sidecar: dict[str, object]
    ) -> None:
        assert set(org_sidecar) == {"schema_version", "generated_at", "mappings"}
        assert org_sidecar["schema_version"] == 1
        assert isinstance(org_sidecar["generated_at"], str) and org_sidecar["generated_at"]
        # Task 7 measured outcome: the 218 recorded LiveWhale groups are all
        # departments/offices — no student group links, and the empty list is
        # the explicit statement of that (consumers tolerate absence AND []).
        assert org_sidecar["mappings"] == []


class TestBuildingsSidecar:
    def test_schema_v1_shape(
        self, buildings_sidecar: dict[str, object]
    ) -> None:
        assert buildings_sidecar["schema_version"] == 1
        assert isinstance(buildings_sidecar.get("generated_at"), str)
        assert buildings_sidecar["osm_way_ids"], "expected Brown-owned ways"
        assert buildings_sidecar["place_ids"], "expected tinted place ids"
        attribution = json.dumps(buildings_sidecar)
        assert "OpenStreetMap" in attribution  # ODbL attribution present

    def test_every_sidecar_place_id_is_a_published_place(
        self, buildings_sidecar: dict[str, object], places: list[PlaceRow]
    ) -> None:
        place_ids = {row.id for row in places}
        missing = set(buildings_sidecar["place_ids"]) - place_ids
        assert missing == set()


class TestManifestAndRuns:
    def test_manifest_covers_exactly_the_seed_artifacts_with_true_hashes(
        self, bundle: BundleRun
    ) -> None:
        validation = validate_seeds_manifest(
            bundle.seeds_dir, expected_artifacts=SEED_ARTIFACTS
        )
        assert validation.ok, validation.errors
        assert validation.generation
        # independent recomputation, not through the validator
        document = json.loads(
            (bundle.seeds_dir / MANIFEST_NAME).read_text(encoding="utf-8")
        )
        for name in SEED_ARTIFACTS:
            path = bundle.seeds_dir / name
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            assert document["artifacts"][name]["sha256"] == digest
            assert document["artifacts"][name]["bytes"] == path.stat().st_size

    def test_source_runs_stay_outside_the_manifest(self, bundle: BundleRun) -> None:
        document = json.loads(
            (bundle.seeds_dir / MANIFEST_NAME).read_text(encoding="utf-8")
        )
        assert "source_runs.ndjson" not in document["artifacts"]

    def test_exactly_one_finalized_ok_run_per_job(self, bundle: BundleRun) -> None:
        runs = read_ndjson(bundle.seeds_dir / "source_runs.ndjson")
        assert [run["source"] for run in runs] == [
            "places",
            "cab",
            "clubs",
            "athletics",
            "buildings",
            "events",
        ]
        for run in runs:
            assert run["status"] == "ok"
            assert run["finished_at"]
            assert run["items_upserted"] > 0
            assert run.get("error") is None

    def test_no_staged_leftovers_beyond_the_run_log_lock(
        self, bundle: BundleRun
    ) -> None:
        leftovers = sorted(path.name for path in bundle.staging_root.iterdir())
        assert leftovers == [".source_runs.ndjson.lock"]
