"""The seed-bundle publication manifest (``db/seeds/manifest.json``).

Fixed seed files are individually atomic, never transactionally atomic as a
bundle (plan global constraint). The manifest is therefore published LAST,
after every artifact of a bundle run has been replaced, and records one
generation ID plus the SHA-256 and byte size of each artifact. A reader (or
the validator below) can then detect a *mixed* set: an interrupted newer
generation that replaced some artifacts but never reached the manifest
leaves hashes that disagree with the still-authoritative previous manifest.

``db/seeds/source_runs.ndjson`` is the Task 2B run-log extension, not a seed
artifact — it changes on every invocation and is deliberately outside the
manifest.

App-side manifest enforcement is a declared blocking dependency
(``reports/app_side_dependencies.md``); this module is the ingestion-side
publisher and validator only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Iterable, Mapping
from uuid import uuid4


MANIFEST_NAME = "manifest.json"
MANIFEST_SCHEMA_VERSION = 1

_REQUIRED_KEYS = frozenset({"schema_version", "generation", "generated_at", "artifacts"})
_REQUIRED_ARTIFACT_KEYS = frozenset({"sha256", "bytes"})


def artifact_sha256(path: Path) -> str:
    """The SHA-256 hex digest of one artifact file."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def publish_seeds_manifest(
    seeds_dir: Path | str,
    artifact_names: Iterable[str],
    staging_root: Path | str,
    *,
    generation: str | None = None,
    generated_at: str | None = None,
) -> dict[str, object]:
    """Hash every artifact, then atomically replace the manifest LAST.

    Every named artifact must already exist in ``seeds_dir`` — hashing reads
    the exact bytes that were published. A missing artifact raises before
    anything is written, leaving any previous manifest authoritative.
    """
    seeds_dir = Path(seeds_dir)
    staging_root = Path(staging_root)
    names = sorted(set(artifact_names))
    if not names:
        raise ValueError("a manifest must cover at least one artifact")

    artifacts: dict[str, dict[str, object]] = {}
    for name in names:
        if Path(name).name != name:
            raise ValueError(f"artifact name {name!r} must be a bare file name")
        path = seeds_dir / name
        if not path.is_file():
            raise FileNotFoundError(f"artifact {name!r} is not published in {seeds_dir}")
        artifacts[name] = {
            "sha256": artifact_sha256(path),
            "bytes": path.stat().st_size,
        }

    document: dict[str, object] = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "generation": generation or uuid4().hex,
        "generated_at": generated_at or _utc_timestamp(),
        "artifacts": artifacts,
    }

    seeds_dir.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)
    destination = seeds_dir / MANIFEST_NAME
    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=staging_root,
            prefix=f".{MANIFEST_NAME}.",
            suffix=".tmp",
            delete=False,
        ) as staging_file:
            staging_path = Path(staging_file.name)
            json.dump(document, staging_file, indent=2, ensure_ascii=False, allow_nan=False, sort_keys=True)
            staging_file.write("\n")
            staging_file.flush()
            os.fsync(staging_file.fileno())
        os.replace(staging_path, destination)
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)
    return document


@dataclass(frozen=True)
class ManifestValidation:
    """The outcome of checking the on-disk bundle against its manifest."""

    ok: bool
    errors: tuple[str, ...]
    generation: str | None  # the recorded (still authoritative) generation


def _schema_errors(document: object) -> list[str]:
    if not isinstance(document, dict):
        return ["manifest is not a JSON object"]
    errors: list[str] = []
    missing = _REQUIRED_KEYS - set(document)
    if missing:
        errors.append(f"manifest is missing keys: {sorted(missing)}")
    if document.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        errors.append(
            f"manifest schema_version must be {MANIFEST_SCHEMA_VERSION}, "
            f"got {document.get('schema_version')!r}"
        )
    generation = document.get("generation")
    if not isinstance(generation, str) or not generation:
        errors.append("manifest generation must be a non-empty string")
    generated_at = document.get("generated_at")
    if not isinstance(generated_at, str) or not generated_at:
        errors.append("manifest generated_at must be a non-empty string")
    artifacts = document.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        errors.append("manifest artifacts must be a non-empty object")
        return errors
    for name, entry in artifacts.items():
        if not isinstance(entry, Mapping) or _REQUIRED_ARTIFACT_KEYS - set(entry):
            errors.append(f"artifact {name!r} entry must carry sha256 and bytes")
            continue
        if not isinstance(entry["sha256"], str) or len(entry["sha256"]) != 64:
            errors.append(f"artifact {name!r} sha256 must be a 64-hex-digit string")
        if not isinstance(entry["bytes"], int) or entry["bytes"] < 0:
            errors.append(f"artifact {name!r} bytes must be a non-negative integer")
    return errors


def validate_seeds_manifest(
    seeds_dir: Path | str,
    *,
    expected_artifacts: Iterable[str] | None = None,
) -> ManifestValidation:
    """Check every recorded artifact against the bytes actually on disk.

    A hash mismatch means a newer generation replaced that artifact without
    reaching the manifest — a mixed set, rejected. When
    ``expected_artifacts`` is given, the manifest must cover exactly those
    names (a bundle run's self-check).
    """
    seeds_dir = Path(seeds_dir)
    manifest_path = seeds_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return ManifestValidation(
            ok=False,
            errors=(f"manifest is missing: {manifest_path}",),
            generation=None,
        )
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return ManifestValidation(
            ok=False, errors=(f"manifest is unreadable: {exc}",), generation=None
        )

    errors = _schema_errors(document)
    generation = (
        document.get("generation") if isinstance(document, dict) else None
    )
    if not isinstance(generation, str) or not generation:
        generation = None
    if errors:
        return ManifestValidation(ok=False, errors=tuple(errors), generation=generation)

    artifacts: dict[str, dict[str, object]] = document["artifacts"]
    if expected_artifacts is not None:
        expected = sorted(set(expected_artifacts))
        recorded = sorted(artifacts)
        if expected != recorded:
            errors.append(
                f"manifest artifacts {recorded} do not match expected {expected}"
            )
    for name in sorted(artifacts):
        entry = artifacts[name]
        path = seeds_dir / name
        if not path.is_file():
            errors.append(f"artifact {name!r} is recorded but missing on disk")
            continue
        actual_sha = artifact_sha256(path)
        actual_bytes = path.stat().st_size
        if actual_sha != entry["sha256"] or actual_bytes != entry["bytes"]:
            errors.append(
                f"mixed-generation bundle: artifact {name!r} on disk "
                f"(sha256 {actual_sha[:12]}…, {actual_bytes} bytes) disagrees with "
                f"manifest generation {generation!r} "
                f"(sha256 {str(entry['sha256'])[:12]}…, {entry['bytes']} bytes)"
            )
    return ManifestValidation(
        ok=not errors, errors=tuple(errors), generation=generation
    )
