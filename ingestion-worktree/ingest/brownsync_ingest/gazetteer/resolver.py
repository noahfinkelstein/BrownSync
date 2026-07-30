"""Shared place resolver: exact aliases first, then pg_trgm-style trigram
acceptance at >= 0.55.

Contract (DATA_CONTRACT.md section 2): exact alias match
(case/punct-insensitive) -> trigram similarity >= 0.55 against names+aliases
-> else null, keeping the raw value. The trigram score is authoritative;
RapidFuzz ``token_set_ratio`` only ranks and reports candidates and can never
veto (or decide) a contract-valid trigram match — an exact tie in trigram
score between distinct places therefore fails closed as ambiguous.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterator

from rapidfuzz import fuzz

from brownsync_ingest.gazetteer.aliases import (
    DEFAULT_ALIASES_PATH,
    load_curated_catalog,
    normalize_alias,
)
from brownsync_ingest.gazetteer.models import CuratedCatalog


TRIGRAM_THRESHOLD = 0.55

_WORD = re.compile(r"[^\W_]+")
_RAW_TOKEN = re.compile(r"\S+")
_MAX_ROOM_TOKENS = 2
_MAX_CANDIDATES = 5


def trigrams(text: str) -> frozenset[str]:
    """The pg_trgm trigram set of ``text``.

    Mirrors PostgreSQL pg_trgm with its default build flags (IGNORECASE,
    KEEPONLYALNUM): lowercase, split into words on every non-alphanumeric
    character (underscore included, as in C ``isalnum``), pad each word with
    two leading spaces and one trailing space, then collect every 3-character
    window into a set.
    """
    collected: set[str] = set()
    for word in _WORD.findall(text.lower()):
        padded = f"  {word} "
        for index in range(len(padded) - 2):
            collected.add(padded[index : index + 3])
    return frozenset(collected)


def trigram_similarity(a: str, b: str) -> float:
    """Portable PostgreSQL ``similarity(a, b)``: Jaccard over trigram sets.

    Returns 0.0 when either side has no trigrams, mirroring pg_trgm's
    explicit empty guard in ``cnt_sml``.
    """
    return _similarity(trigrams(a), trigrams(b))


def _similarity(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    shared = len(a & b)
    return shared / (len(a) + len(b) - shared)


@dataclass(frozen=True)
class Candidate:
    """One fuzzy candidate, reported for alias growth and auditability."""

    place_id: str
    alias: str
    trigram: float
    token_set_ratio: float
    room: str | None


@dataclass(frozen=True)
class Resolution:
    """The outcome of resolving one raw location value."""

    query: str  # the raw value, preserved byte-for-byte
    place_id: str | None
    room: str | None
    method: str  # "exact" | "exact-room" | "trigram" | "unresolved"
    reason: str | None  # unresolved only: "empty-after-normalization" |
    #                     "below-threshold" | "ambiguous"
    score: float | None  # trigram score of the accepted/best fuzzy candidate
    candidates: tuple[Candidate, ...]  # fuzzy stage only; ranked by
    #                     (token_set_ratio desc, trigram desc, place_id asc)


@dataclass(frozen=True)
class _Token:
    text: str  # one normalized token
    raw_start: int  # character offset of its raw whitespace token
    first_in_raw: bool  # True when it starts its raw whitespace token


@dataclass(frozen=True)
class _AliasEntry:
    place_id: str
    alias: str  # curated alias exactly as written
    normalized: str
    trigram_set: frozenset[str]


@dataclass(frozen=True)
class _Variant:
    words: tuple[str, ...]
    room: str | None
    stripped: int  # number of stripped trailing tokens (0 = full query)


def _normalized_tokens(text: str) -> list[str]:
    try:
        return normalize_alias(text).split(" ")
    except ValueError:
        return []


def _tokenize(raw: str) -> list[_Token]:
    tokens: list[_Token] = []
    for match in _RAW_TOKEN.finditer(raw):
        for position, text in enumerate(_normalized_tokens(match.group())):
            tokens.append(
                _Token(text=text, raw_start=match.start(), first_in_raw=position == 0)
            )
    return tokens


def _looks_like_room(words: tuple[str, ...]) -> bool:
    return (
        1 <= len(words) <= _MAX_ROOM_TOKENS
        and any(any(character.isdigit() for character in word) for word in words)
    )


class PlaceResolver:
    """Resolve raw location strings against the curated gazetteer."""

    def __init__(
        self, catalog: CuratedCatalog, *, threshold: float = TRIGRAM_THRESHOLD
    ) -> None:
        self._threshold = threshold
        self._alias_index: dict[tuple[str, ...], _AliasEntry] = {}
        self._entries: list[_AliasEntry] = []
        for place in catalog.places:
            for alias in place.aliases:
                normalized = normalize_alias(alias)
                entry = _AliasEntry(
                    place_id=place.id,
                    alias=alias,
                    normalized=normalized,
                    trigram_set=trigrams(normalized),
                )
                key = tuple(normalized.split(" "))
                existing = self._alias_index.get(key)
                if existing is not None and existing.place_id != place.id:
                    raise ValueError(
                        f"normalized alias {normalized!r} of place {place.id!r} "
                        f"collides with place {existing.place_id!r}"
                    )
                if existing is None:
                    self._alias_index[key] = entry
                self._entries.append(entry)

    @classmethod
    def from_files(cls, aliases_path: Path | None = None) -> "PlaceResolver":
        return cls(load_curated_catalog(aliases_path or DEFAULT_ALIASES_PATH))

    def resolve(self, value: str) -> Resolution:
        tokens = _tokenize(value)
        if not tokens:
            return Resolution(
                query=value,
                place_id=None,
                room=None,
                method="unresolved",
                reason="empty-after-normalization",
                score=None,
                candidates=(),
            )
        words = tuple(token.text for token in tokens)

        exact = self._alias_index.get(words)
        if exact is not None:
            return Resolution(
                query=value,
                place_id=exact.place_id,
                room=None,
                method="exact",
                reason=None,
                score=None,
                candidates=(),
            )

        prefix = self._longest_alias_prefix(value, tokens, words)
        if prefix is not None:
            entry, room = prefix
            return Resolution(
                query=value,
                place_id=entry.place_id,
                room=room,
                method="exact-room",
                reason=None,
                score=None,
                candidates=(),
            )

        return self._resolve_fuzzy(value, tokens, words)

    def _longest_alias_prefix(
        self, value: str, tokens: list[_Token], words: tuple[str, ...]
    ) -> tuple[_AliasEntry, str] | None:
        """The longest curated alias that prefixes ``words`` with a room rest."""
        for length in range(len(words) - 1, 0, -1):
            split_token = tokens[length]
            if not split_token.first_in_raw:
                continue  # a room may never start mid raw token
            if not _looks_like_room(words[length:]):
                continue
            entry = self._alias_index.get(words[:length])
            if entry is not None:
                return entry, value[split_token.raw_start :].strip()
        return None

    def _variants(
        self, value: str, tokens: list[_Token], words: tuple[str, ...]
    ) -> Iterator[_Variant]:
        yield _Variant(words=words, room=None, stripped=0)
        for stripped in range(1, _MAX_ROOM_TOKENS + 1):
            length = len(words) - stripped
            if length < 1:
                break
            split_token = tokens[length]
            if not split_token.first_in_raw:
                continue  # a room may never start mid raw token
            if not _looks_like_room(words[length:]):
                continue
            yield _Variant(
                words=words[:length],
                room=value[split_token.raw_start :].strip(),
                stripped=stripped,
            )

    def _resolve_fuzzy(
        self, value: str, tokens: list[_Token], words: tuple[str, ...]
    ) -> Resolution:
        full_query = " ".join(words)
        variants = [
            (variant, trigrams(" ".join(variant.words)))
            for variant in self._variants(value, tokens, words)
        ]

        # Best (highest score, fewest stripped tokens, alias asc) per place;
        # the trigram score alone decides acceptance.
        best: dict[str, tuple[float, _Variant, _AliasEntry]] = {}
        best_keys: dict[str, tuple[float, int, str]] = {}
        for entry in self._entries:
            for variant, variant_set in variants:
                score = _similarity(variant_set, entry.trigram_set)
                key = (-score, variant.stripped, entry.alias)
                current_key = best_keys.get(entry.place_id)
                if current_key is None or key < current_key:
                    best_keys[entry.place_id] = key
                    best[entry.place_id] = (score, variant, entry)

        scored = sorted(
            best.items(), key=lambda item: (-item[1][0], item[0])
        )
        top = [(place_id, hit) for place_id, hit in scored if hit[0] > 0.0][
            :_MAX_CANDIDATES
        ]
        candidates = tuple(
            sorted(
                (
                    Candidate(
                        place_id=place_id,
                        alias=hit[2].alias,
                        trigram=hit[0],
                        token_set_ratio=float(
                            fuzz.token_set_ratio(full_query, hit[2].normalized)
                        ),
                        room=hit[1].room,
                    )
                    for place_id, hit in top
                ),
                key=lambda candidate: (
                    -candidate.token_set_ratio,
                    -candidate.trigram,
                    candidate.place_id,
                ),
            )
        )

        if not scored:
            best_score = 0.0
        else:
            best_score = scored[0][1][0]
        if best_score < self._threshold:
            return Resolution(
                query=value,
                place_id=None,
                room=None,
                method="unresolved",
                reason="below-threshold",
                score=best_score,
                candidates=candidates,
            )
        tied = [place_id for place_id, hit in scored if hit[0] == best_score]
        if len(tied) > 1:
            return Resolution(
                query=value,
                place_id=None,
                room=None,
                method="unresolved",
                reason="ambiguous",
                score=best_score,
                candidates=candidates,
            )
        winner_id, (score, variant, _entry) = scored[0]
        return Resolution(
            query=value,
            place_id=winner_id,
            room=variant.room,
            method="trigram",
            reason=None,
            score=score,
            candidates=candidates,
        )
