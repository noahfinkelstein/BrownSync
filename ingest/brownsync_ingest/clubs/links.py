"""Social links for an organization, recovered from the student-groups export.

Contract v1 keeps exactly two link fields on ``organizations`` (``url`` and
``instagram``) and ``clubs/job.py`` DROPS the rest with a per-column count.
This module is the pure parser that turns one export row into the full set of
usable links, so the drop can become a deliberate, audited emission rather
than a silent loss. It is intentionally NOT wired into the CLI here.

Two rules earn their own names, because both were learned from the data:

**Platform comes from the HOST, never from the column.** The 2026-07-29
export has 7 ``facebook.com`` URLs and 2 ``instagram.com`` URLs sitting in
``website_url`` — clubs paste whatever link they hand out. Trusting the
column name would publish a Facebook page under a globe icon and, worse,
would let a Discord invite masquerade as a homepage.

**A link that is not http(s) is not a link.** ``mailto:`` addresses and bare
handles (``@brownoutingclub``) look like content but render as broken
anchors: ``href="@brownoutingclub"`` resolves against the current page and
navigates the reader to a 404 inside our own site. Those are dropped with a
diagnostic. The single exception is a bare handle in the *instagram* column,
where the column supplies the namespace the value is missing and the handle
can be completed into a real profile URL. That is the one place the column
name is allowed to matter, and only because the value is not a URL at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


#: Link platforms. ``website`` is the catch-all, not a failure: a club's own
#: domain is a first-class link, it just has no glyph of its own.
PLATFORMS: tuple[str, ...] = (
    "instagram",
    "discord",
    "linktree",
    "facebook",
    "twitter",
    "linkedin",
    "website",
)

#: Host suffix -> platform. Matched against the registrable-ish host with any
#: leading ``www.`` folded off, and as a SUFFIX so ``m.facebook.com`` and
#: ``ca.linkedin.com`` classify correctly. Order is irrelevant; the longest
#: matching suffix wins.
_HOST_PLATFORMS: tuple[tuple[str, str], ...] = (
    ("instagram.com", "instagram"),
    ("discord.gg", "discord"),
    ("discord.com", "discord"),
    ("discordapp.com", "discord"),
    ("linktr.ee", "linktree"),
    ("facebook.com", "facebook"),
    ("fb.com", "facebook"),
    ("x.com", "twitter"),
    ("twitter.com", "twitter"),
    ("linkedin.com", "linkedin"),
)

#: Columns scanned, in emission order. ``source_url`` and
#: ``directory_source_url`` are deliberately absent: they are the
#: studentactivities.brown.edu listing pages, identical or near-identical for
#: all 457 rows, and ``job.py`` already uses ``source_url`` as the fallback
#: for ``url``. Including them here would bury the two or three links a club
#: actually maintains under a directory URL every club shares.
LINK_COLUMNS: tuple[str, ...] = (
    "website_url",
    "instagram_url",
    "facebook_url",
    "linkedin_url",
    "youtube_url",
    "twitter_url",
    "tiktok_url",
    "other_social_urls",
)

#: The column whose bare values are handles rather than hostnames.
_HANDLE_COLUMN = "instagram_url"

#: Campaign parameters only. A denylist, not "strip the query": the export
#: contains ``facebook.com/profile.php?id=61571865550828`` and
#: ``listserv.brown.edu/cgi-bin/wa?SUBED1=FRENCH_THEORY``, where the query IS
#: the identity of the page. Dropping it would produce a link that loads and
#: shows the wrong thing — the worst kind of broken.
_TRACKING_PARAMS = re.compile(
    r"^(?:utm_|fbclid$|gclid$|igshid$|igsh$|mc_cid$|mc_eid$|ref_src$|ref_url$)",
    re.IGNORECASE,
)

#: ``other_social_urls`` is empty in every row of the pinned export, so its
#: separator is unmeasured. Accepting all the plausible ones costs nothing and
#: means a future export with a populated column degrades to "maybe one link
#: too many" instead of "one string that is not a URL".
_MULTI_SEPARATORS = re.compile(r"[\s,;|]+")

#: A value that already looks like a host (``brownwarwatch.com``,
#: ``sites.brown.edu/x``) versus one that does not (``@brownoutingclub``,
#: ``brownoutingclub``). Requires a dot and an alphabetic final label, so a
#: handle can never be mistaken for a domain — the ambiguous middle
#: (``brown.outing``, a legal Instagram handle that also parses as a domain)
#: is resolved toward "domain", because guessing "handle" there fabricates an
#: instagram.com URL for a club that never claimed one.
_HOSTLIKE = re.compile(r"^[A-Za-z0-9._~-]+\.[A-Za-z]{2,24}(?::\d+)?(?:[/?#].*)?$")

#: Instagram usernames: letters, digits, period, underscore, <= 30 chars.
_HANDLE = re.compile(r"^@?[A-Za-z0-9._]{1,30}$")

_INSTAGRAM_PROFILE = "https://instagram.com/"


@dataclass(frozen=True)
class OrgLink:
    """One usable link: an absolute http(s) URL and what it points at.

    ``source_column`` is kept for auditability — when a Facebook page shows up
    under ``website_url`` the report should be able to say so rather than
    leaving a reviewer to wonder whether the classifier invented it.
    """

    platform: str
    url: str
    source_column: str

    def __post_init__(self) -> None:
        if self.platform not in PLATFORMS:
            raise ValueError(f"unknown platform {self.platform!r}")
        if not self.url.startswith(("http://", "https://")):
            raise ValueError(f"OrgLink.url must be absolute http(s), got {self.url!r}")


def classify_platform(url: str) -> str:
    """Platform for an absolute URL, decided by its host.

    Falls back to ``website`` — an unrecognized host is a club homepage, not
    an error.
    """
    host = urlsplit(url).netloc.lower()
    host = host.split("@")[-1].split(":")[0]  # strip userinfo and port
    if host.startswith("www."):
        host = host[4:]
    best: tuple[int, str] = (0, "website")
    for suffix, platform in _HOST_PLATFORMS:
        if host == suffix or host.endswith("." + suffix):
            if len(suffix) > best[0]:
                best = (len(suffix), platform)
    return best[1]


def normalize_url(url: str) -> str:
    """Canonical form of an absolute URL: the dedupe key and the href, in one.

    Lowercases scheme and host, drops the fragment and campaign parameters,
    and trims trailing slashes. The scheme is never rewritten — silently
    "upgrading" http to https changes where the reader lands and can break a
    site that never got a certificate.
    """
    parts = urlsplit(url.strip())
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not _TRACKING_PARAMS.match(key)
        ]
    )
    host = parts.netloc.lower()
    # A bare host with no path is a valid absolute URL ("https://example.org");
    # rstrip on an empty path is a no-op, so the root case needs no branch.
    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), host, path, query, ""))


def _resolve(value: str, column: str) -> tuple[str | None, str | None]:
    """One raw cell value -> (absolute url, diagnostic). Exactly one is set."""
    raw = value.strip()
    if not raw:
        return None, None

    scheme = urlsplit(raw).scheme.lower()
    # `urlsplit("brown.edu:8080/x")` reports the scheme as "brown.edu" — a
    # host:port pair, not a scheme. Real schemes have no dot, so a dotted one
    # means the value is scheme-LESS and falls through to the host branch.
    if scheme and "." not in scheme:
        if scheme not in ("http", "https"):
            # mailto:, tel:, javascript:, ftp: — all render as anchors that do
            # something other than open a page. Never emitted.
            return None, f"{column}: {raw!r} is {scheme}:, not http(s)"
        normalized = normalize_url(raw)
        if not urlsplit(normalized).netloc:
            # "https://" and "http:///path" carry a scheme and no host; the
            # anchor would resolve against our own origin.
            return None, f"{column}: {raw!r} has no host"
        return normalized, None

    # Scheme-less from here. Protocol-relative ("//instagram.com/x") is a URL
    # missing only its scheme, so it takes the same https default as a bare
    # host rather than falling into the handle branch.
    candidate = raw[2:] if raw.startswith("//") else raw
    if _HOSTLIKE.match(candidate):
        return normalize_url("https://" + candidate), None

    if column == _HANDLE_COLUMN and _HANDLE.match(candidate):
        # The column supplies the namespace the value is missing. This is the
        # ONLY place a column name decides anything.
        return normalize_url(_INSTAGRAM_PROFILE + candidate.lstrip("@")), None

    return None, f"{column}: {raw!r} is not a URL and no platform can be inferred"


def parse_links_with_diagnostics(
    row: Mapping[str, Any],
) -> tuple[tuple[OrgLink, ...], tuple[str, ...]]:
    """:func:`parse_links`, plus one diagnostic per rejected value.

    Rejections are per-value and never fatal: a club with a ``mailto:`` in
    ``website_url`` and a real Instagram URL must still publish the Instagram
    link. The diagnostics exist so the run report can say what was dropped,
    which is the difference between a data-quality signal and a silent hole.
    """
    links: list[OrgLink] = []
    diagnostics: list[str] = []
    seen: set[str] = set()

    for column in LINK_COLUMNS:
        cell = row.get(column)
        if cell is None:
            continue
        if not isinstance(cell, str):
            diagnostics.append(
                f"{column}: expected a string, got {type(cell).__name__} {cell!r}"
            )
            continue
        for value in _MULTI_SEPARATORS.split(cell.strip()):
            url, diagnostic = _resolve(value, column)
            if diagnostic is not None:
                diagnostics.append(diagnostic)
            if url is None:
                continue
            # Dedupe folds `www.` and case so the same page listed as
            # `facebook.com/x` (website_url) and `www.facebook.com/x`
            # (facebook_url) — which happens in the real export — is one link.
            # The emitted URL keeps its `www.`: some hosts still need it.
            key = re.sub(r"^(https?://)www\.", r"\1", url.lower())
            if key in seen:
                continue
            seen.add(key)
            links.append(
                OrgLink(platform=classify_platform(url), url=url, source_column=column)
            )

    return tuple(links), tuple(diagnostics)


def parse_links(row: Mapping[str, Any]) -> tuple[OrgLink, ...]:
    """Every usable link on one student-groups row, deduped, in column order.

    Pure: no I/O, no network, no dependence on the row being a
    :class:`~brownsync_ingest.clubs.models.ClubRecord` — any mapping with the
    export's column names works, which is what makes it testable against
    hand-built rows AND against the real CSV.

    Every returned ``OrgLink.url`` is an absolute ``http``/``https`` URL. That
    is the whole point: the frontend renders these as anchors and must never
    have to defend itself against ``mailto:`` or ``@handle``.
    """
    links, _ = parse_links_with_diagnostics(row)
    return links
