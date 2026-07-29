"""The ingestion CLI: ``ingest run <job> --out ndjson|postgres``.

The job registry is dependency-injected and covers the jobs that EXIST on
this branch — ``places`` (gazetteer), ``cab`` (Fall 2026 course meetings),
``clubs`` (organizations + LiveWhale sidecar, Task 7 user-provided CSV),
``athletics`` (venue sidecar), ``buildings`` (Brown-owned buildings
sidecar, enrichment round), ``events`` (LiveWhale + registrar bootstrap
seeds, poller-parity). The remaining externally blocked source
(``dining``) is registered as a :class:`BlockedJob` entry so naming it
fails loudly with the documented reason, never a silent skip; ``run all``
runs the existing jobs in registry order and *reports* that declared gap.

Fail-closed exits: 0 only when every invoked job published (or upserted);
1 when a job gate-fails (source run ``partial``) or raises (``error``);
2 for usage-level refusals (unknown job, blocked job, unsupported
output combination, missing ``DATABASE_URL``, invalid contact).

Output modes:

- ``--out ndjson`` publishes seed files under ``db/seeds/``; a full
  ``run all`` then publishes ``db/seeds/manifest.json`` LAST (generation ID
  plus SHA-256 per artifact — see ``seeds_manifest.py``). Single-job runs
  never advance the manifest and say so.
- ``--out postgres`` is the documented hybrid: contract rows and source
  runs are upserted via :class:`PostgresRepository`; the athletics sidecar
  (and the dining notes) stay files because contract v1 has no database
  target for them. Explicit ``run athletics --out postgres`` is therefore
  rejected as unsupported; inside ``run all --out postgres`` the sidecar
  publishes as a file. The manifest describes the NDJSON seed bundle only
  and is not advanced by postgres runs.

Every invoked job runs inside exactly one Task 2B
:class:`SourceRunRecorder` lifecycle, sunk to ``db/seeds/source_runs.ndjson``
(ndjson mode — the handoff's documented extension log, outside the manifest)
or to the ``source_runs`` table (postgres mode).
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
import os
from pathlib import Path
import re
import tempfile
from typing import Callable, Iterator, Mapping, Optional

import typer

from brownsync_ingest.athletics_venues import run_athletics_venues_job
from brownsync_ingest.brown_owned_buildings import (
    DEFAULT_CSV_PATH as DEFAULT_BUILDINGS_CSV,
    run_brown_owned_buildings_job,
)
from brownsync_ingest.cab.job import run_cab_csv_job
from brownsync_ingest.clubs.job import run_clubs_job
from brownsync_ingest.common.http import utc_now
from brownsync_ingest.events.job import run_events_job
from brownsync_ingest.gazetteer.job import run_places_job
from brownsync_ingest.gazetteer.resolver import PlaceResolver
from brownsync_ingest.repository import PostgresRepository
from brownsync_ingest.run_log import NdjsonSourceRunLog, SourceRunRecorder, SourceRunSink
from brownsync_ingest.seeds_manifest import (
    publish_seeds_manifest,
    validate_seeds_manifest,
)


SOURCE_RUNS_NAME = "source_runs.ndjson"

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_PACKAGE_ROOT = Path(__file__).resolve().parent
_INGEST_ROOT = _PACKAGE_ROOT.parent
_REPO_ROOT = _INGEST_ROOT.parent

DEFAULT_SEEDS_DIR = _REPO_ROOT / "db" / "seeds"
DEFAULT_STAGING_ROOT = _REPO_ROOT / "reports" / "tmp"
DEFAULT_CAB_CSV = (
    _INGEST_ROOT / "fixtures" / "user_provided" / "brown_fall_2026_classes_and_locations.csv"
)
DEFAULT_CAB_REPORT = _REPO_ROOT / "reports" / "cab_fall_2026_place_resolution.md"
DEFAULT_ATHLETICS_ICS = _INGEST_ROOT / "fixtures" / "recorded" / "athletics" / "calendar.ics"
DEFAULT_CLUBS_CSV = (
    _INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"
)
DEFAULT_CLUBS_EVENTS_CSV = (
    _INGEST_ROOT / "fixtures" / "user_provided" / "brown_upcoming_events.csv"
)
DEFAULT_LIVEWHALE_GROUPS = (
    _INGEST_ROOT / "fixtures" / "recorded" / "livewhale" / "groups.json"
)
DEFAULT_CALENDAR_CSV = (
    _INGEST_ROOT
    / "fixtures"
    / "user_provided"
    / "brown_academic_calendar_2026_2027.csv"
)

DINING_BLOCKED_REASON = (
    "dining discovery is blocked: dining.brown.edu answers a Pantheon-edge "
    "HTTP 403 to the declared UA, so no discovery requests were sent — see "
    "ingest/dining/NOTES.md. Contract v1 has no dining-hours row and the "
    "six fixed dining places are already seeded in places.ndjson."
)


class OutFormat(str, Enum):
    ndjson = "ndjson"
    postgres = "postgres"


@dataclass(frozen=True)
class JobContext:
    """Everything a job runner may need; built once per CLI invocation."""

    out: str
    seeds_dir: Path
    staging_root: Path
    cab_csv_path: Path
    cab_report_path: Path
    athletics_ics_path: Path
    clubs_csv_path: Path = DEFAULT_CLUBS_CSV
    clubs_events_csv_path: Path = DEFAULT_CLUBS_EVENTS_CSV
    livewhale_groups_path: Path = DEFAULT_LIVEWHALE_GROUPS
    calendar_csv_path: Path = DEFAULT_CALENDAR_CSV
    buildings_csv_path: Path = DEFAULT_BUILDINGS_CSV
    aliases_path: Path | None = None
    overpass_path: Path | None = None
    contact: str | None = None
    repository: PostgresRepository | None = None


@dataclass(frozen=True)
class JobOutcome:
    """What one job run replaced, counted, and decided."""

    artifacts: tuple[str, ...] = ()  # seed files replaced (bare names)
    items: int = 0  # rows published or upserted
    gate_failures: tuple[str, ...] = ()  # non-empty means fail-closed, no output
    notes: tuple[str, ...] = ()  # loud lines (srcdb, attribution, ...)


JobRunner = Callable[[JobContext, SourceRunRecorder], JobOutcome]


@dataclass(frozen=True)
class JobSpec:
    """A runnable registry entry."""

    run: JobRunner
    # False: the job's only artifact is a file with no contract-v1 database
    # target (sidecars). Explicit `--out postgres` on it alone is rejected;
    # inside `run all --out postgres` it runs in the documented hybrid file
    # mode.
    postgres_target: bool = True


@dataclass(frozen=True)
class BlockedJob:
    """A declared, documented gap: naming it fails loudly with the reason."""

    reason: str


Registry = Mapping[str, JobSpec | BlockedJob]


@contextmanager
def _artifact_target(context: JobContext, name: str) -> Iterator[tuple[Path, Path]]:
    """Where a contract-row job should write its NDJSON file.

    In postgres mode the rows are upserted instead, so the file goes to a
    self-cleaning scratch directory — the seeds dir is never touched.
    """
    if context.out == OutFormat.postgres.value:
        with tempfile.TemporaryDirectory(prefix="brownsync-ingest-pg-") as scratch:
            root = Path(scratch)
            yield root / name, root / "staging"
    else:
        yield context.seeds_dir / name, context.staging_root


def _require_repository(context: JobContext) -> PostgresRepository:
    if context.repository is None:  # defended again at execute_run level
        raise RuntimeError("postgres output requires a connected repository")
    return context.repository


def _places_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    with _artifact_target(context, "places.ndjson") as (seeds_path, staging_root):
        result = run_places_job(
            seeds_path=seeds_path,
            staging_root=staging_root,
            aliases_path=context.aliases_path,
            overpass_path=context.overpass_path,
        )
    notes = [f"{len(result.rows)} validated places; {result.attribution}"]
    if result.gate_failures:
        return JobOutcome(gate_failures=result.gate_failures, notes=tuple(notes))
    if context.out == OutFormat.postgres.value:
        items = _require_repository(context).upsert_places(list(result.rows))
        artifacts: tuple[str, ...] = ()
        notes.append(f"upserted {items} places rows to Postgres")
    else:
        items = result.published_count or 0
        artifacts = ("places.ndjson",)
    return JobOutcome(artifacts=artifacts, items=items, notes=tuple(notes))


def _cab_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    resolver = PlaceResolver.from_files(context.aliases_path)
    with _artifact_target(context, "course_meetings.ndjson") as (seeds_path, staging_root):
        result = run_cab_csv_job(
            context.cab_csv_path,
            resolver=resolver,
            seeds_path=seeds_path,
            report_path=context.cab_report_path,
            staging_root=staging_root,
            generated_at=datetime.now(UTC).date().isoformat(),
        )
    srcdbs = sorted({row.srcdb for row in result.rows})
    notes = [
        # the discovered term database is logged loudly, pass or fail
        f"SRCDB discovered: {', '.join(srcdbs) if srcdbs else 'NONE'}",
        f"place-resolution report rendered: {context.cab_report_path}",
    ]
    gate_failures = tuple(
        f"{check.name}: actual {check.actual:g} vs required {check.required:g}"
        for check in result.gates.checks
        if not check.passed
    )
    if gate_failures:
        return JobOutcome(gate_failures=gate_failures, notes=tuple(notes))
    if context.out == OutFormat.postgres.value:
        items = _require_repository(context).upsert_course_meetings(list(result.rows))
        artifacts: tuple[str, ...] = ()
        notes.append(f"upserted {items} course_meetings rows to Postgres")
    else:
        items = result.published_count or 0
        artifacts = ("course_meetings.ndjson",)
    return JobOutcome(artifacts=artifacts, items=items, notes=tuple(notes))


def _clubs_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    resolver = PlaceResolver.from_files(context.aliases_path)
    with _artifact_target(context, "organizations.ndjson") as (seeds_path, staging_root):
        result = run_clubs_job(
            context.clubs_csv_path,
            groups_path=context.livewhale_groups_path,
            events_csv_path=context.clubs_events_csv_path,
            resolver=resolver,
            seeds_path=seeds_path,
            # the sidecar is a FILE in both modes (documented hybrid):
            # contract v1 has no database target for LiveWhale group links
            sidecar_path=context.seeds_dir / "organization_livewhale_groups.json",
            staging_root=staging_root,
            sidecar_staging_root=context.staging_root,
        )
    linked = [d for d in result.link_decisions if d.method is not None]
    unlinked = len(result.link_decisions) - len(linked)
    notes = [
        f"{len(result.rows)} validated organizations "
        f"({result.duplicates_dropped} duplicates dropped)",
        (
            f"LiveWhale linkage: {len(linked)} linked, {unlinked} reported "
            f"unlinked; sidecar mappings: {result.sidecar_mappings}"
        ),
        (
            "default_place_id awarded: "
            f"{sum(1 for e in result.default_place_evidence.values() if e.awarded)}; "
            f"recurring events emitted: {result.recurrence_emissions}"
        ),
    ]
    if result.unknown_vocabulary:
        notes.append(
            "unknown source vocabulary: " + ", ".join(result.unknown_vocabulary)
        )
    gate_failures = tuple(
        f"{check.name}: actual {check.actual:g} vs required {check.required:g}"
        for check in result.gates.checks
        if not check.passed
    )
    if gate_failures:
        return JobOutcome(gate_failures=gate_failures, notes=tuple(notes))
    if context.out == OutFormat.postgres.value:
        items = _require_repository(context).upsert_organizations(list(result.rows))
        artifacts: tuple[str, ...] = ("organization_livewhale_groups.json",)
        notes.append(f"upserted {items} organizations rows to Postgres")
    else:
        items = result.published_count or 0
        artifacts = ("organizations.ndjson", "organization_livewhale_groups.json")
    return JobOutcome(artifacts=artifacts, items=items, notes=tuple(notes))


def _athletics_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    # The sidecar is a FILE in both modes (documented hybrid): contract v1
    # has no database target for athletics venue mappings.
    result = run_athletics_venues_job(
        ics_path=context.athletics_ics_path,
        sidecar_path=context.seeds_dir / "athletics_venues.json",
        staging_root=context.staging_root,
        aliases_path=context.aliases_path,
    )
    exclusions = ", ".join(f"{reason}={count}" for reason, count in result.exclusion_counts)
    notes = (
        f"{len(result.home_venues)} observed home venues; exclusions: {exclusions or 'none'}",
    )
    if result.gate_failures:
        return JobOutcome(gate_failures=result.gate_failures, notes=notes)
    items = result.published_count or 0
    return JobOutcome(artifacts=("athletics_venues.json",), items=items, notes=notes)


def _buildings_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    # The sidecar is a FILE in both modes (documented hybrid): contract v1
    # has no database target for the Brown-owned buildings map tint. CLI
    # registration closes the enrichment round's recorded follow-up
    # (reports/app_side_dependencies.md §5) so the bundle manifest covers
    # brown_owned_buildings.json.
    result = run_brown_owned_buildings_job(
        csv_path=context.buildings_csv_path,
        sidecar_path=context.seeds_dir / "brown_owned_buildings.json",
        staging_root=context.staging_root,
        aliases_path=context.aliases_path,
        overpass_path=context.overpass_path,
    )
    classification = result.classification
    notes = (
        (
            f"{len(classification.way_ids)} Brown-owned ways "
            f"({len(classification.direct_way_ids)} operator/owner-direct, "
            f"{len(classification.catalog_way_ids)} catalog-backed); "
            f"{len(classification.place_ids)} place ids"
        ),
        (
            "ambiguous middle reported, not guessed: "
            f"{len(classification.ambiguous_hint_way_ids)} hint-only ways, "
            f"{len(classification.ambiguous_other_place_ids)} kind=other places"
        ),
    )
    if result.gate_failures:
        return JobOutcome(gate_failures=result.gate_failures, notes=notes)
    return JobOutcome(
        artifacts=("brown_owned_buildings.json",),
        items=result.published_count or 0,
        notes=notes,
    )


def _events_runner(context: JobContext, recorder: SourceRunRecorder) -> JobOutcome:
    resolver = PlaceResolver.from_files(context.aliases_path)
    with _artifact_target(context, "events.ndjson") as (seeds_path, staging_root):
        result = run_events_job(
            context.clubs_events_csv_path,
            context.calendar_csv_path,
            # the task-7 sidecar published in db/seeds is the org lookup,
            # exactly the file the TS poller reads (orgs.ts)
            org_groups_path=context.seeds_dir / "organization_livewhale_groups.json",
            resolver=resolver,
            seeds_path=seeds_path,
            staging_root=staging_root,
        )
    notes = [
        (
            f"{result.livewhale_count} livewhale + {result.admin_count} admin "
            f"(registrar) events; {result.coords_count} non-canceled with "
            f"coords; {result.canceled_count} canceled"
        ),
        (
            f"place resolution where coords absent: {result.place_resolved} "
            f"resolved {dict(result.resolution_methods)}, unresolved "
            f"{dict(result.unresolved_reasons)}; online-only "
            f"{result.online_only_count} never resolved"
        ),
        (
            f"org attribution via the task-7 sidecar: {result.org_attributed} "
            f"rows (sidecar mappings are the measured truth); dropped "
            f"published-contact columns: {dict(result.dropped_contact_counts)}"
        ),
        (
            f"registrar duplicates dropped: {result.registrar_duplicates_dropped}; "
            f"cross-source overlap (registrar ids also livewhale): "
            f"{result.cross_source_overlap} — canonical_id dedup is app-side"
        ),
    ]
    if result.unknown_event_types:
        notes.append(
            "unknown event_types (poller fall-through, reported): "
            + ", ".join(f"{value}={count}" for value, count in result.unknown_event_types)
        )
    gate_failures = tuple(
        f"{check.name}: actual {check.actual:g} vs required {check.required:g}"
        for check in result.gates.checks
        if not check.passed
    )
    if result.unknown_vocabulary:
        notes.append(
            "unknown source vocabulary: " + ", ".join(result.unknown_vocabulary)
        )
    if gate_failures:
        return JobOutcome(gate_failures=gate_failures, notes=tuple(notes))
    if context.out == OutFormat.postgres.value:
        items = _require_repository(context).upsert_events(list(result.rows))
        artifacts: tuple[str, ...] = ()
        notes.append(f"upserted {items} events rows to Postgres")
    else:
        items = result.published_count or 0
        artifacts = ("events.ndjson",)
    return JobOutcome(artifacts=artifacts, items=items, notes=tuple(notes))


def default_registry() -> dict[str, JobSpec | BlockedJob]:
    """Existing jobs in bundle order, then the documented blocked gaps."""
    return {
        "places": JobSpec(run=_places_runner),
        "cab": JobSpec(run=_cab_runner),
        "clubs": JobSpec(run=_clubs_runner),
        "athletics": JobSpec(run=_athletics_runner, postgres_target=False),
        "buildings": JobSpec(run=_buildings_runner, postgres_target=False),
        # events runs AFTER clubs: its org lookup reads the freshly
        # published organization_livewhale_groups.json sidecar
        "events": JobSpec(run=_events_runner),
        "dining": BlockedJob(reason=DINING_BLOCKED_REASON),
    }


class _RepositorySink:
    """Adapt PostgresRepository's lifecycle methods to the SourceRunSink shape."""

    def __init__(self, repository: PostgresRepository) -> None:
        self._repository = repository

    def start(self, source: str, started_at: datetime) -> int:
        return self._repository.start_source_run(source, started_at)

    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: str,
        items_upserted: int,
        error: str | None,
    ) -> None:
        self._repository.finish_source_run(
            run_id,
            finished_at=finished_at,
            status=status,  # type: ignore[arg-type]
            items_upserted=items_upserted,
            error=error,
        )


def _sink_for(context: JobContext) -> SourceRunSink:
    if context.out == OutFormat.postgres.value:
        return _RepositorySink(_require_repository(context))
    return NdjsonSourceRunLog(
        context.seeds_dir / SOURCE_RUNS_NAME, context.staging_root
    )


def _run_job(
    name: str,
    spec: JobSpec,
    context: JobContext,
    sink: SourceRunSink,
    echo: Callable[[str], None],
    error: Callable[[str], None],
) -> tuple[bool, JobOutcome | None]:
    """One job inside exactly one finalized source-run lifecycle."""
    echo(f"[{name}] starting (out={context.out})")
    try:
        with SourceRunRecorder(sink, name, clock=utc_now) as recorder:
            outcome = spec.run(context, recorder)
            for note in outcome.notes:
                echo(f"[{name}] {note}")
            if outcome.gate_failures:
                for failure in outcome.gate_failures:
                    recorder.mark_partial(failure)
                    error(f"[{name}] gate failed: {failure}")
                error(f"[{name}] fail-closed: nothing published, existing output untouched")
                return False, outcome
            recorder.add_items(outcome.items)
    except Exception as exc:  # the recorder has already finalized status=error
        error(f"[{name}] failed: {exc}")
        return False, None
    echo(f"[{name}] ok: {outcome.items} items")
    return True, outcome


def _report_gaps(registry: Registry, echo: Callable[[str], None]) -> None:
    for name, entry in registry.items():
        if isinstance(entry, BlockedJob):
            echo(f"[all] GAP {name}: {entry.reason}")


def _run_all(
    registry: Registry,
    context: JobContext,
    echo: Callable[[str], None],
    error: Callable[[str], None],
) -> int:
    sink = _sink_for(context)
    _report_gaps(registry, echo)
    artifact_names: list[str] = []
    for name, entry in registry.items():
        if isinstance(entry, BlockedJob):
            continue
        ok, outcome = _run_job(name, entry, context, sink, echo, error)
        if not ok:
            error(
                f"run all stopped at job {name!r}; the manifest was not "
                "advanced — the previous generation stays authoritative"
            )
            return 1
        assert outcome is not None
        artifact_names.extend(outcome.artifacts)
    if context.out == OutFormat.postgres.value:
        echo(
            "hybrid postgres run complete: contract rows and source runs "
            "upserted; sidecar files published; db/seeds/manifest.json "
            "describes the NDJSON bundle only and was not advanced — "
            "run `ingest run all --out ndjson` to republish it"
        )
        return 0
    document = publish_seeds_manifest(
        context.seeds_dir, artifact_names, context.staging_root
    )
    validation = validate_seeds_manifest(
        context.seeds_dir, expected_artifacts=artifact_names
    )
    if not validation.ok:
        for line in validation.errors:
            error(f"[manifest] {line}")
        return 1
    echo(
        f"[manifest] published last: generation {document['generation']} "
        f"covering {len(artifact_names)} artifacts"
    )
    return 0


def _run_single(
    job: str,
    registry: Registry,
    context: JobContext,
    echo: Callable[[str], None],
    error: Callable[[str], None],
) -> int:
    entry = registry.get(job)
    if entry is None:
        known = ", ".join([*registry, "all"])
        error(f"unknown job {job!r}; known jobs: {known}")
        return 2
    if isinstance(entry, BlockedJob):
        error(f"job {job!r} is blocked: {entry.reason}")
        return 2
    if context.out == OutFormat.postgres.value and not entry.postgres_target:
        error(
            f"unsupported combination: job {job!r} publishes only a file "
            "sidecar with no contract-v1 Postgres target. Use --out ndjson, "
            "or `ingest run all --out postgres` (documented hybrid: contract "
            "rows and source runs upsert, sidecar files still publish)."
        )
        return 2
    if context.out == OutFormat.postgres.value and context.repository is None:
        error("--out postgres requires DATABASE_URL (no repository connected)")
        return 2
    sink = _sink_for(context)
    ok, outcome = _run_job(job, entry, context, sink, echo, error)
    if not ok:
        return 1
    assert outcome is not None
    if outcome.artifacts and context.out == OutFormat.ndjson.value:
        echo(
            "note: single-job runs never advance the manifest; "
            "db/seeds/manifest.json will read as mixed until "
            "`ingest run all --out ndjson` republishes the bundle"
        )
    return 0


def execute_run(
    job: str,
    context: JobContext,
    *,
    registry: Registry | None = None,
    echo: Callable[[str], None] | None = None,
    error: Callable[[str], None] | None = None,
) -> int:
    """Run one job (or the ordered bundle) and return the process exit code."""
    echo = echo or typer.echo
    error = error or (lambda line: typer.secho(line, err=True, fg="red"))
    registry = registry if registry is not None else default_registry()

    if context.out not in {member.value for member in OutFormat}:
        error(f"unknown --out value {context.out!r}; use ndjson or postgres")
        return 2
    if context.contact is not None and not _EMAIL.fullmatch(context.contact):
        error(f"contact {context.contact!r} is not a valid email address")
        return 2
    if context.contact is not None:
        echo(
            f"contact for live acquisition: {context.contact} "
            f"(UA would be 'BrownSync/1.0 (+{context.contact})'); "
            "the registered jobs run offline from recorded evidence"
        )

    if job == "all":
        if context.out == OutFormat.postgres.value and context.repository is None:
            error("--out postgres requires DATABASE_URL (no repository connected)")
            return 2
        return _run_all(registry, context, echo, error)
    return _run_single(job, registry, context, echo, error)


app = typer.Typer(
    add_completion=False,
    help="BrownSync ingestion CLI: recorded evidence in, validated seeds out.",
)


@app.callback()
def main() -> None:
    """BrownSync ingestion command line."""


@app.command()
def run(
    job: str = typer.Argument(
        ...,
        help=(
            "places | cab | clubs | athletics | buildings | events | all "
            "(dining is a registered blocked gap and fails loudly)"
        ),
    ),
    out: OutFormat = typer.Option(
        OutFormat.ndjson,
        "--out",
        help=(
            "ndjson: publish seed files (run all also publishes the manifest "
            "last). postgres: documented hybrid — upsert contract rows and "
            "source runs (requires DATABASE_URL); sidecars stay files."
        ),
    ),
    seeds_dir: Path = typer.Option(DEFAULT_SEEDS_DIR, "--seeds-dir"),
    staging_root: Path = typer.Option(DEFAULT_STAGING_ROOT, "--staging-root"),
    cab_csv: Path = typer.Option(DEFAULT_CAB_CSV, "--cab-csv"),
    cab_report: Path = typer.Option(DEFAULT_CAB_REPORT, "--cab-report"),
    athletics_ics: Path = typer.Option(DEFAULT_ATHLETICS_ICS, "--athletics-ics"),
    clubs_csv: Path = typer.Option(DEFAULT_CLUBS_CSV, "--clubs-csv"),
    events_csv: Path = typer.Option(
        DEFAULT_CLUBS_EVENTS_CSV,
        "--events-csv",
        help=(
            "LiveWhale events snapshot: the events job's bootstrap source "
            "AND the clubs job's default-venue evidence."
        ),
    ),
    livewhale_groups: Path = typer.Option(
        DEFAULT_LIVEWHALE_GROUPS, "--livewhale-groups"
    ),
    calendar_csv: Path = typer.Option(
        DEFAULT_CALENDAR_CSV,
        "--calendar-csv",
        help="Registrar academic-calendar export (admin events).",
    ),
    buildings_csv: Path = typer.Option(
        DEFAULT_BUILDINGS_CSV,
        "--buildings-csv",
        help="Overpass building export backing the Brown-owned sidecar.",
    ),
    contact: Optional[str] = typer.Option(
        None,
        "--contact",
        envvar="BROWNSYNC_CONTACT",
        help="Contact email for the polite UA (required for live acquisition).",
    ),
) -> None:
    """Run one ingestion job, or `all` in order with a final manifest."""
    repository: PostgresRepository | None = None
    if out is OutFormat.postgres:
        registry = default_registry()
        entry = registry.get(job)
        needs_connection = not (
            isinstance(entry, JobSpec) and not entry.postgres_target
        )
        database_url = os.environ.get("DATABASE_URL")
        if needs_connection and not database_url:
            typer.secho(
                "--out postgres requires the DATABASE_URL environment "
                "variable (fail-closed; no database verification is claimed "
                "without credentials)",
                err=True,
                fg="red",
            )
            raise typer.Exit(2)
        if needs_connection and database_url:
            repository = PostgresRepository.connect(database_url)
    context = JobContext(
        out=out.value,
        seeds_dir=seeds_dir,
        staging_root=staging_root,
        cab_csv_path=cab_csv,
        cab_report_path=cab_report,
        athletics_ics_path=athletics_ics,
        clubs_csv_path=clubs_csv,
        clubs_events_csv_path=events_csv,
        livewhale_groups_path=livewhale_groups,
        calendar_csv_path=calendar_csv,
        buildings_csv_path=buildings_csv,
        contact=contact,
        repository=repository,
    )
    try:
        code = execute_run(job, context)
    finally:
        if repository is not None:
            repository.close()
    if code != 0:
        raise typer.Exit(code)
