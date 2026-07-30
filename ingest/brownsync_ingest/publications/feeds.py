"""Brown student publications — a headline-only index of their RSS/Atom feeds.

**HEADLINE-ONLY, DELIBERATELY, FOR EVERY SOURCE.** The Brown Daily Herald's
Terms of Use prohibit obtaining, copying, monitoring, indexing or data-mining
their content by automated means, and the articles are copyright The Brown
Daily Herald, Inc. Their ``robots.txt`` permits crawling (``Crawl-delay: 10``)
but terms of service govern over a permissive robots.txt. We already shipped a
live violation once; this module is the second-system version that cannot.

Every feed here puts the *entire article body* in ``<description>`` — a single
BDH item in the recorded fixture is 12.8 kB of multi-paragraph prose, and even
the shortest is 122 bytes of copy. So we store exactly five facts about an
article — headline, canonical URL, timestamp, section, byline — and send the
reader to the publication. The mechanism is :data:`SAFE_ELEMENTS`: an
*allowlist* of element names, so ``description``, ``content:encoded``,
``summary`` and ``media:*`` are never bound to a name at all, let alone
published. This is the same discipline as ``safeMetadata()`` in
``services/poller/src/bdh/normalize.ts``; a new element appearing upstream has
to be added here deliberately rather than swept in by default.

``license: "headline-only"`` rides on every source row in the artifact. It is a
*field*, not a code path, so a consumer that starts rendering excerpts has to
ignore data rather than merely miss a branch. Loosening this requires written
permission from the publication and is an explicit, reviewable change here.

**What answered and what did not** (probed 2026-07-30 with the declared UA
``BrownSync/1.0 (+noah_finkelstein@brown.edu)``):

* BDH — 200. Note ``/feed/`` *with* a trailing slash 404s; ``/feed`` 302s to
  ``/plugin/feeds/top-stories.xml``, which is what we record.
* Brown Political Review — 200, WordPress RSS 2.0.
* The College Hill Independent and post- Magazine — gaps, see :data:`GAPS`.
  Recording a fixture for either would mean inventing one, which we do not do.

post- Magazine is not wholly lost: the BDH top-stories feed carries its items
under the ``post- magazine`` category, so they arrive as ``bdh`` rows with
``section == "post- magazine"`` rather than as a fifth source.
"""

from __future__ import annotations

from dataclasses import dataclass, fields as dataclass_fields
from datetime import datetime
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
from pathlib import Path
import re
from typing import Any, Iterable, Sequence
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import xml.etree.ElementTree as ElementTree

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "recorded" / "publications"

ATOM = "http://www.w3.org/2005/Atom"

#: Carried on every source row. See the licence note at the top of this file.
LICENSE = "headline-only"


@dataclass(frozen=True)
class FeedSource:
    id: str
    name: str
    homepage: str
    #: The URL a capture job should fetch. For the BDH this is the *resolved*
    #: target of the 302 from ``/feed`` — a harness that does not follow
    #: redirects records the 138-byte nginx stub and looks like it worked.
    feed_url: str
    fixture: str


SOURCES: tuple[FeedSource, ...] = (
    FeedSource(
        id="bdh",
        name="The Brown Daily Herald",
        homepage="https://www.browndailyherald.com/",
        feed_url="https://www.browndailyherald.com/plugin/feeds/top-stories.xml",
        fixture="browndailyherald.xml",
    ),
    FeedSource(
        id="bpr",
        name="Brown Political Review",
        homepage="https://brownpoliticalreview.org/",
        feed_url="https://brownpoliticalreview.org/feed/",
        fixture="brownpoliticalreview.xml",
    ),
)

#: Sources we tried and could not record, with the verbatim failure. Kept in
#: code rather than only in a probe log because the absence of the Indy from
#: the artifact is otherwise indistinguishable from "we never thought of it".
GAPS: dict[str, str] = {
    "indy": (
        "The College Hill Independent: https://www.theindy.org/feed answers 200 but with "
        "'Content-Type: text/html; charset=UTF-8' and a 2,276-byte body that is the site's "
        "React app shell — '<noscript>You need to enable JavaScript to run this app.</noscript>' "
        "and an empty '<div id=\"root\"></div>'. There is no RSS or Atom document at that URL "
        "to record."
    ),
    "post": (
        "post- Magazine: https://www.postmagazinebdh.com/feed/ does not resolve — "
        "'curl: (6) Could not resolve host: www.postmagazinebdh.com', NXDOMAIN for both the "
        "apex and the www label. The SNworks section feed on the BDH install, "
        "https://www.browndailyherald.com/plugin/feeds/post-.xml, answers 200 with a "
        "zero-byte body. post- items do appear in the BDH top-stories feed under the "
        "'post- magazine' category."
    ),
}

#: The ONLY elements read from a feed entry, mapped to the role they fill.
#:
#: An allowlist, not a denylist — this is the licence guarantee in one table.
#: ``description``, ``content:encoded``, ``summary``, ``content`` and
#: ``media:*`` are absent, so the body is never bound to a Python name.
SAFE_ELEMENTS: dict[str, str] = {
    # RSS 2.0
    "title": "title",
    "link": "url",
    "guid": "guid",
    "pubDate": "published",
    "category": "category",
    "author": "author",
    "{http://purl.org/dc/elements/1.1/}creator": "author",
    # Atom
    f"{{{ATOM}}}title": "title",
    f"{{{ATOM}}}link": "url",
    f"{{{ATOM}}}id": "guid",
    f"{{{ATOM}}}published": "published",
    f"{{{ATOM}}}updated": "published",
    f"{{{ATOM}}}category": "category",
    f"{{{ATOM}}}author": "author",
}

#: Values that appear in ``<category>`` but describe *placement*, not a
#: section. SNworks tags front-page items ``homepage`` and urgent ones
#: ``breaking``; taking the first category blindly would file a story under
#: "homepage" the day the CMS reorders them.
PLACEMENT_CATEGORIES: frozenset[str] = frozenset({"homepage", "breaking"})

#: A headline is a headline. The longest in the recorded fixtures is 108
#: characters; the shortest article body is 122. This is the crude backstop
#: under the allowlist — if a body ever reaches a field, it is also too long.
MAX_TITLE_CHARS = 300

#: Query parameters dropped during canonicalization. Only campaign tracking:
#: an arbitrary parameter can be load-bearing (`?p=46562` identifies a
#: WordPress post), so the rule is a denylist and not "strip the query".
_TRACKING_PARAMS = re.compile(r"^utm_", re.IGNORECASE)

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class Article:
    id: str
    source_id: str
    title: str
    url: str
    #: Timezone-aware. Sorting happens on this, never on the ISO string — see
    #: the note in :func:`collect_articles`.
    published_at: datetime
    section: str | None
    author: str | None

    @property
    def published(self) -> str:
        """ISO-8601 keeping the publication's own offset.

        Not normalized to UTC: "-04:00" says a Providence newsroom posted this
        at 12:36 am, which is the fact a reader recognizes. The instant is
        unambiguous either way because the offset is present.
        """
        return self.published_at.isoformat()


# -- parsing -----------------------------------------------------------------


def _text(value: str | None) -> str | None:
    """Collapse whitespace to single spaces and strip; empty becomes None.

    Two source quirks are handled here rather than at each call site:

    * NBSP is folded to a space (NFKC). A BPR headline ends with a literal
      U+00A0, which ``str.strip()`` leaves in place; it renders as a stray gap
      and breaks equality against the same headline from another feed.
    * HTML entities are unescaped *after* the XML parse. SNworks wraps values
      in CDATA **and** HTML-escapes inside it, so the XML parser hands back the
      literal text ``Arts &amp; Culture``. Unescaping is safe to apply to the
      other feeds too: a value that was only XML-escaped has already been
      decoded once and contains no entity left to decode.
    """
    if value is None:
        return None
    normalized = _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", unescape(value))).strip()
    return normalized or None


def _element_value(element: ElementTree.Element) -> str | None:
    """The payload of an allowlisted element, wherever the format hides it.

    RSS puts it in the text node; Atom puts a link in ``@href``, a category in
    ``@term`` and an author in a child ``<name>``.
    """
    return (
        _text(element.text)
        or _text(element.get("href"))
        or _text(element.get("term"))
        or _text(element.findtext(f"{{{ATOM}}}name"))
    )


def safe_fields(entry: ElementTree.Element) -> dict[str, list[str]]:
    """Entry element → allowlisted values only, keyed by role.

    Iterating the children and *looking each tag up* (rather than reaching for
    the tags we want) is what makes the licence guarantee structural: an
    element missing from :data:`SAFE_ELEMENTS` is skipped before its text is
    ever read.
    """
    fields: dict[str, list[str]] = {}
    for child in entry:
        role = SAFE_ELEMENTS.get(child.tag)
        if role is None:
            continue
        # Atom's rel="self"/"replies" links are not the article; only the
        # default (alternate) link is.
        if child.tag == f"{{{ATOM}}}link" and child.get("rel") not in (None, "alternate"):
            continue
        value = _element_value(child)
        if value:
            fields.setdefault(role, []).append(value)
    return fields


def parse_timestamp(value: str) -> datetime | None:
    """RFC 2822 (RSS) or ISO-8601 (Atom) → aware datetime, else None.

    A naive result is rejected rather than assumed to be Eastern: guessing an
    offset silently shifts an article by up to a day in the sort.
    """
    parsed: datetime | None = None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        parsed = None
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        return None
    return parsed


def canonical_url(url: str) -> str:
    """The dedup key and the published link, in one form.

    Lowercases scheme and host (case-insensitive by RFC, but two feeds spelling
    the host differently would otherwise be two articles), drops the fragment
    and ``utm_*`` campaign parameters, and trims a trailing slash. The scheme
    is never rewritten — an http→https "upgrade" changes where the reader lands.
    """
    parts = urlsplit(url.strip())
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
         if not _TRACKING_PARAMS.match(key)]
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


def article_id(canonical: str) -> str:
    """Stable hash of the canonical URL.

    URL-derived rather than feed-derived: the BPR's ``<guid>`` is
    ``?p=46562`` with ``isPermaLink="false"``, so guids are not comparable
    across publications — but the same story syndicated into two feeds has one
    URL, and must land on one id.
    """
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def parse_feed(xml_text: str, source: FeedSource) -> tuple[list[Article], list[str]]:
    """Raw feed XML → articles. Malformed individual entries are skipped.

    Skipping is per-entry and diagnosed, never fatal: one item with a broken
    date should not take down the other 34.
    """
    diagnostics: list[str] = []
    root = ElementTree.fromstring(xml_text)
    entries = root.findall("./channel/item") or root.findall(f"{{{ATOM}}}entry")
    if not entries:
        diagnostics.append(f"{source.id}: feed parsed but carries no <item>/<entry>")

    articles: list[Article] = []
    for entry in entries:
        fields = safe_fields(entry)
        title = next(iter(fields.get("title", [])), None)
        raw_url = next(iter(fields.get("url", [])), None)
        # A guid is only a fallback URL when it is spelled like one; the BPR's
        # is an opaque query string.
        if raw_url is None:
            raw_url = next(
                (g for g in fields.get("guid", []) if g.startswith(("http://", "https://"))),
                None,
            )
        stamp = next(iter(fields.get("published", [])), None)
        published_at = parse_timestamp(stamp) if stamp else None

        if not title or not raw_url or published_at is None:
            diagnostics.append(
                f"{source.id}: skipped an entry missing title/url/published "
                f"(title={bool(title)}, url={bool(raw_url)}, published={stamp!r})"
            )
            continue

        section = next(
            (c for c in fields.get("category", []) if c.lower() not in PLACEMENT_CATEGORIES),
            None,
        )
        canonical = canonical_url(raw_url)
        articles.append(
            Article(
                id=article_id(canonical),
                source_id=source.id,
                title=title,
                url=canonical,
                published_at=published_at,
                # WordPress emits categories before tags in the same
                # <category> element, so the first survivor is the section.
                section=section,
                author=next(iter(fields.get("author", [])), None),
            )
        )
    return articles, diagnostics


def load_feed(source: FeedSource, fixture_dir: Path | None = None) -> str:
    path = (fixture_dir or FIXTURE_DIR) / source.fixture
    return path.read_text(encoding="utf-8")


def collect_articles(
    sources: Sequence[FeedSource] = SOURCES,
    fixture_dir: Path | None = None,
) -> tuple[list[Article], dict[str, str], list[str]]:
    """Every feed, deduped on canonical URL and sorted newest-first.

    Returns the articles, the raw feed text per source id (the body-leak gate
    needs the prose it is checking *against*), and diagnostics.
    """
    diagnostics: list[str] = []
    raw_by_source: dict[str, str] = {}
    articles: list[Article] = []
    seen: dict[str, str] = {}

    for source in sources:
        raw = load_feed(source, fixture_dir)
        raw_by_source[source.id] = raw
        parsed, notes = parse_feed(raw, source)
        diagnostics.extend(notes)
        for article in parsed:
            # Dedup on the URL only. Two outlets covering the same event are
            # two articles even under one headline — collapsing on title
            # similarity would delete the BPR's take on a BDH story.
            first = seen.get(article.url)
            if first is not None:
                diagnostics.append(f"{source.id}: {article.url} already seen from {first}")
                continue
            seen[article.url] = source.id
            articles.append(article)

    for source_id, reason in sorted(GAPS.items()):
        diagnostics.append(f"gap: {source_id} — {reason}")

    # Sort on the instant, never the string: "2026-07-09T22:00:00-04:00" sorts
    # BEFORE "2026-07-10T01:00:00+00:00" lexically and AFTER it in real time,
    # and the BDH publishes at -04:00 while the BPR publishes at +00:00.
    articles.sort(key=lambda a: a.id)
    articles.sort(key=lambda a: a.published_at, reverse=True)
    return articles, raw_by_source, diagnostics


# -- the licence gate --------------------------------------------------------

#: Length of the word run compared between published fields and feed bodies.
#: Five words is long enough that shared phrasing ("The Brown Daily Herald")
#: is not a match and short enough that a one-sentence excerpt is.
SHINGLE_WORDS = 5

_WORDS = re.compile(r"[\w']+")
_TAGS = re.compile(r"<[^>]+>")

#: Elements whose text is article prose. Never read by :func:`safe_fields` —
#: this list exists so the gate knows what it is checking *against*.
BODY_ELEMENTS: tuple[str, ...] = (
    "description",
    "{http://purl.org/rss/1.0/modules/content/}encoded",
    f"{{{ATOM}}}summary",
    f"{{{ATOM}}}content",
)

#: Elements the gate accepts as legitimately quotable — a headline is often
#: repeated verbatim inside the body ("The post <a>Title</a> appeared first
#: on ..."), and that overlap must not read as a leak.
METADATA_ELEMENTS: tuple[str, ...] = (
    "title",
    "author",
    "category",
    "{http://purl.org/dc/elements/1.1/}creator",
    f"{{{ATOM}}}title",
    f"{{{ATOM}}}category",
)


def _shingles(text: str) -> set[str]:
    words = _WORDS.findall(_TAGS.sub(" ", text).casefold())
    return {
        " ".join(words[index : index + SHINGLE_WORDS])
        for index in range(len(words) - SHINGLE_WORDS + 1)
    }


#: Excluded from the prose check, and checked by :func:`synthetic_urls`
#: instead. A canonical URL's slug is *generated from the headline*, so its
#: word runs echo the body by construction — "noah-kahan-out-of-body-tour"
#: tokenizes to a run that the article body also contains, while the headline
#: spells it "Kahan's 'Out of Body'" and so does not cover it. Checking the URL
#: for prose therefore fails on correct data; checking its provenance does not.
PROSE_EXEMPT_FIELDS: frozenset[str] = frozenset({"url"})


def forbidden_shingles(raw: str) -> set[str]:
    """Word runs that exist in a feed's article bodies and nowhere else in it.

    Subtracting the headline/byline/section runs matters: a body routinely
    quotes its own headline ("The post <a>Title</a> appeared first on ..."),
    and that overlap is not a leak.
    """
    root = ElementTree.fromstring(raw)
    body: set[str] = set()
    quotable: set[str] = set()
    for element in root.iter():
        if element.tag in BODY_ELEMENTS:
            # itertext, not .text: an Atom <content type="xhtml"> body is child
            # elements, and reading only .text would check a prefix.
            body |= _shingles("".join(element.itertext()))
        elif element.tag in METADATA_ELEMENTS and element.text:
            quotable |= _shingles(_text(element.text) or "")
    return body - quotable


def body_text_leaks(articles: Iterable[Article], raw_by_source: dict[str, str]) -> list[str]:
    """Byte-level proof that no published record carries feed prose.

    Not a shape check — it reads the bodies we refuse to store and asserts that
    no word run unique to them reaches a published field. The fields are
    enumerated from the dataclass rather than listed, so a future ``excerpt``
    holding the first 200 characters of ``<description>`` is gated the moment
    it is added, without anyone remembering to extend this function.
    """
    forbidden = {source_id: forbidden_shingles(raw) for source_id, raw in raw_by_source.items()}

    failures: list[str] = []
    for article in articles:
        published = " ".join(
            value
            for field in dataclass_fields(article)
            if field.name not in PROSE_EXEMPT_FIELDS
            and isinstance(value := getattr(article, field.name), str)
        )
        overlap = _shingles(published) & forbidden.get(article.source_id, set())
        if overlap:
            failures.append(
                f"{article.id} ({article.source_id}) carries body text: {sorted(overlap)[0]!r}"
            )
    return failures


def feed_urls(raw: str) -> set[str]:
    """Every canonicalized ``<link>``/``<guid>`` the feed itself published."""
    root = ElementTree.fromstring(raw)
    urls: set[str] = set()
    for element in root.iter():
        if SAFE_ELEMENTS.get(element.tag) not in ("url", "guid"):
            continue
        value = _element_value(element)
        if value and value.startswith(("http://", "https://")):
            urls.add(canonical_url(value))
    return urls


def synthetic_urls(articles: Iterable[Article], raw_by_source: dict[str, str]) -> list[str]:
    """URLs that the feed never published — the provenance half of the gate.

    ``url`` is exempt from the prose check, so it needs its own proof. Every
    published link must be the canonicalization of a link or permalink guid
    that appeared in the source, which is what makes "the URL is not prose"
    a fact rather than an assumption.
    """
    known = {source_id: feed_urls(raw) for source_id, raw in raw_by_source.items()}
    return [
        f"{article.id} ({article.source_id}) links to {article.url}, "
        "which the feed never published"
        for article in articles
        if article.url not in known.get(article.source_id, set())
    ]


# -- document ----------------------------------------------------------------


def build_document(
    sources: Sequence[FeedSource],
    articles: Sequence[Article],
    generated_at: str,
) -> dict[str, Any]:
    """The published artifact. Schema v1.

    ``sources`` lists only what actually contributed, so a consumer can treat
    ``sourceId`` as a total lookup into it rather than a partial one; the
    sources we could not reach are diagnostics, not empty rows.
    """
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "sources": [
            {
                "id": source.id,
                "name": source.name,
                "homepage": source.homepage,
                "license": LICENSE,
            }
            for source in sources
        ],
        "articles": [
            {
                "id": article.id,
                "sourceId": article.source_id,
                "title": article.title,
                "url": article.url,
                "published": article.published,
                "section": article.section,
                "author": article.author,
            }
            for article in articles
        ],
    }


# -- job ---------------------------------------------------------------------

#: The BDH feed is 35 items and the BPR's is 10. A feed that truncates to a
#: handful is a broken feed, not a slow news week — the archive does not shrink.
MIN_ARTICLES = 30

#: One outlet is a single point of failure and reads as an editorial choice we
#: did not make. Two of the four probed sources answer; both must.
MIN_SOURCES = 2


@dataclass(frozen=True)
class PublicationsJobResult:
    articles: tuple[Article, ...]
    document: dict[str, Any]
    gate_failures: tuple[str, ...]
    published_count: int | None
    diagnostics: tuple[str, ...]


def run_publications_job(
    *,
    seeds_dir: Path | str,
    staging_root: Path | str,
    sources: Sequence[FeedSource] = SOURCES,
    fixture_dir: Path | None = None,
    generated_at: str | None = None,
) -> PublicationsJobResult:
    """Build and publish ``publications.json`` when every gate passes."""
    from brownsync_ingest.output import publish_json_document

    seeds_dir = Path(seeds_dir)
    articles, raw_by_source, diagnostics = collect_articles(sources, fixture_dir)

    # GATES FIRST — same rule and same reason as run_dining_job: a gate that
    # runs after the document is assembled is one refactor away from being a
    # gate that runs after it is written. Nothing below touches the filesystem
    # until every check has passed, so a bad drop leaves yesterday's artifact
    # exactly where it was.
    gate_failures: list[str] = []
    if len(articles) < MIN_ARTICLES:
        gate_failures.append(f"articles: {len(articles)} < required {MIN_ARTICLES}")

    contributing = {article.source_id for article in articles}
    if len(contributing) < MIN_SOURCES:
        silent = [source.id for source in sources if source.id not in contributing]
        gate_failures.append(
            f"sources with articles: {len(contributing)} < required {MIN_SOURCES}"
            + (f" — silent: {', '.join(silent)}" if silent else "")
        )

    # Defence in depth: parse_feed already drops entries missing any of these,
    # so this only fires if a future parser change starts letting them through.
    # It is here so that change cannot publish a half-empty article silently.
    incomplete = [
        article.id
        for article in articles
        if not article.title.strip()
        or not article.url.strip()
        or article.published_at.tzinfo is None
    ]
    if incomplete:
        gate_failures.append(f"article(s) missing title/url/published: {', '.join(incomplete)}")

    overlong = [article.id for article in articles if len(article.title) > MAX_TITLE_CHARS]
    if overlong:
        gate_failures.append(
            f"title(s) over {MAX_TITLE_CHARS} chars: {', '.join(overlong)} "
            "— a headline that long is a body that got in"
        )

    # The licence gate, in two halves: no field carries prose, and the one
    # field exempt from that check came from the feed rather than from us.
    # Publishing body text from these sources is the failure we already
    # shipped once; it fails closed like every other gate.
    gate_failures.extend(f"licence: {leak}" for leak in body_text_leaks(articles, raw_by_source))
    gate_failures.extend(
        f"provenance: {note}" for note in synthetic_urls(articles, raw_by_source)
    )

    document: dict[str, Any] = {}
    published_count: int | None = None
    if not gate_failures:
        stamp = generated_at or datetime.now().astimezone().isoformat()
        contributing_sources = [source for source in sources if source.id in contributing]
        document = build_document(contributing_sources, articles, stamp)
        publish_json_document(
            document, seeds_dir / "publications.json", Path(staging_root), compact=True
        )
        published_count = len(articles)

    return PublicationsJobResult(
        articles=tuple(articles),
        document=document,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
        diagnostics=tuple(diagnostics),
    )
