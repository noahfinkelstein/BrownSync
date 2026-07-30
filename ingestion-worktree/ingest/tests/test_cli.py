"""CLI tests: registry, fail-closed exits, lifecycles, manifest ordering."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from brownsync_ingest.cli import (
    BlockedJob,
    JobContext,
    JobOutcome,
    JobSpec,
    SOURCE_RUNS_NAME,
    app,
    default_registry,
    execute_run,
)
from brownsync_ingest.seeds_manifest import MANIFEST_NAME, validate_seeds_manifest

INGEST_ROOT = Path(__file__).resolve().parents[1]
REAL_CSV = INGEST_ROOT / "fixtures" / "user_provided" / "brown_fall_2026_classes_and_locations.csv"
REAL_ICS = INGEST_ROOT / "fixtures" / "recorded" / "athletics" / "calendar.ics"

TINY_CSV_HEADER = (
    "term,term_code,course_code,course_title,section,crn,meeting_schedule,"
    "location,location_status,instructor,schedule_type_code,class_status,"
    "cab_status_code,cancelled,start_date,end_date,cab_schedule_and_location,"
    "source_url"
)
TINY_CSV_ROW = (
    "Fall 2026,202610,AFRI 0090,An Introduction to Africana Studies,S01,10001,"
    'TTh 10:30am-11:50am,Sayles Hall 105,Physical location published,K. Blain,'
    "S,Active,A,false,2026-09-09,2026-12-21,TTh 10:30am-11:50am in Sayles Hall 105,"
    "https://cab.brown.edu/"
)


def make_context(tmp_path: Path, **overrides: object) -> JobContext:
    defaults: dict[str, object] = dict(
        out="ndjson",
        seeds_dir=tmp_path / "seeds",
        staging_root=tmp_path / "staging",
        cab_csv_path=REAL_CSV,
        cab_report_path=tmp_path / "reports" / "cab_place_resolution.md",
        athletics_ics_path=REAL_ICS,
    )
    defaults.update(overrides)
    return JobContext(**defaults)  # type: ignore[arg-type]


def artifact_job(name: str, content: str, calls: list[str] | None = None) -> JobSpec:
    def run(context: JobContext, recorder: object) -> JobOutcome:
        if calls is not None:
            calls.append(name)
        context.seeds_dir.mkdir(parents=True, exist_ok=True)
        (context.seeds_dir / name).write_text(content, encoding="utf-8")
        return JobOutcome(artifacts=(name,), items=1)

    return JobSpec(run=run)


def failing_gate_job(reason: str) -> JobSpec:
    def run(context: JobContext, recorder: object) -> JobOutcome:
        return JobOutcome(gate_failures=(reason,))

    return JobSpec(run=run)


def raising_job(message: str) -> JobSpec:
    def run(context: JobContext, recorder: object) -> JobOutcome:
        raise RuntimeError(message)

    return JobSpec(run=run)


def read_runs(context: JobContext) -> list[dict[str, object]]:
    path = context.seeds_dir / SOURCE_RUNS_NAME
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def run_cli(
    job: str, context: JobContext, registry: dict[str, JobSpec | BlockedJob] | None = None
) -> tuple[int, list[str], list[str]]:
    out: list[str] = []
    err: list[str] = []
    code = execute_run(job, context, registry=registry, echo=out.append, error=err.append)
    return code, out, err


class TestDefaultRegistry:
    def test_covers_existing_jobs_in_bundle_order_then_blocked_gaps(self) -> None:
        registry = default_registry()
        # clubs became a real job in Task 7 (user-provided CSV); dining stays
        # the sole documented blocked gap.
        assert list(registry) == [
            "places",
            "cab",
            "clubs",
            "athletics",
            "buildings",
            "events",
            "dining",
        ]
        assert isinstance(registry["places"], JobSpec)
        assert isinstance(registry["cab"], JobSpec)
        assert isinstance(registry["clubs"], JobSpec)
        assert isinstance(registry["athletics"], JobSpec)
        assert isinstance(registry["buildings"], JobSpec)
        assert isinstance(registry["events"], JobSpec)
        assert isinstance(registry["dining"], BlockedJob)

    def test_events_runs_after_clubs_which_publishes_its_org_sidecar(
        self,
    ) -> None:
        names = list(default_registry())
        assert names.index("events") > names.index("clubs")

    def test_file_only_sidecar_jobs_have_no_postgres_target(self) -> None:
        registry = default_registry()
        assert registry["athletics"].postgres_target is False
        assert registry["buildings"].postgres_target is False
        assert registry["places"].postgres_target is True
        assert registry["cab"].postgres_target is True
        assert registry["events"].postgres_target is True
        # organizations upsert to Postgres; the sidecar stays a file (hybrid)
        assert registry["clubs"].postgres_target is True

    def test_blocked_reasons_are_the_documented_ones(self) -> None:
        registry = default_registry()
        dining = registry["dining"].reason
        assert "dining" in dining
        assert "403" in dining
        assert "ingest/dining/NOTES.md" in dining


class TestSingleJob:
    def test_success_publishes_and_finalizes_one_ok_run(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        registry = {"fake": artifact_job("fake.ndjson", "{}\n")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 0
        assert (context.seeds_dir / "fake.ndjson").read_text(encoding="utf-8") == "{}\n"
        runs = read_runs(context)
        assert len(runs) == 1
        assert runs[0]["source"] == "fake"
        assert runs[0]["status"] == "ok"
        assert runs[0]["items_upserted"] == 1
        assert "finished_at" in runs[0]

    def test_single_job_never_advances_the_manifest_and_warns(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        registry = {"fake": artifact_job("fake.ndjson", "{}\n")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 0
        assert not (context.seeds_dir / MANIFEST_NAME).exists()
        assert any("manifest" in line and "run all" in line for line in out)

    def test_gate_failure_is_fail_closed_partial(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        registry = {"fake": failing_gate_job("rows: 3 < required 100")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 1
        assert any("rows: 3 < required 100" in line for line in err)
        runs = read_runs(context)
        assert len(runs) == 1
        assert runs[0]["status"] == "partial"
        assert "rows: 3 < required 100" in runs[0]["error"]
        assert runs[0]["items_upserted"] == 0

    def test_exception_finalizes_exactly_one_error_run(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        registry = {"fake": raising_job("boom")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 1
        assert any("boom" in line for line in err)
        runs = read_runs(context)
        assert len(runs) == 1
        assert runs[0]["status"] == "error"
        assert "boom" in runs[0]["error"]

    def test_unknown_job_fails_loudly_listing_known_jobs(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        code, out, err = run_cli("nonsense", context)
        assert code == 2
        assert any("nonsense" in line for line in err)
        assert any("places" in line and "cab" in line for line in err)
        assert read_runs(context) == []

    def test_blocked_job_named_explicitly_fails_with_documented_reason(
        self, tmp_path: Path
    ) -> None:
        context = make_context(tmp_path)
        code, out, err = run_cli("dining", context)
        assert code == 2
        assert any("blocked" in line for line in err)
        assert any("403" in line for line in err)
        assert read_runs(context) == []


class TestOutputModes:
    def test_postgres_out_without_repository_fails_closed(self, tmp_path: Path) -> None:
        context = make_context(tmp_path, out="postgres")
        registry = {"fake": artifact_job("fake.ndjson", "{}\n")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 2
        assert any("DATABASE_URL" in line for line in err)

    def test_athletics_out_postgres_is_an_unsupported_combination(
        self, tmp_path: Path
    ) -> None:
        context = make_context(tmp_path, out="postgres")
        code, out, err = run_cli("athletics", context)
        assert code == 2
        assert any("unsupported" in line.lower() for line in err)
        assert any("sidecar" in line or "file" in line for line in err)

    def test_unknown_out_value_is_rejected(self, tmp_path: Path) -> None:
        context = make_context(tmp_path, out="parquet")
        code, out, err = run_cli("places", context)
        assert code == 2

    def test_invalid_contact_is_rejected(self, tmp_path: Path) -> None:
        context = make_context(tmp_path, contact="not-an-email")
        registry = {"fake": artifact_job("fake.ndjson", "{}\n")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 2
        assert any("contact" in line for line in err)

    def test_valid_contact_is_echoed_into_the_run(self, tmp_path: Path) -> None:
        context = make_context(tmp_path, contact="noah_finkelstein@brown.edu")
        registry = {"fake": artifact_job("fake.ndjson", "{}\n")}
        code, out, err = run_cli("fake", context, registry)
        assert code == 0
        assert any("noah_finkelstein@brown.edu" in line for line in out)


class TestRunAll:
    def registry(self, calls: list[str]) -> dict[str, JobSpec | BlockedJob]:
        return {
            "one": artifact_job("one.ndjson", "1\n", calls),
            "two": artifact_job("two.ndjson", "2\n", calls),
            "three": artifact_job("three.json", "3\n", calls),
            "clubs": BlockedJob(reason="clubs blocked: 403 (documented)"),
            "dining": BlockedJob(reason="dining blocked: 403 (documented)"),
        }

    def test_runs_every_existing_job_in_order_and_reports_gaps(
        self, tmp_path: Path
    ) -> None:
        calls: list[str] = []
        context = make_context(tmp_path)
        code, out, err = run_cli("all", context, self.registry(calls))
        assert code == 0
        assert calls == ["one.ndjson", "two.ndjson", "three.json"]
        gap_lines = [line for line in out if "GAP" in line]
        assert len(gap_lines) == 2
        assert any("clubs blocked: 403" in line for line in gap_lines)
        assert any("dining blocked: 403" in line for line in gap_lines)

    def test_publishes_manifest_last_covering_every_artifact(
        self, tmp_path: Path
    ) -> None:
        calls: list[str] = []
        context = make_context(tmp_path)
        code, out, err = run_cli("all", context, self.registry(calls))
        assert code == 0
        validation = validate_seeds_manifest(
            context.seeds_dir,
            expected_artifacts=["one.ndjson", "two.ndjson", "three.json"],
        )
        assert validation.ok, validation.errors
        assert any("generation" in line for line in out)

    def test_one_finalized_lifecycle_per_constituent_job(self, tmp_path: Path) -> None:
        calls: list[str] = []
        context = make_context(tmp_path)
        code, out, err = run_cli("all", context, self.registry(calls))
        assert code == 0
        runs = read_runs(context)
        assert [run["source"] for run in runs] == ["one", "two", "three"]
        assert all(run["status"] == "ok" for run in runs)
        assert all("finished_at" in run for run in runs)

    def test_stops_at_first_failure_without_advancing_the_manifest(
        self, tmp_path: Path
    ) -> None:
        calls: list[str] = []
        registry = self.registry(calls)
        registry["two"] = failing_gate_job("rows: 0 < required 1")
        context = make_context(tmp_path)
        code, out, err = run_cli("all", context, registry)
        assert code == 1
        assert calls == ["one.ndjson"]  # "two" gate-failed, "three" never ran
        assert not (context.seeds_dir / MANIFEST_NAME).exists()
        runs = read_runs(context)
        assert [run["source"] for run in runs] == ["one", "two"]
        assert [run["status"] for run in runs] == ["ok", "partial"]
        # the gaps are still reported even on a failing run
        assert any("GAP" in line for line in out)

    def test_exception_in_a_constituent_job_finalizes_error_and_stops(
        self, tmp_path: Path
    ) -> None:
        calls: list[str] = []
        registry = self.registry(calls)
        registry["three"] = raising_job("kaput")
        context = make_context(tmp_path)
        code, out, err = run_cli("all", context, registry)
        assert code == 1
        assert not (context.seeds_dir / MANIFEST_NAME).exists()
        runs = read_runs(context)
        assert [run["status"] for run in runs] == ["ok", "ok", "error"]


class TestRealRunners:
    def test_places_publishes_the_gazetteer(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        code, out, err = run_cli("places", context)
        assert code == 0
        lines = (
            (context.seeds_dir / "places.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        )
        assert len(lines) >= 120
        runs = read_runs(context)
        assert runs[0]["source"] == "places"
        assert runs[0]["items_upserted"] == len(lines)
        # ODbL attribution is loud
        assert any("OpenStreetMap" in line for line in out)

    def test_cab_logs_srcdb_loudly_and_fails_closed_below_gates(
        self, tmp_path: Path
    ) -> None:
        tiny = tmp_path / "tiny.csv"
        tiny.write_text(TINY_CSV_HEADER + "\n" + TINY_CSV_ROW + "\n", encoding="utf-8")
        context = make_context(tmp_path, cab_csv_path=tiny)
        code, out, err = run_cli("cab", context)
        assert code == 1
        assert any("SRCDB discovered: 202610" in line for line in out)
        assert not (context.seeds_dir / "course_meetings.ndjson").exists()
        assert context.cab_report_path.is_file()
        runs = read_runs(context)
        assert runs[0]["source"] == "cab"
        assert runs[0]["status"] == "partial"
        assert "meeting-rows" in runs[0]["error"]

    def test_clubs_publishes_organizations_and_the_sidecar(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        code, out, err = run_cli("clubs", context)
        assert code == 0, err
        lines = (
            (context.seeds_dir / "organizations.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        )
        assert len(lines) == 457
        document = json.loads(
            (context.seeds_dir / "organization_livewhale_groups.json").read_text(
                encoding="utf-8"
            )
        )
        assert document["schema_version"] == 1
        assert document["mappings"] == []  # measured: no club is a LW publisher
        runs = read_runs(context)
        assert runs[0]["source"] == "clubs"
        assert runs[0]["status"] == "ok"
        assert runs[0]["items_upserted"] == 457
        # linkage statistics are logged loudly
        assert any("linkage" in line for line in out)

    def test_athletics_publishes_the_sidecar(self, tmp_path: Path) -> None:
        context = make_context(tmp_path)
        code, out, err = run_cli("athletics", context)
        assert code == 0
        document = json.loads(
            (context.seeds_dir / "athletics_venues.json").read_text(encoding="utf-8")
        )
        assert document["schema_version"] == 1
        assert len(document["mappings"]) == 11
        runs = read_runs(context)
        assert runs[0]["status"] == "ok"
        assert runs[0]["items_upserted"] == 11


class TestTyperSurface:
    def test_run_command_wires_options_through(self, tmp_path: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(
            app,
            [
                "run",
                "athletics",
                "--out",
                "ndjson",
                "--seeds-dir",
                str(tmp_path / "seeds"),
                "--staging-root",
                str(tmp_path / "staging"),
                "--athletics-ics",
                str(REAL_ICS),
            ],
        )
        assert result.exit_code == 0, result.output
        assert (tmp_path / "seeds" / "athletics_venues.json").is_file()

    def test_out_postgres_without_database_url_fails_closed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        runner = CliRunner()
        result = runner.invoke(
            app,
            [
                "run",
                "places",
                "--out",
                "postgres",
                "--seeds-dir",
                str(tmp_path / "seeds"),
                "--staging-root",
                str(tmp_path / "staging"),
            ],
        )
        assert result.exit_code == 2
        assert "DATABASE_URL" in result.output

    def test_rejects_unknown_out_value(self, tmp_path: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["run", "places", "--out", "parquet"])
        assert result.exit_code != 0
