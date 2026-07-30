"""Deterministic, per-file atomic NDJSON publication."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Iterable, TypeVar

from pydantic import BaseModel

from brownsync_ingest.contract import EventRow


Row = TypeVar("Row", bound=BaseModel)


def model_identity(row: BaseModel) -> tuple[str, ...]:
    """Return the stable identity used for duplicate checks and output ordering."""
    row_id = getattr(row, "id", None)
    if row_id is not None:
        return ("id", str(row_id))
    if isinstance(row, EventRow):
        return ("event", row.source, row.source_id)
    raise ValueError("row has no publishable identity")


def publish_json_document(
    document: dict[str, object],
    destination: Path,
    staging_root: Path,
    *,
    compact: bool = False,
) -> None:
    """Atomically replace one JSON sidecar file.

    Same staging/fsync/replace discipline as :func:`publish_ndjson`;
    promoted from ``athletics_venues.py`` in Task 7 so every sidecar
    publisher shares one implementation. A serialization failure leaves any
    existing destination untouched and the staging root clean.

    Sidecars are pretty-printed by default because they are small and read by
    humans in review. ``compact=True`` is for artifacts the browser fetches —
    ``campus_buildings.geojson`` is 441 kB pretty and 319 kB compact, which is
    58 kB rather than 90 kB over the wire once gzipped.
    """
    destination = Path(destination)
    staging_root = Path(staging_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=staging_root,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as staging_file:
            staging_path = Path(staging_file.name)
            if compact:
                json.dump(
                    document,
                    staging_file,
                    separators=(",", ":"),
                    ensure_ascii=False,
                    allow_nan=False,
                )
            else:
                json.dump(
                    document, staging_file, indent=2, ensure_ascii=False, allow_nan=False
                )
            staging_file.write("\n")
            staging_file.flush()
            os.fsync(staging_file.fileno())
        os.replace(staging_path, destination)
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)


def publish_ndjson(
    rows: Iterable[Row | object],
    model_type: type[Row],
    destination: Path,
    staging_root: Path,
) -> int:
    """Validate, sort, and atomically replace one NDJSON destination file."""
    materialized = [model_type.model_validate(row) for row in rows]
    identified = [(model_identity(row), row) for row in materialized]
    identities = [identity for identity, _ in identified]
    if len(set(identities)) != len(identities):
        raise ValueError("duplicate row identity")
    identified.sort(key=lambda item: item[0])

    destination = Path(destination)
    staging_root = Path(staging_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)

    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=staging_root,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as staging_file:
            staging_path = Path(staging_file.name)
            for _, row in identified:
                json.dump(
                    row.model_dump(mode="json", exclude_none=True),
                    staging_file,
                    allow_nan=False,
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                staging_file.write("\n")
            staging_file.flush()
            os.fsync(staging_file.fileno())

        os.replace(staging_path, destination)
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)

    return len(materialized)
