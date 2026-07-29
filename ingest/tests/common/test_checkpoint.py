from __future__ import annotations

import json
import math

import pytest

from brownsync_ingest.common.checkpoint import CheckpointStore
import brownsync_ingest.common.checkpoint as checkpoint_module


def test_round_trip_writes_exact_checkpoint_envelope(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    state = {"cursor": "abc", "count": 2, "nested": [True, None]}
    store.save("cab-import", "sha256:one", state)

    assert store.load("cab-import", "sha256:one") == state
    assert json.loads((tmp_path / "cab-import.json").read_text()) == {"version": 1, "job": "cab-import", "fingerprint": "sha256:one", "state": state}


@pytest.mark.parametrize("mutate", ["fingerprint", "version", "job", "corrupt"])
def test_invalid_or_nonmatching_checkpoint_returns_none_without_deleting_evidence(tmp_path, mutate: str) -> None:
    store = CheckpointStore(tmp_path)
    store.save("cab-import", "one", {"cursor": 1})
    path = tmp_path / "cab-import.json"
    if mutate == "corrupt":
        path.write_text("not json")
    else:
        envelope = json.loads(path.read_text())
        envelope[mutate] = 2 if mutate == "version" else "other"
        path.write_text(json.dumps(envelope))

    assert store.load("cab-import", "one") is None
    assert path.exists()


@pytest.mark.parametrize("job", ["", "../escape", "has space", "a/b", ".hidden"])
def test_rejects_unsafe_job_names(tmp_path, job: str) -> None:
    store = CheckpointStore(tmp_path)
    with pytest.raises(ValueError, match="job"):
        store.save(job, "one", {})
    with pytest.raises(ValueError, match="job"):
        store.load(job, "one")
    with pytest.raises(ValueError, match="job"):
        store.clear(job)


@pytest.mark.parametrize("bad", [{"bytes": b"no"}, {"nested": [float("nan")]}, {"infinity": float("inf")}, {"set": {1}}])
def test_save_rejects_non_json_or_non_finite_state(tmp_path, bad: dict[str, object]) -> None:
    store = CheckpointStore(tmp_path)
    with pytest.raises(ValueError, match="JSON"):
        store.save("cab-import", "one", bad)  # type: ignore[arg-type]
    assert not (tmp_path / "cab-import.json").exists()


def test_failed_atomic_replacement_preserves_previous_checkpoint(tmp_path, monkeypatch) -> None:
    store = CheckpointStore(tmp_path)
    store.save("cab-import", "one", {"cursor": "old"})
    path = tmp_path / "cab-import.json"
    before = path.read_bytes()
    def fail_replace(source, destination):
        raise OSError("simulated replacement interruption")
    monkeypatch.setattr(checkpoint_module.os, "replace", fail_replace)

    with pytest.raises(OSError, match="simulated"):
        store.save("cab-import", "two", {"cursor": "new"})
    assert path.read_bytes() == before
    assert store.load("cab-import", "one") == {"cursor": "old"}


def test_clear_removes_only_named_checkpoint_and_is_idempotent(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    store.save("cab-import", "one", {})
    store.save("livewhale-import", "two", {})

    store.clear("cab-import")
    store.clear("cab-import")

    assert not (tmp_path / "cab-import.json").exists()
    assert store.load("livewhale-import", "two") == {}
