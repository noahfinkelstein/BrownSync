"""Fault injection: interrupt bundle replacement after every artifact boundary.

The bundle replaces artifacts one file at a time (individually atomic, never
transactionally atomic) and publishes ``manifest.json`` LAST. These tests
interrupt a second-generation run after each possible artifact boundary and
prove, for every boundary:

1. the previous generation's manifest stays authoritative (byte-identical);
2. the validator detects the mixed set (replaced artifacts disagree);
3. a full rerun repairs every artifact BEFORE the manifest advances, after
   which the bundle validates clean at the new generation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brownsync_ingest.cli import (
    BlockedJob,
    JobContext,
    JobOutcome,
    JobSpec,
    execute_run,
)
from brownsync_ingest.seeds_manifest import (
    MANIFEST_NAME,
    artifact_sha256,
    validate_seeds_manifest,
)

ARTIFACTS = ("places.ndjson", "course_meetings.ndjson", "athletics_venues.json")


def make_context(tmp_path: Path) -> JobContext:
    return JobContext(
        out="ndjson",
        seeds_dir=tmp_path / "seeds",
        staging_root=tmp_path / "staging",
        cab_csv_path=tmp_path / "unused.csv",
        cab_report_path=tmp_path / "unused.md",
        athletics_ics_path=tmp_path / "unused.ics",
    )


def generation_registry(
    generation: str, *, fault_after: int | None = None
) -> dict[str, JobSpec | BlockedJob]:
    """Three artifact jobs; optionally raise right after the Nth replacement.

    ``fault_after=k`` interrupts the run at the boundary after artifact k has
    been atomically replaced (k=0 raises before any replacement).
    """

    def job(position: int, name: str) -> JobSpec:
        def run(context: JobContext, recorder: object) -> JobOutcome:
            if fault_after == position - 1:
                raise RuntimeError(f"injected fault before artifact {position}")
            context.seeds_dir.mkdir(parents=True, exist_ok=True)
            (context.seeds_dir / name).write_text(
                f"{name} content of generation {generation}\n", encoding="utf-8"
            )
            if fault_after == position:
                raise RuntimeError(f"injected fault after artifact {position}")
            return JobOutcome(artifacts=(name,), items=1)

        return JobSpec(run=run)

    return {
        f"job{position}": job(position, name)
        for position, name in enumerate(ARTIFACTS, start=1)
    }


def run_bundle(
    context: JobContext, registry: dict[str, JobSpec | BlockedJob]
) -> int:
    sink: list[str] = []
    return execute_run(
        "all", context, registry=registry, echo=sink.append, error=sink.append
    )


class TestEveryBoundary:
    @pytest.mark.parametrize("boundary", [1, 2, 3])
    def test_interrupt_after_each_artifact_keeps_previous_manifest_authoritative(
        self, tmp_path: Path, boundary: int
    ) -> None:
        context = make_context(tmp_path)

        # Generation A publishes cleanly.
        assert run_bundle(context, generation_registry("A")) == 0
        manifest_path = context.seeds_dir / MANIFEST_NAME
        manifest_a = manifest_path.read_bytes()
        generation_a = json.loads(manifest_a)["generation"]

        # Generation B is interrupted right after artifact `boundary`.
        code = run_bundle(
            context, generation_registry("B", fault_after=boundary)
        )
        assert code == 1

        # 1. The previous manifest is untouched, byte for byte.
        assert manifest_path.read_bytes() == manifest_a

        # 2. The validator rejects the mixed set: everything replaced so far
        #    disagrees with the authoritative generation-A manifest.
        validation = validate_seeds_manifest(
            context.seeds_dir, expected_artifacts=ARTIFACTS
        )
        assert not validation.ok
        assert validation.generation == generation_a
        mixed = [error for error in validation.errors if "mixed-generation" in error]
        assert len(mixed) == boundary
        for name in ARTIFACTS[:boundary]:
            assert any(name in error for error in mixed)
        # artifacts past the boundary still carry generation A content
        for name in ARTIFACTS[boundary:]:
            content = (context.seeds_dir / name).read_text(encoding="utf-8")
            assert "generation A" in content

        # 3. A full rerun repairs every artifact before the manifest advances.
        assert run_bundle(context, generation_registry("B")) == 0
        validation = validate_seeds_manifest(
            context.seeds_dir, expected_artifacts=ARTIFACTS
        )
        assert validation.ok, validation.errors
        assert validation.generation != generation_a
        for name in ARTIFACTS:
            content = (context.seeds_dir / name).read_text(encoding="utf-8")
            assert "generation B" in content
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
        for name in ARTIFACTS:
            assert document["artifacts"][name]["sha256"] == artifact_sha256(
                context.seeds_dir / name
            )

    def test_fault_before_any_replacement_leaves_the_bundle_fully_valid(
        self, tmp_path: Path
    ) -> None:
        context = make_context(tmp_path)
        assert run_bundle(context, generation_registry("A")) == 0
        manifest_before = (context.seeds_dir / MANIFEST_NAME).read_bytes()

        code = run_bundle(context, generation_registry("B", fault_after=0))
        assert code == 1
        assert (context.seeds_dir / MANIFEST_NAME).read_bytes() == manifest_before
        validation = validate_seeds_manifest(
            context.seeds_dir, expected_artifacts=ARTIFACTS
        )
        assert validation.ok, validation.errors

    def test_interrupted_runs_still_finalize_their_source_run_lifecycles(
        self, tmp_path: Path
    ) -> None:
        context = make_context(tmp_path)
        assert run_bundle(context, generation_registry("A")) == 0
        assert run_bundle(context, generation_registry("B", fault_after=2)) == 1
        runs = [
            json.loads(line)
            for line in (context.seeds_dir / "source_runs.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        statuses = [(run["source"], run["status"]) for run in runs]
        assert statuses == [
            ("job1", "ok"),
            ("job2", "ok"),
            ("job3", "ok"),
            ("job1", "ok"),
            ("job2", "error"),
        ]
