"""Deterministic slug and collision helpers shared by ingestion catalogs."""

from __future__ import annotations

import re
from typing import Collection
import unicodedata


_APOSTROPHES = frozenset("'’ʼ")
_HYPHEN_RUN = re.compile(r"-{2,}")


def slugify(text: str) -> str:
    """Reduce arbitrary text to a deterministic lower-kebab identifier.

    Case-folds, strips accents to ASCII, drops apostrophes (``Jo's`` ->
    ``jos``), converts every other non-alphanumeric character (including
    non-ASCII dashes) to a hyphen, collapses hyphen runs, and trims
    leading/trailing hyphens. Raises ``ValueError`` when nothing sluggable
    remains.
    """
    folded = unicodedata.normalize("NFKD", text.casefold())
    characters: list[str] = []
    for character in folded:
        if character in _APOSTROPHES or unicodedata.combining(character):
            continue
        if character.isascii() and character.isalnum():
            characters.append(character)
        else:
            characters.append("-")
    slug = _HYPHEN_RUN.sub("-", "".join(characters)).strip("-")
    if not slug:
        raise ValueError(f"text {text!r} produces an empty slug")
    return slug


def unique_slug(base: str, taken: Collection[str]) -> str:
    """Return ``base`` or the first ``base-N`` (N starting at 2) not in ``taken``."""
    if base not in taken:
        return base
    ordinal = 2
    while f"{base}-{ordinal}" in taken:
        ordinal += 1
    return f"{base}-{ordinal}"
