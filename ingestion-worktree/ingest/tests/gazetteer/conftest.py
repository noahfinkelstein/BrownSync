"""Shared gazetteer test data: golden pg_trgm parity vectors.

Each vector is ``(a, b, expected)`` where ``expected`` is the exact rational
pg_trgm ``similarity(a, b)`` value. Vectors are ASCII-only on purpose so that
libc/ICU lowercasing differences in the PostgreSQL database locale cannot
skew the parity comparison. The offline suite pins the portable Python
implementation to these fractions; the postgres-marked parity test replays
every vector through ``select similarity(a, b)`` and asserts agreement.
"""

from __future__ import annotations

import pytest


# (a, b, expected similarity as an exact fraction)
PARITY_VECTORS: tuple[tuple[str, str, float], ...] = (
    # identity and case folding
    ("Sayles Hall", "Sayles Hall", 1 / 1),
    ("sayles hall", "Sayles Hall", 1 / 1),
    # realistic campus pairs
    ("Salomon", "Salomon Center", 8 / 15),
    ("Salomon Center", "Salomon Center for Teaching", 15 / 28),
    ("Barus & Holley", "Barus and Holley", 13 / 17),
    ("Barus Building", "Barus & Holley", 2 / 7),
    ("B&H", "Barus & Holley", 2 / 15),
    ("Jo's", "Josiah's", 2 / 5),
    ("Smith-Buonanno Hall", "Smith Buonanno Hall", 1 / 1),
    ("Smith Buonano Hall", "Smith Buonanno Hall", 6 / 7),
    ("MacMillan 117", "MacMillan Hall", 10 / 19),
    ("85 Waterman Street", "85 Waterman", 12 / 19),
    ("The Ratty", "Sharpe Refectory", 1 / 26),
    ("OMAC", "Olney-Margolies Athletic Center", 1 / 36),
    ("List Art Center", "List Art Building", 9 / 25),
    ("Pizzitola", "Pizzitola Sports Center", 5 / 12),
    ("Granoff Center", "Granoff Center for the Creative Arts", 5 / 12),
    # the exact acceptance boundary (11/20 == 0.55) and just below it
    ("Backgammon", "Backgammon Terminal", 11 / 20),
    ("Backgammon", "Backgammon Terminals", 11 / 21),
    # degenerate words, empties, and separator-only strings
    ("a", "a", 1 / 1),
    ("a", "b", 0.0),
    ("", "Sayles Hall", 0.0),
    ("", "", 0.0),
    ("  ", "---", 0.0),
    # repeated trigrams deduplicate into identical sets
    ("aaa", "aaaaaa", 1 / 1),
    # whitespace runs are word separators, not content
    ("Wilson Hall", "Wilson  Hall", 1 / 1),
)


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    """Parametrize any test taking ``parity_vector`` over the golden vectors."""
    if "parity_vector" in metafunc.fixturenames:
        metafunc.parametrize(
            "parity_vector",
            PARITY_VECTORS,
            ids=[f"{index:02d}-{a!r}~{b!r}" for index, (a, b, _) in enumerate(PARITY_VECTORS)],
        )
