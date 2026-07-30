"""Atomic, job-scoped resumability checkpoints."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Mapping

from pydantic import JsonValue


_SAFE_JOB = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def _json_safe(value: object) -> bool:
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_json_safe(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _json_safe(item) for key, item in value.items())
    return False


class CheckpointStore:
    """Persist per-job state without making a partial file visible."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def load(self, job: str, fingerprint: str) -> dict[str, JsonValue] | None:
        path = self._path(job)
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None
        if not isinstance(envelope, dict):
            return None
        state = envelope.get("state")
        if envelope.get("version") != 1 or envelope.get("job") != job or envelope.get("fingerprint") != fingerprint:
            return None
        if not isinstance(state, dict) or not _json_safe(state):
            return None
        return state

    def save(self, job: str, fingerprint: str, state: Mapping[str, JsonValue]) -> None:
        path = self._path(job)
        state_dict = dict(state)
        if not _json_safe(state_dict):
            raise ValueError("state must be JSON-safe with finite numbers")
        payload = {"version": 1, "job": job, "fingerprint": fingerprint, "state": state_dict}
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
        self._root.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=self._root)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(encoded)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def clear(self, job: str) -> None:
        self._path(job).unlink(missing_ok=True)

    def _path(self, job: str) -> Path:
        if not _SAFE_JOB.fullmatch(job):
            raise ValueError("job must be a safe lower-kebab name")
        return self._root / f"{job}.json"
