from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def repo_root() -> Path:
    """Repo root, so tests can read published seed artifacts.

    Lives at the top of the tests tree rather than per-suite: it was already
    duplicated in `campus/conftest.py` and `gazetteer/conftest.py`, and the
    third copy is where they start disagreeing about how many `parents[]` to
    walk.
    """
    return Path(__file__).resolve().parents[2]
