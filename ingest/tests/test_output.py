from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from brownsync_ingest.contract import EventRow, PlaceRow, SourceRunRow
from brownsync_ingest.output import model_identity, publish_ndjson


def place(place_id: str, **overrides: object) -> PlaceRow:
    payload: dict[str, object] = {
        "id": place_id,
        "name": place_id.replace("-", " ").title(),
        "kind": "academic",
        "lat": 41.826,
        "lng": -71.405,
    }
    payload.update(overrides)
    return PlaceRow(**payload)


def event(source: str, source_id: str, **overrides: object) -> EventRow:
    payload: dict[str, object] = {
        "source": source,
        "source_id": source_id,
        "title": source_id,
        "start_ts": datetime(2026, 9, 1, 9, tzinfo=UTC),
    }
    payload.update(overrides)
    return EventRow(**payload)


def test_model_identity_prefers_non_null_id_and_uses_event_source_pair_when_absent() -> None:
    assert model_identity(place("barus-holley")) == ("id", "barus-holley")
    assert model_identity(event("livewhale", "42")) == ("event", "livewhale", "42")
    assert model_identity(event("livewhale", "42", id="a3b7e39e-0c6f-4ee0-a5a0-0486ef8bc5cc")) == (
        "id",
        "a3b7e39e-0c6f-4ee0-a5a0-0486ef8bc5cc",
    )
    with pytest.raises(ValueError, match="identity"):
        model_identity(
            SourceRunRow(source="cab", started_at=datetime(2026, 9, 1, 9, tzinfo=UTC), status="ok")
        )


def test_publisher_sorts_identities_and_writes_compact_utf8_ndjson(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "places.ndjson"
    staging_root = tmp_path / "reports" / "tmp"

    count = publish_ndjson(
        [place("zeta", name="Zéta"), place("alpha")],
        PlaceRow,
        destination,
        staging_root,
    )

    assert count == 2
    lines = destination.read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["id"] for line in lines] == ["alpha", "zeta"]
    assert '"id":"alpha"' in lines[0]
    assert ": " not in lines[0]
    assert "Zéta" in lines[1]
    assert list(staging_root.iterdir()) == []


def test_publisher_sorts_idless_events_by_source_and_source_id(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "events.ndjson"
    staging_root = tmp_path / "reports" / "tmp"

    publish_ndjson(
        [event("livewhale", "z"), event("athletics_ics", "b"), event("livewhale", "a")],
        EventRow,
        destination,
        staging_root,
    )

    rows = [json.loads(line) for line in destination.read_text(encoding="utf-8").splitlines()]
    assert [(row["source"], row["source_id"]) for row in rows] == [
        ("athletics_ics", "b"),
        ("livewhale", "a"),
        ("livewhale", "z"),
    ]


def test_publisher_rejects_duplicate_identities_without_replacing_existing_seed(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "places.ndjson"
    staging_root = tmp_path / "reports" / "tmp"
    destination.parent.mkdir(parents=True)
    destination.write_bytes(b"published\n")
    staging_root.mkdir(parents=True)

    with pytest.raises(ValueError, match="duplicate"):
        publish_ndjson([place("barus"), place("barus")], PlaceRow, destination, staging_root)

    assert destination.read_bytes() == b"published\n"
    assert list(staging_root.iterdir()) == []


def test_publisher_validates_all_input_before_touching_existing_seed(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "places.ndjson"
    staging_root = tmp_path / "reports" / "tmp"
    destination.parent.mkdir(parents=True)
    destination.write_bytes(b"published\n")
    staging_root.mkdir(parents=True)

    with pytest.raises(ValidationError, match="kind"):
        publish_ndjson(
            [place("good"), {"id": "bad", "name": "Bad", "kind": "invalid", "lat": 0, "lng": 0}],
            PlaceRow,
            destination,
            staging_root,
        )

    assert destination.read_bytes() == b"published\n"
    assert list(staging_root.iterdir()) == []


def test_publisher_refuses_non_finite_json_and_preserves_existing_seed(tmp_path: Path) -> None:
    destination = tmp_path / "db" / "seeds" / "events.ndjson"
    staging_root = tmp_path / "reports" / "tmp"
    destination.parent.mkdir(parents=True)
    destination.write_bytes(b"published\n")
    staging_root.mkdir(parents=True)
    unchecked_event = EventRow.model_construct(
        source="livewhale",
        source_id="bad-json",
        title="Bad JSON",
        start_ts=datetime(2026, 9, 1, 9, tzinfo=UTC),
        raw={"nested": [float("nan")]},
    )

    with pytest.raises(ValueError, match="Out of range float values"):
        publish_ndjson([unchecked_event], EventRow, destination, staging_root)

    assert destination.read_bytes() == b"published\n"
    assert list(staging_root.iterdir()) == []


def test_publisher_fsyncs_staging_file_then_replaces_destination_and_cleans_up(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "db" / "seeds" / "places.ndjson"
    staging_root = tmp_path / "reports" / "tmp"
    fsync_calls: list[int] = []
    replace_calls: list[tuple[Path, Path]] = []
    real_fsync = os.fsync
    real_replace = os.replace

    def record_fsync(fd: int) -> None:
        fsync_calls.append(fd)
        real_fsync(fd)

    def record_replace(source: str | Path, target: str | Path) -> None:
        replace_calls.append((Path(source), Path(target)))
        real_replace(source, target)

    monkeypatch.setattr("brownsync_ingest.output.os.fsync", record_fsync)
    monkeypatch.setattr("brownsync_ingest.output.os.replace", record_replace)

    publish_ndjson([place("barus")], PlaceRow, destination, staging_root)

    assert fsync_calls
    assert replace_calls == [(replace_calls[0][0], destination)]
    assert replace_calls[0][0].parent == staging_root
    assert list(staging_root.iterdir()) == []


def test_publisher_cleans_staging_and_preserves_existing_seed_when_replacement_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "db" / "seeds" / "places.ndjson"
    staging_root = tmp_path / "reports" / "tmp"
    destination.parent.mkdir(parents=True)
    destination.write_bytes(b"published\n")
    staging_root.mkdir(parents=True)

    def fail_replace(source: str | Path, target: str | Path) -> None:
        raise OSError("disk failed")

    monkeypatch.setattr("brownsync_ingest.output.os.replace", fail_replace)

    with pytest.raises(OSError, match="disk failed"):
        publish_ndjson([place("barus")], PlaceRow, destination, staging_root)

    assert destination.read_bytes() == b"published\n"
    assert list(staging_root.iterdir()) == []
