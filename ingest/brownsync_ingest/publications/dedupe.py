"""Cross-outlet dedupe — one story, many mastheads, one row.

Once the feed is wider than the two student papers, the same story arrives more
than once. The recorded corpus already proves it: Rhode Island Current and the
Brown newsroom both carry "Washington Bridge closure lengthened East Bay
ambulance trips, study finds", at two different URLs, 8h35m apart. Nothing in
``feeds.py`` collapses that — its dedupe is exact-canonical-URL only, and says
so on purpose.

**The asymmetry that sets every constant in this file.** A missed dedup shows a
reader the same headline twice; they scroll. A false merge *deletes a real
article* — one publication's independent reporting vanishes from the artifact
with no trace on the page, and the only record is a diagnostic nobody reads.
Those are not the same size of mistake, so every threshold here is set to fail
towards the survivable one. That is why the title threshold is 0.72 rather than
the 0.55 the gazetteer resolver uses (``gazetteer/resolver.py``): that module
is matching a messy event-location string against a *closed, curated* list of
Brown buildings, where a near-miss has one plausible answer and the cost of
picking it is a pin 50 metres off. Here the candidate set is open, the two
strings were written independently by two newsrooms, and the cost is deletion.
Same technique, opposite risk, different number.

**Three layers, in this order**, cheapest and most certain first:

1. :func:`syndication_key` — canonical URL. Kills identical-link syndication
   for free and with no false-positive risk at all.
2. :func:`title_similarity` — token-sort ratio at
   :data:`SIMILARITY_THRESHOLD`. Runs on the **full** headline, outlet suffix
   and all, so it stays conservative.
3. :func:`simhash` + banding — 64-bit fingerprint over the *stem* of the
   headline, for the case layer 2 is deliberately too conservative to catch:
   the same headline wearing an outlet's clothes.

A drop is always attributed. :func:`deduplicate` keeps the earliest-published
member of a duplicate set and emits one diagnostic per drop naming the loser,
the winner and the layer that fired, because a silent merge and a bug look
identical from outside.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from typing import Iterable, Sequence
import unicodedata
from urllib.parse import parse_qsl, urlsplit

from rapidfuzz import fuzz

from brownsync_ingest.publications.feeds import Article, canonical_url

# -- layer 1: canonical URL --------------------------------------------------

#: Query parameters on a redirect wrapper that hold the real destination.
#: Ordered — a URL carrying two of these is malformed and we take the most
#: specific. Only checked on hosts in :data:`_WRAPPER_HOSTS`, so a publisher
#: whose article genuinely lives at ``?url=`` is not rewritten out from under
#: its own reader.
_TARGET_PARAMS: tuple[str, ...] = ("url", "u", "target")

#: Hosts that exist only to bounce a reader somewhere else. Feedburner and
#: Google's ``/url?`` interstitial both put the destination in the query, so
#: unwrapping them is lossless and lets layer 1 do its job.
#:
#: ``news.google.com`` is listed for ``/url?q=`` only. Its **RSS** links —
#: ``news.google.com/rss/articles/CBMi...`` — are NOT unwrappable: the segment
#: is base64url of a protobuf whose payload is an opaque Google id, and none of
#: the 100 items in the recorded probe decoded to a literal URL. Resolving them
#: needs an undocumented internal ``batchexecute`` POST. So layer 1 cannot see
#: through a Google News item, which is half of why that source is a gap in
#: ``sources.py`` rather than a source — a feed whose links never canonicalize
#: to the publisher's URL is a feed that duplicates every story we already have.
_WRAPPER_HOSTS: frozenset[str] = frozenset(
    {"news.google.com", "feedproxy.google.com", "feeds.feedburner.com"}
)


def resolve_syndication_url(url: str) -> str:
    """Unwrap a redirect wrapper when the destination is *in* the URL.

    Never fetches. A resolver that issued an HTTP request per article would
    turn dedupe into a crawl of every outlet we link to, and would make the
    artifact's contents depend on whether those hosts were up. If the target is
    not present in the string, the string is returned unchanged and layer 1
    simply does not fire for it — a missed dedup, which is the failure mode we
    are willing to have.
    """
    parts = urlsplit(url.strip())
    if parts.netloc.lower() not in _WRAPPER_HOSTS:
        return url
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for param in (*_TARGET_PARAMS, "q"):
        target = query.get(param, "")
        if target.startswith(("http://", "https://")):
            return target
    return url


def syndication_key(url: str) -> str:
    """The layer-1 identity of an article: unwrapped, then canonicalized.

    Canonicalization is ``feeds.canonical_url`` and not a second
    implementation, so the key and the published link can never drift apart.
    """
    return canonical_url(resolve_syndication_url(url))


# -- shared normalization ----------------------------------------------------

_WORDS = re.compile(r"[\w']+")

#: Separators an aggregator uses to bolt its masthead onto a headline. Matched
#: only when flanked by whitespace, so a hyphenated word ("pre-college") and a
#: numeric range ("2026-2027") are untouched.
_SUFFIX_SEPARATOR = re.compile(r"\s+[-–—|·:]{1,2}\s+")

#: A trailing segment longer than this is a clause, not a masthead. "The Brown
#: Daily Herald | Providence's Student Newspaper" is 6 tokens; the longest
#: outlet name in the recorded Google News probe ("Brown University School of
#: Public Health") is 6.
SUFFIX_MAX_TOKENS = 8

#: Never fingerprint a stem this short. Below four tokens a 64-bit simhash is
#: dominated by a handful of hashes and unrelated headlines start colliding,
#: which is the false-merge direction. Short headlines are left to layer 2.
MIN_STEM_TOKENS = 4


def normalize_title(title: str) -> str:
    """Casefold, fold Unicode, strip punctuation, collapse whitespace.

    NFKC before tokenizing because these feeds mix ASCII apostrophes with
    U+2019 — "Brown's" and "Brown's" must not be two different tokens.
    """
    folded = unicodedata.normalize("NFKC", title).replace("’", "'").casefold()
    return " ".join(_WORDS.findall(folded))


def strip_outlet_suffix(title: str) -> str:
    """Drop a trailing masthead: ``"Headline - Higher Ed Dive"`` → ``"Headline"``.

    Only the final segment, only if it is at most :data:`SUFFIX_MAX_TOKENS`
    tokens, and only if what remains is at least :data:`MIN_STEM_TOKENS`. The
    result feeds the *fingerprint* and is never stored or published — the
    reader always sees the headline as its publication wrote it.

    Over-stripping is the risk (a headline really can contain " - "), and the
    guard against it is not this function but the Hamming threshold downstream:
    two stems must still agree in 61 of 64 bits, so trimming "and a prize" off
    "Brown lab wins grant - and a prize" does not make it collide with "Brown
    lab wins grant - and a lawsuit".
    """
    segments = _SUFFIX_SEPARATOR.split(title)
    if len(segments) < 2:
        return title
    stem, tail = " ".join(segments[:-1]), segments[-1]
    if len(_WORDS.findall(tail)) > SUFFIX_MAX_TOKENS:
        return title
    if len(_WORDS.findall(stem)) < MIN_STEM_TOKENS:
        return title
    return stem


def title_tokens(title: str) -> tuple[str, ...]:
    """Fingerprint input: the stem's tokens, in order, duplicates kept.

    Duplicates are kept because simhash is a *weighted* sum — a word used twice
    in a headline genuinely does describe it twice.
    """
    return tuple(normalize_title(strip_outlet_suffix(title)).split())


# -- layer 2: title similarity -----------------------------------------------

#: The number this whole module is organized around. See the asymmetry note at
#: the top: 0.72, well above the gazetteer's 0.55, because a false merge here
#: deletes a real article rather than misplacing a pin.
SIMILARITY_THRESHOLD = 0.72


def title_similarity(left: str, right: str) -> float:
    """0.0–1.0 similarity of two headlines.

    ``token_sort_ratio``, not ``token_set_ratio``. The set variant scores a
    subset as a perfect 100 — "University announces tuition increase" against
    "University announces tuition increase after trustee vote" would come back
    1.0 and delete the longer, more informative piece. The sort variant
    tolerates reordering, which is what two newsrooms actually do to each
    other's phrasing, and still charges for the extra words.
    """
    return fuzz.token_sort_ratio(normalize_title(left), normalize_title(right)) / 100.0


# -- layer 3: simhash + banding ----------------------------------------------

SIMHASH_BITS = 64

#: 4 bands of 16 bits. The band width is not a tuning knob, it is a
#: correctness argument: two fingerprints within Hamming distance ``d`` can
#: differ in at most ``d`` bands, so with ``d <= 3`` and 4 bands at least one
#: band must match exactly. Banding therefore loses no true pair — it only
#: skips comparisons that could not have matched. Raising
#: :data:`SIMHASH_MAX_DISTANCE` above 3 without adding a band silently starts
#: dropping true pairs, so the two constants are checked against each other in
#: :func:`_band_keys`.
SIMHASH_BANDS = 4

#: 3 of 64 bits. Tight on purpose — this layer runs *after* layer 2 has already
#: passed on the pair, so it is looking for near-identity, not resemblance.
SIMHASH_MAX_DISTANCE = 3

_BAND_WIDTH = SIMHASH_BITS // SIMHASH_BANDS
_BAND_MASK = (1 << _BAND_WIDTH) - 1


def _token_hash(token: str) -> int:
    # blake2b, not builtin hash(): PYTHONHASHSEED randomizes str hashing per
    # process, so builtin hash() would make the fingerprint — and therefore
    # which articles survive — differ between runs of the same input.
    return int.from_bytes(hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest(), "big")


def simhash(tokens: Iterable[str]) -> int:
    """Charikar 64-bit fingerprint of a token stream.

    Each bit is the sign of the summed contributions of every token's hash at
    that position. Two token streams sharing most of their tokens agree in most
    bits, so Hamming distance is a similarity measure — which is what makes
    banding (an exact-match index) usable for a fuzzy question.
    """
    vector = [0] * SIMHASH_BITS
    empty = True
    for token in tokens:
        empty = False
        digest = _token_hash(token)
        for bit in range(SIMHASH_BITS):
            vector[bit] += 1 if digest >> bit & 1 else -1
    if empty:
        return 0
    fingerprint = 0
    for bit in range(SIMHASH_BITS):
        # Ties (vector[bit] == 0) resolve to 0. Arbitrary but deterministic,
        # which is the only property that matters.
        if vector[bit] > 0:
            fingerprint |= 1 << bit
    return fingerprint


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _band_keys(fingerprint: int) -> tuple[tuple[int, int], ...]:
    assert SIMHASH_MAX_DISTANCE < SIMHASH_BANDS, (
        "banding only preserves recall while max distance < band count — see SIMHASH_BANDS"
    )
    return tuple(
        (index, fingerprint >> (index * _BAND_WIDTH) & _BAND_MASK)
        for index in range(SIMHASH_BANDS)
    )


# -- the pass ----------------------------------------------------------------


@dataclass(frozen=True)
class _Candidate:
    article: Article
    key: str
    fingerprint: int | None


def _comparable(left: Article, right: Article) -> bool:
    """Whether the *fuzzy* layers may compare these two at all.

    They may not, if both came from the same publication. A newsroom running
    two pieces at two URLs has made an editorial decision, and collapsing them
    deletes one — the same deletion this module is built to avoid, just inside
    one masthead instead of across two. Cross-outlet syndication is the problem
    we have; one outlet's own archive is not.

    This is not a hunch, it is what the recorded corpus says. Every same-source
    pair scoring near :data:`SIMILARITY_THRESHOLD` is a genuinely distinct
    article, and two of them are close enough to be alarming:

    * ``ricurrent`` at **0.722** — "Grassley postpones vote in US Senate panel
      on Blanche nomination for AG" against "US Senate Judiciary holds over
      vote on Blanche nomination for AG as Grassley slams Dems". Two
      developments six days apart in one confirmation fight, and without this
      guard the later one is deleted.
    * ``bdh`` at **0.667** — "poly-tongued [narrative]" against "on violins
      [narrative]". Two unrelated pieces that score two thirds similar because
      they share a section tag and almost no other tokens.

    Meanwhile the only *cross*-source pair above 0.58 in the whole corpus is
    the true positive at 1.000. So the guard costs nothing real and removes the
    entire near-threshold danger zone.

    Layer 1 is deliberately not gated by this: an identical canonical URL is
    the same page, and a feed listing one page twice should collapse.
    """
    return left.source_id != right.source_id


def _fingerprint(title: str) -> int | None:
    """``None`` for a headline too short to fingerprint safely."""
    tokens = title_tokens(title)
    return simhash(tokens) if len(tokens) >= MIN_STEM_TOKENS else None


def deduplicate(articles: Sequence[Article]) -> tuple[list[Article], list[str]]:
    """Collapse cross-outlet duplicates. Returns survivors, newest-first, and
    a diagnostic naming every drop.

    Survivors come back in the same order ``feeds.collect_articles`` produces —
    newest first, ties broken on id — so this composes into that pipeline
    without reordering the artifact.

    The scan itself runs **earliest-published first**. That is what makes "keep
    the earliest" fall out of the algorithm instead of being a special case: by
    the time a later story is examined, the one that broke it is already a
    survivor, so the later one is the drop. Ties on the instant fall back to id
    so two stories filed in the same second do not swap between runs.
    """
    diagnostics: list[str] = []
    kept: list[_Candidate] = []
    by_key: dict[str, _Candidate] = {}
    by_band: dict[tuple[int, int], list[_Candidate]] = {}

    def drop(loser: Article, winner: Article, layer: int, why: str) -> None:
        # Both sides named, always. A merge that only records the survivor is
        # indistinguishable from an article that was never fetched.
        diagnostics.append(
            f"dedupe[L{layer} {why}]: dropped {loser.id} ({loser.source_id}) "
            f"{loser.url} published {loser.published} — duplicate of "
            f"{winner.id} ({winner.source_id}) {winner.url} published {winner.published}"
        )

    for article in sorted(articles, key=lambda a: (a.published_at, a.id)):
        key = syndication_key(article.url)

        # -- layer 1: the same link, however it was spelled.
        winner = by_key.get(key)
        if winner is not None:
            drop(article, winner.article, 1, "canonical-url")
            continue

        # -- layer 2: independently-written headlines that say the same thing.
        # O(n * kept) on purpose. These feeds are 10-100 items each and the
        # whole corpus is in the low hundreds, so the exhaustive comparison is
        # microseconds and needs no blocking scheme to reason about. If the
        # source count ever makes this hurt, block on published-date buckets
        # before reaching for a cheaper similarity metric.
        match = next(
            (
                candidate
                for candidate in kept
                if _comparable(article, candidate.article)
                and title_similarity(article.title, candidate.article.title)
                >= SIMILARITY_THRESHOLD
            ),
            None,
        )
        if match is not None:
            score = title_similarity(article.title, match.article.title)
            drop(article, match.article, 2, f"title-similarity {score:.2f}")
            continue

        # -- layer 3: the same headline wearing an outlet's clothes.
        # Layer 2 compares the full string, so a short headline with a long
        # masthead bolted on ("Brown lab wins grant | The Brown Daily Herald")
        # scores under 0.72 against its own bare form. Loosening layer 2 to
        # reach it would also start merging genuinely different coverage, so
        # the suffix is handled here instead — on the stem, with a threshold
        # tight enough that only near-identity qualifies.
        fingerprint = _fingerprint(article.title)
        if fingerprint is not None:
            bands = _band_keys(fingerprint)
            near = next(
                (
                    candidate
                    for band in bands
                    for candidate in by_band.get(band, ())
                    if _comparable(article, candidate.article)
                    and candidate.fingerprint is not None
                    and hamming(fingerprint, candidate.fingerprint) <= SIMHASH_MAX_DISTANCE
                ),
                None,
            )
            if near is not None:
                distance = hamming(fingerprint, near.fingerprint or 0)
                drop(article, near.article, 3, f"simhash d={distance}")
                continue

        candidate = _Candidate(article=article, key=key, fingerprint=fingerprint)
        kept.append(candidate)
        by_key[key] = candidate
        if fingerprint is not None:
            for band in _band_keys(fingerprint):
                by_band.setdefault(band, []).append(candidate)

    survivors = [candidate.article for candidate in kept]
    survivors.sort(key=lambda a: a.id)
    survivors.sort(key=lambda a: a.published_at, reverse=True)
    return survivors, diagnostics
