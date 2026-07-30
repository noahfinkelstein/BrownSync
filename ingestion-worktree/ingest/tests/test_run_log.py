from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import threading
from typing import Callable, Iterator

import pytest

from brownsync_ingest import run_log
from brownsync_ingest.contract import SourceRunRow
from brownsync_ingest.run_log import NdjsonSourceRunLog, SourceRunRecorder


T0 = datetime(2026, 9, 1, 6, 0, tzinfo=UTC)
T1 = datetime(2026, 9, 1, 6, 5, tzinfo=UTC)
T2 = datetime(2026, 9, 1, 6, 10, tzinfo=UTC)


class FakeSink:
    def __init__(self, next_id: int = 7) -> None:
        self.next_id = next_id
        self.start_calls: list[tuple[str, datetime]] = []
        self.finish_calls: list[dict[str, object]] = []

    def start(self, source: str, started_at: datetime) -> int:
        self.start_calls.append((source, started_at))
        return self.next_id

    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: str,
        items_upserted: int,
        error: str | None,
    ) -> None:
        self.finish_calls.append(
            {
                "run_id": run_id,
                "finished_at": finished_at,
                "status": status,
                "items_upserted": items_upserted,
                "error": error,
            }
        )


def make_clock(*times: datetime) -> Callable[[], datetime]:
    iterator: Iterator[datetime] = iter(times)
    return lambda: next(iterator)


def history_line(row: SourceRunRow) -> str:
    return json.dumps(
        row.model_dump(mode="json", exclude_none=True),
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def read_rows(destination: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in destination.read_text(encoding="utf-8").splitlines()
    ]


# --- SourceRunRecorder -------------------------------------------------------


def test_recorder_success_records_exactly_one_ok_lifecycle() -> None:
    sink = FakeSink(next_id=7)

    with SourceRunRecorder(sink, "livewhale", clock=make_clock(T0, T1)) as recorder:
        recorder.add_items(2)
        recorder.add_items(3)

    assert sink.start_calls == [("livewhale", T0)]
    assert sink.finish_calls == [
        {
            "run_id": 7,
            "finished_at": T1,
            "status": "ok",
            "items_upserted": 5,
            "error": None,
        }
    ]


def test_recorder_mark_partial_finalizes_partial_with_joined_reasons() -> None:
    sink = FakeSink()

    with SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1)) as recorder:
        recorder.add_items(1)
        recorder.mark_partial("pagination stalled")
        recorder.mark_partial("details fetch failed")

    assert sink.finish_calls == [
        {
            "run_id": 7,
            "finished_at": T1,
            "status": "partial",
            "items_upserted": 1,
            "error": "pagination stalled; details fetch failed",
        }
    ]


def test_recorder_exception_finalizes_error_then_reraises() -> None:
    sink = FakeSink()

    with pytest.raises(RuntimeError, match="feed exploded"):
        with SourceRunRecorder(sink, "athletics_ics", clock=make_clock(T0, T1)) as recorder:
            recorder.add_items(4)
            raise RuntimeError("feed exploded")

    assert len(sink.start_calls) == 1
    assert sink.finish_calls == [
        {
            "run_id": 7,
            "finished_at": T1,
            "status": "error",
            "items_upserted": 4,
            "error": "feed exploded",
        }
    ]


def test_recorder_bounds_long_exception_text() -> None:
    sink = FakeSink()

    with pytest.raises(ValueError):
        with SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1)):
            raise ValueError("x" * 10_000)

    error = sink.finish_calls[0]["error"]
    assert isinstance(error, str)
    assert len(error) == 500
    assert error == "x" * 500


def test_recorder_uses_exception_type_name_when_text_is_empty() -> None:
    class SilentError(Exception):
        def __str__(self) -> str:
            return ""

    sink = FakeSink()

    with pytest.raises(SilentError):
        with SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1)):
            raise SilentError()

    assert sink.finish_calls[0]["error"] == "SilentError"


def test_recorder_rejects_negative_item_counts_without_recording_them() -> None:
    sink = FakeSink()
    recorder = SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1))
    recorder.__enter__()

    with pytest.raises(ValueError, match="non-negative"):
        recorder.add_items(-1)

    recorder.__exit__(None, None, None)
    assert sink.finish_calls[0]["items_upserted"] == 0
    assert sink.finish_calls[0]["status"] == "ok"


def test_recorder_rejects_blank_partial_reasons() -> None:
    sink = FakeSink()
    recorder = SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1))
    recorder.__enter__()

    with pytest.raises(ValueError, match="reason"):
        recorder.mark_partial("   ")

    recorder.__exit__(None, None, None)
    assert sink.finish_calls[0]["status"] == "ok"


def test_recorder_requires_an_active_run_for_mutation() -> None:
    sink = FakeSink()
    recorder = SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1))

    with pytest.raises(RuntimeError):
        recorder.add_items(1)
    with pytest.raises(RuntimeError):
        recorder.mark_partial("early")
    with pytest.raises(RuntimeError):
        recorder.__exit__(None, None, None)

    assert sink.start_calls == []
    assert sink.finish_calls == []


def test_recorder_never_starts_or_finishes_twice() -> None:
    sink = FakeSink()
    recorder = SourceRunRecorder(sink, "cab", clock=make_clock(T0, T1, T2))

    with recorder:
        pass

    with pytest.raises(RuntimeError):
        recorder.__enter__()
    with pytest.raises(RuntimeError):
        recorder.__exit__(None, None, None)

    assert len(sink.start_calls) == 1
    assert len(sink.finish_calls) == 1


# --- NdjsonSourceRunLog ------------------------------------------------------


def test_ndjson_start_creates_history_and_assigns_id_one(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "source_runs.ndjson"
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")

    run_id = log.start("livewhale", T0)

    assert run_id == 1
    rows = read_rows(destination)
    assert rows == [
        {
            "id": 1,
            "source": "livewhale",
            "started_at": "2026-09-01T06:00:00Z",
            "status": "partial",
        }
    ]


def test_ndjson_start_assigns_max_plus_one_and_preserves_existing_rows(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    existing = [
        SourceRunRow(id=1, source="cab", started_at=T0, finished_at=T1, status="ok", items_upserted=3),
        SourceRunRow(id=7, source="livewhale", started_at=T1, status="partial"),
    ]
    destination.write_text(
        "".join(history_line(row) + "\n" for row in existing), encoding="utf-8"
    )
    before_lines = destination.read_text(encoding="utf-8").splitlines()
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")

    run_id = log.start("athletics_ics", T2)

    assert run_id == 8
    after_lines = destination.read_text(encoding="utf-8").splitlines()
    assert after_lines[:2] == before_lines
    appended = json.loads(after_lines[2])
    assert appended == {
        "id": 8,
        "source": "athletics_ics",
        "started_at": "2026-09-01T06:10:00Z",
        "status": "partial",
    }


def test_ndjson_finish_replaces_exactly_the_matching_row(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")
    log.start("cab", T0)
    log.start("livewhale", T0)
    log.start("athletics_ics", T1)
    before_lines = destination.read_text(encoding="utf-8").splitlines()

    log.finish(2, finished_at=T2, status="ok", items_upserted=9, error=None)

    after_lines = destination.read_text(encoding="utf-8").splitlines()
    assert len(after_lines) == 3
    assert after_lines[0] == before_lines[0]
    assert after_lines[2] == before_lines[2]
    assert json.loads(after_lines[1]) == {
        "id": 2,
        "source": "livewhale",
        "started_at": "2026-09-01T06:00:00Z",
        "finished_at": "2026-09-01T06:10:00Z",
        "status": "ok",
        "items_upserted": 9,
    }


def test_ndjson_finish_records_partial_and_error_details(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")
    log.start("cab", T0)

    log.finish(1, finished_at=T1, status="error", items_upserted=0, error="boom")

    assert read_rows(destination)[0]["status"] == "error"
    assert read_rows(destination)[0]["error"] == "boom"


def test_ndjson_finish_missing_id_fails_without_changing_the_file(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")
    log.start("cab", T0)
    before = destination.read_bytes()

    with pytest.raises(LookupError, match="99"):
        log.finish(99, finished_at=T1, status="ok", items_upserted=0, error=None)

    assert destination.read_bytes() == before


def test_ndjson_duplicate_ids_fail_closed_for_both_start_and_finish(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    duplicate = SourceRunRow(id=1, source="cab", started_at=T0, status="partial")
    destination.write_text(
        history_line(duplicate) + "\n" + history_line(duplicate) + "\n", encoding="utf-8"
    )
    before = destination.read_bytes()
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")

    with pytest.raises(ValueError, match="duplicate"):
        log.start("livewhale", T1)
    with pytest.raises(ValueError, match="duplicate"):
        log.finish(1, finished_at=T1, status="ok", items_upserted=0, error=None)

    assert destination.read_bytes() == before


@pytest.mark.parametrize(
    "corrupt_line",
    [
        "not json at all",
        "42",
        '{"source":"cab","started_at":"2026-09-01T06:00:00Z","status":"partial"}',
        '{"id":0,"source":"cab","started_at":"2026-09-01T06:00:00Z","status":"partial"}',
        '{"id":1,"source":"cab","started_at":"2026-09-01T06:00:00Z","status":"bogus"}',
    ],
)
def test_ndjson_corrupt_history_fails_closed_and_unchanged(
    tmp_path: Path, corrupt_line: str
) -> None:
    destination = tmp_path / "source_runs.ndjson"
    good = SourceRunRow(id=1, source="cab", started_at=T0, status="partial")
    content = (history_line(good) + "\n" + corrupt_line + "\n").encode()
    destination.write_bytes(content)
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")

    with pytest.raises(ValueError):
        log.start("livewhale", T1)
    with pytest.raises((ValueError, LookupError)):
        log.finish(1, finished_at=T1, status="ok", items_upserted=0, error=None)

    assert destination.read_bytes() == content


def test_ndjson_replacement_failure_preserves_history_and_cleans_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "source_runs.ndjson"
    staging_root = tmp_path / "staging"
    log = NdjsonSourceRunLog(destination, staging_root)
    log.start("cab", T0)
    before = destination.read_bytes()

    def fail_replace(source: str | Path, target: str | Path) -> None:
        raise OSError("disk failed")

    monkeypatch.setattr("brownsync_ingest.run_log.os.replace", fail_replace)

    with pytest.raises(OSError, match="disk failed"):
        log.start("livewhale", T1)

    assert destination.read_bytes() == before
    leftovers = [path for path in staging_root.iterdir() if path.suffix == ".tmp"]
    assert leftovers == []


def test_ndjson_lock_evidence_stays_out_of_the_seed_directory(tmp_path: Path) -> None:
    seed_dir = tmp_path / "db" / "seeds"
    destination = seed_dir / "source_runs.ndjson"
    staging_root = tmp_path / "staging"
    log = NdjsonSourceRunLog(destination, staging_root)

    run_id = log.start("cab", T0)
    log.finish(run_id, finished_at=T1, status="ok", items_upserted=2, error=None)

    assert [path.name for path in seed_dir.iterdir()] == ["source_runs.ndjson"]
    assert any(path.name.endswith(".lock") for path in staging_root.iterdir())
    for row in read_rows(destination):
        SourceRunRow.model_validate(row)


def test_ndjson_rejects_naive_timestamps(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    log = NdjsonSourceRunLog(destination, tmp_path / "staging")

    with pytest.raises(ValueError):
        log.start("cab", datetime(2026, 9, 1, 6, 0))

    assert not destination.exists()


def test_ndjson_concurrent_starts_allocate_unique_monotonic_ids(tmp_path: Path) -> None:
    destination = tmp_path / "source_runs.ndjson"
    staging_root = tmp_path / "staging"
    barrier = threading.Barrier(8)
    ids: list[int] = []
    ids_lock = threading.Lock()
    failures: list[BaseException] = []

    def worker() -> None:
        log = NdjsonSourceRunLog(destination, staging_root)
        barrier.wait()
        try:
            run_id = log.start("cab", T0)
        except BaseException as exc:  # pragma: no cover - failure path
            failures.append(exc)
            return
        with ids_lock:
            ids.append(run_id)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert sorted(ids) == list(range(1, 9))
    assert [row["id"] for row in read_rows(destination)] == list(range(1, 9))


def test_run_log_module_defines_run_status_and_sink_protocol() -> None:
    assert set(run_log.RunStatus.__args__) == {"ok", "partial", "error"}
    assert isinstance(FakeSink(), run_log.SourceRunSink)
