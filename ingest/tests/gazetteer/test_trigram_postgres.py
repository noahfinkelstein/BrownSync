"""Golden parity: portable trigram_similarity vs PostgreSQL pg_trgm similarity().

Runs only when TEST_DATABASE_URL points at a disposable database with the
pg_trgm extension available; skips cleanly offline. Every golden vector from
``conftest.PARITY_VECTORS`` is replayed through ``select similarity(a, b)``
and must agree with the Python implementation within float4 tolerance.
"""

from __future__ import annotations

import os
from typing import Iterator

import pytest

psycopg = pytest.importorskip("psycopg")

from brownsync_ingest.gazetteer.resolver import trigram_similarity  # noqa: E402


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not DATABASE_URL,
        reason="TEST_DATABASE_URL is not set; postgres integration tests need a disposable database",
    ),
]


@pytest.fixture(scope="module")
def connection() -> Iterator["psycopg.Connection"]:
    connection = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        connection.execute("create extension if not exists pg_trgm")
        yield connection
    finally:
        connection.close()


def test_python_similarity_matches_postgres(
    connection: "psycopg.Connection", parity_vector: tuple[str, str, float]
) -> None:
    a, b, expected = parity_vector
    row = connection.execute("select similarity(%s, %s)", (a, b)).fetchone()
    assert row is not None
    postgres_value = row[0]
    python_value = trigram_similarity(a, b)
    # The Python value is pinned to the golden fraction offline; here the
    # authoritative PostgreSQL float4 must agree with both.
    assert python_value == pytest.approx(expected, abs=1e-12)
    assert postgres_value == pytest.approx(python_value, abs=1e-6)
