from __future__ import annotations

import pytest

from brownsync_ingest.common.identifiers import slugify, unique_slug


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Barus & Holley", "barus-holley"),
        ("Barus Building", "barus-building"),
        ("Jo's", "jos"),
        ("Josiah's", "josiahs"),
        ("Sayles Hall", "sayles-hall"),
        ("Verney-Woolley Hall", "verney-woolley-hall"),
        ("Corliss–Brackett House", "corliss-brackett-house"),  # en dash
        ("Young Orchard 10", "young-orchard-10"),
        ("Café Carré", "cafe-carre"),
        ("  The   Rock  ", "the-rock"),
        ("SciLi", "scili"),
        ("Stephen Robert '62 Campus Center", "stephen-robert-62-campus-center"),
        ("Jo’s", "jos"),  # typographic apostrophe
        ("A--B__C", "a-b-c"),
        ("already-kebab-2", "already-kebab-2"),
    ],
)
def test_slugify_produces_deterministic_lower_kebab(text: str, expected: str) -> None:
    assert slugify(text) == expected
    assert slugify(text) == slugify(text)


@pytest.mark.parametrize("text", ["", "   ", "&&&", "---", "'’'", "—"])
def test_slugify_rejects_text_with_no_slug_content(text: str) -> None:
    with pytest.raises(ValueError, match="slug"):
        slugify(text)


def test_slugify_output_passes_the_ingestion_slug_policy() -> None:
    from brownsync_ingest.policy import validate_slug

    for text in ("Barus & Holley", "Jo's", "Olney-Margolies Athletic Center", "180 George"):
        assert validate_slug(slugify(text)) == slugify(text)


def test_unique_slug_returns_base_when_free() -> None:
    assert unique_slug("sayles-hall", set()) == "sayles-hall"
    assert unique_slug("sayles-hall", ["other"]) == "sayles-hall"


def test_unique_slug_appends_increasing_ordinals_from_two() -> None:
    assert unique_slug("north-house", {"north-house"}) == "north-house-2"
    assert unique_slug("north-house", {"north-house", "north-house-2"}) == "north-house-3"
    assert (
        unique_slug("north-house", {"north-house", "north-house-2", "north-house-3"})
        == "north-house-4"
    )


def test_unique_slug_accepts_any_collection_and_does_not_mutate_it() -> None:
    taken = ["hall", "hall-2"]
    assert unique_slug("hall", taken) == "hall-3"
    assert taken == ["hall", "hall-2"]
