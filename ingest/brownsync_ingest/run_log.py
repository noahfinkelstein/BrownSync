"""Source-run lifecycle recording: NDJSON extension log and context recorder."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import tempfile
from typing import Callable, Iterator, Literal, Protocol, runtime_checkable

from pydantic import ValidationError

from brownsync_ingest.contract import SourceRunRow


RunStatus = Literal["ok", "partial", "error"]

_ERROR_TEXT_LIMIT = 500


@runtime_checkable
class SourceRunSink(Protocol):
    """Anything that can persist the start and finish of one source run."""

    def start(self, source: str, started_at: datetime) -> int: ...

    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: RunStatus,
        items_upserted: int,
        error: str | None,
    ) -> None: ...


class NdjsonSourceRunLog:
    """Atomic NDJSON source-run history with monotonically increasing IDs."""

    def __init__(self, destination: Path, staging_root: Path) -> None:
        self._destination = Path(destination)
        self._staging_root = Path(staging_root)
        self._lock_path = self._staging_root / f".{self._destination.name}.lock"

    def start(self, source: str, started_at: datetime) -> int:
        row = SourceRunRow(source=source, started_at=started_at, status="partial")
        with self._locked():
            rows = self._read_rows()
            next_id = max((existing.id for existing in rows), default=0) + 1
            rows.append(row.model_copy(update={"id": next_id}))
            self._publish(rows)
            return next_id

    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: RunStatus,
        items_upserted: int,
        error: str | None,
    ) -> None:
        if items_upserted < 0:
            raise ValueError("items_upserted must be non-negative")
        with self._locked():
            rows = self._read_rows()
            matches = [index for index, row in enumerate(rows) if row.id == run_id]
            if len(matches) != 1:
                raise LookupError(f"source run {run_id} is not exactly once in history")
            existing = rows[matches[0]]
            rows[matches[0]] = SourceRunRow(
                id=run_id,
                source=existing.source,
                started_at=existing.started_at,
                finished_at=finished_at,
                status=status,
                items_upserted=items_upserted,
                error=error,
            )
            self._publish(rows)

    @contextmanager
    def _locked(self) -> Iterator[None]:
        self._staging_root.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self._lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)

    def _read_rows(self) -> list[SourceRunRow]:
        try:
            text = self._destination.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        rows: list[SourceRunRow] = []
        for line in text.splitlines():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"corrupt source-run history line: {line!r}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"corrupt source-run history line: {line!r}")
            try:
                row = SourceRunRow.model_validate(payload)
            except ValidationError as exc:
                raise ValueError(f"corrupt source-run history line: {line!r}") from exc
            if row.id is None or row.id < 1:
                raise ValueError(f"corrupt source-run history line: {line!r}")
            rows.append(row)
        identifiers = [row.id for row in rows]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("duplicate ids in source-run history")
        return rows

    def _publish(self, rows: list[SourceRunRow]) -> None:
        self._destination.parent.mkdir(parents=True, exist_ok=True)
        staging_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=self._staging_root,
                prefix=f".{self._destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as staging_file:
                staging_path = Path(staging_file.name)
                for row in rows:
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
            os.replace(staging_path, self._destination)
        finally:
            if staging_path is not None:
                staging_path.unlink(missing_ok=True)


class SourceRunRecorder:
    """Guarantee exactly one start and one finalizing finish per job run."""

    def __init__(
        self,
        sink: SourceRunSink,
        source: str,
        *,
        clock: Callable[[], datetime],
    ) -> None:
        self._sink = sink
        self._source = source
        self._clock = clock
        self._run_id: int | None = None
        self._items = 0
        self._partial_reasons: list[str] = []
        self._finished = False

    def __enter__(self) -> SourceRunRecorder:
        if self._run_id is not None or self._finished:
            raise RuntimeError("recorder already started; create a new recorder per run")
        self._run_id = self._sink.start(self._source, self._clock())
        return self

    def add_items(self, count: int) -> None:
        self._require_active()
        if count < 0:
            raise ValueError("item count must be non-negative")
        self._items += count

    def mark_partial(self, reason: str) -> None:
        self._require_active()
        if not reason.strip():
            raise ValueError("partial reason must be a non-empty string")
        self._partial_reasons.append(reason)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> bool:
        if self._run_id is None or self._finished:
            raise RuntimeError("recorder run is not active")
        self._finished = True
        if exc_type is not None:
            status: RunStatus = "error"
            text = str(exc) if exc is not None else ""
            error: str | None = (text or exc_type.__name__)[:_ERROR_TEXT_LIMIT]
        elif self._partial_reasons:
            status = "partial"
            error = "; ".join(self._partial_reasons)[:_ERROR_TEXT_LIMIT]
        else:
            status = "ok"
            error = None
        self._sink.finish(
            self._run_id,
            finished_at=self._clock(),
            status=status,
            items_upserted=self._items,
            error=error,
        )
        return False

    def _require_active(self) -> None:
        if self._run_id is None or self._finished:
            raise RuntimeError("recorder run is not active")
