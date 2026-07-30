"""Widening the feed past the two student papers — probes, sources, gaps.

``feeds.py`` indexes the BDH and the BPR. Two outlets is a thin campus feed and,
worse, it reads as an editorial choice: the stories Brown students argue about
are frequently broken by the University's own newsroom or by the statewide
press, and a reader who only ever sees the student papers cannot tell whether
that is the whole record or the whole of what we bothered to fetch.

This module adds the sources that answered, and — just as importantly — writes
down the ones that did not, with the verbatim reason. It is the same
:class:`~brownsync_ingest.publications.feeds.FeedSource` type and the same
:data:`~brownsync_ingest.publications.feeds.SAFE_ELEMENTS` allowlist, so
**every source added here is headline-only too**. Nothing below relaxes the
licence discipline; two of the gaps exist *because* of it.

**What answered and what did not** (probed 2026-07-30 with the declared UA
``BrownSync/1.0 (+noah_finkelstein@brown.edu)``, one request per URL):

* Brown University newsroom — 200. The feed is at the site root,
  ``https://www.brown.edu/rss.xml``, **not** under ``/news``: ``/news/rss.xml``,
  ``/news/rss``, ``/news/feed`` and ``/news/latest/rss`` all 404, and
  ``brown.edu/news`` publishes no ``<link rel="alternate">`` to discover it
  from. 10 items, Drupal 11 RSS 2.0.
* Rhode Island Current — 200, 100 items, WordPress RSS 2.0. Statewide
  nonprofit newsroom; see :data:`_RICURRENT_LICENCE` for why it is in and not
  a gap.
* Google News, r/brownu, Brown Alumni Magazine, Watson, the School of Public
  Health and X — gaps, see :data:`EXTENDED_GAPS`. Two of those answered 200 and
  are still gaps, which is the point of keeping the reasons verbatim.

**Fixtures live in a subdirectory** (``recorded/publications/extended/``) and
the ``fixture`` field carries that relative path. That is deliberate:
``test_feeds.py::test_no_fixture_exists_for_a_gap`` asserts that
``FIXTURE_DIR.glob("*.xml")`` is exactly the set of files behind ``SOURCES``,
and dropping two more ``.xml`` files beside the existing pair would fail it
while these sources are still unregistered. ``Path.glob("*.xml")`` does not
descend, so the existing suite keeps passing; ``load_feed`` joins the relative
path and reads them fine. When these are promoted into ``SOURCES``, move the
files up one level and drop the ``extended/`` prefix — the assertion is worth
keeping, not working around.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import re
from typing import Sequence

from brownsync_ingest.publications.feeds import (
    GAPS,
    SOURCES,
    Article,
    FeedSource,
    collect_articles,
)
from brownsync_ingest.publications.dedupe import deduplicate

#: Why Rhode Island Current is a source and not a gap, recorded because it is
#: the one judgement call here that a reviewer should be able to re-check
#: rather than take on trust.
#:
#: Their ``robots.txt`` opens with a ``User-agent: *`` group carrying
#: ``Content-Signal: search=yes,ai-train=no,use=reference`` and ``Allow: /``.
#: The file defines ``search`` as "building a search index and providing search
#: results (e.g., returning hyperlinks and short excerpts from your website's
#: contents)" — which is exactly and only what a headline-plus-link index is.
#: ``ai-train=no`` is honoured trivially: nothing here trains anything.
#: The file separately names ``ClaudeBot``, ``Claude-Web``, ``Anthropic-ai``,
#: ``GPTBot``, ``CCBot`` and friends with ``Disallow: /``; those are AI
#: crawlers, and we are not one of them — we fetch one feed URL under our own
#: declared UA with a contact address. The distinction is theirs, drawn in
#: their own file, and we sit on the allowed side of it.
#:
#: Corroborating, not load-bearing: the feed itself republishes KFF Health News
#: and CT Mirror articles "under a Creative Commons
#: Attribution-NonCommercial-NoDerivatives 4.0 International License", so the
#: outlet operates in the CC-republication ecosystem. We store strictly less
#: than that licence permits.
_RICURRENT_LICENCE = "robots.txt: User-agent: * / Content-Signal: search=yes,ai-train=no,use=reference / Allow: /"


EXTENDED_SOURCES: tuple[FeedSource, ...] = (
    FeedSource(
        id="brown",
        name="Brown University",
        homepage="https://www.brown.edu/news",
        # NOT /news/rss.xml — that 404s. The Drupal frontpage feed at the site
        # root is the only RSS document this install serves.
        feed_url="https://www.brown.edu/rss.xml",
        fixture="extended/brownuniversity.xml",
    ),
    FeedSource(
        id="ricurrent",
        name="Rhode Island Current",
        homepage="https://rhodeislandcurrent.com/",
        feed_url="https://rhodeislandcurrent.com/feed/",
        fixture="extended/rhodeislandcurrent.xml",
    ),
)

#: Probed and not recorded, with the verbatim failure. Same contract as
#: :data:`~brownsync_ingest.publications.feeds.GAPS`: a source that is simply
#: absent is indistinguishable from one nobody thought of, and "answered 200"
#: is not the same fact as "may be used".
EXTENDED_GAPS: dict[str, str] = {
    "gnews": (
        "Google News RSS: https://news.google.com/rss/search?q=%22Brown+University%22+Providence"
        "&hl=en-US&gl=US&ceid=US:en answers 200 with 100 items, and is a gap for two independent "
        "reasons, either of which is sufficient. (1) LICENCE. The feed's own <copyright> element "
        "reads verbatim: 'Copyright © 2026 Google. All rights reserved. This XML feed is made "
        "available solely for the purpose of rendering Google News results within a personal feed "
        "reader for personal, non-commercial use. Any other use of the feed is expressly "
        "prohibited. By accessing this feed or using these results in any manner whatsoever, you "
        "agree to be bound by the foregoing restrictions.' Ingesting it into a published artifact "
        "is not a personal feed reader. (2) UNRESOLVABLE LINKS. Every <link> is "
        "https://news.google.com/rss/articles/<id>, where <id> is base64url of a protobuf whose "
        "payload is an opaque Google identifier: 0 of 100 decoded ids contain a literal http URL "
        "(sample decode: b'\\x08\\x13\"\\x97\\x01AU_yqLPLTKV2M0nVF_wE5nMYcrMAG5XqSwen9gugonv...'). "
        "Resolving them needs an undocumented internal POST to /_/DotsSplashUi/data/batchexecute, "
        "which we will not do. Unresolved, dedupe layer 1 is a no-op against the publisher feeds, "
        "so all 22 'Brown University' and 3 'The Brown Daily Herald' items in the sample would "
        "arrive as permanent duplicates of stories we already index under their real URLs."
    ),
    "reddit_brownu": (
        "r/brownu: NOT FETCHED. https://www.reddit.com/robots.txt answers 200 and its only "
        "user-agent group is verbatim 'User-agent: *' / 'Disallow: /', under the header "
        "'Reddit believes in an open internet, but not the misuse of public content. See "
        "https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy "
        "Reddit's Public Content Policy for access and use restrictions to Reddit content.' "
        "A blanket Disallow for our UA is the site operator's answer to the request before we "
        "make it, so https://www.reddit.com/r/brownu/top.json was never requested. This is a "
        "policy gap, not a transport failure: there is no 403 or 429 to quote because we did "
        "not knock. Lawful routes exist and both need a decision we do not get to make on our "
        "own: the official OAuth API under a registered app, or Reddit's Data API terms."
    ),
    "bam": (
        "Brown Alumni Magazine: https://www.brownalumnimagazine.com/rss.xml answers 200 with "
        "'Content-Type: application/rss+xml; charset=utf-8' and a body that is HTML — it "
        "opens '<!DOCTYPE html>' and carries "
        "'<link rel=\"canonical\" href=\"https://www.brownalumnimagazine.com/page-not-found\" />'. "
        "A soft 404 wearing an RSS content-type: a capture harness that trusts the header records "
        "an error page as a feed. /feed, /rss and /articles/rss.xml all answer a hard 404, and "
        "the homepage (Drupal 8) publishes no <link rel=\"alternate\" type=\"application/rss+xml\">."
    ),
    "watson": (
        "Watson Institute: https://watson.brown.edu/rss.xml answers 200 but with "
        "'Content-Type: text/html; charset=UTF-8' and a 135,754-byte body that is the site's "
        "landing page ('<!DOCTYPE html>' ... Google Tag Manager). The Drupal feed route the main "
        "brown.edu install serves at /rss.xml is not enabled on this sub-site."
    ),
    "sph": (
        "Brown School of Public Health: https://sph.brown.edu/rss.xml answers 200 with a correct "
        "'Content-Type: application/rss+xml; charset=utf-8' and a well-formed RSS 2.0 document "
        "— but the whole body is 328 bytes and the <channel> contains zero <item> elements. "
        "The feed route is enabled and nothing is promoted to it. Worth re-probing later; there "
        "is nothing to record today."
    ),
    "x": (
        "X / Twitter: OUT OF SCOPE, not probed. There is no lawful unauthenticated read path — "
        "the public RSS endpoints were withdrawn in 2013, unauthenticated timeline reads were "
        "shut off in 2023, and what remains is a paid API under terms we have not accepted. "
        "The only ways in are a paid API tier or scraping a logged-out challenge page, and the "
        "second is bot-detection bypass, which this pipeline does not do at any price."
    ),
}


# -- author redaction --------------------------------------------------------

#: An author value shaped like an email address is a CMS login, never a byline.
#:
#: brown.edu is Drupal, and its ``<dc:creator>`` is the *node author* — the web
#: editor who posted it — spelled as their Brown address. The 2026-07-30 probe
#: of the live feed saw ``mspear1@``, ``gloa@``, ``cpikul@`` and ``amcgreg3@``
#: at brown.edu. Publishing those does two bad things at once: it attributes
#: reporting to whoever runs the CMS, and it puts four identifiable staff email
#: addresses in an artifact the browser fetches. We are not in the business of
#: republishing someone's work address because their CMS leaked it into a feed.
#:
#: (The *recorded fixture* reads ``scrubbed@example.invalid``, because
#: ``fixtures_capture.scrub`` strips addresses out of stored bodies and these
#: recordings were put through it. The placeholder is email-shaped too, so the
#: rule below exercises the same branch offline that it will take in
#: production — the redaction is not a fixture artefact.)
#:
#: It is also, concretely, a licence-gate failure. Those items are "Brown in
#: the News" round-ups whose ``<description>`` is the headline followed by the
#: creator address, so ``title + " " + author`` reproduces a five-word run that
#: exists in the body: ``body_text_leaks`` reports all 10 brown rows, e.g.
#: ``'ambulance trips study finds scrubbed'``. Redaction takes it to zero.
#:
#: The rule is on the *shape of the value*, not on a list of source ids, so the
#: next Drupal feed anyone adds is covered without remembering this module.
_EMAIL_SHAPED = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

#: Which recorded sources the shape rule currently fires on. Documentation and
#: a test anchor — the rule above is the guarantee, this is the observation.
CMS_LOGIN_AUTHOR_SOURCES: frozenset[str] = frozenset({"brown"})


def redact_cms_authors(articles: Sequence[Article]) -> tuple[list[Article], list[str]]:
    """Drop email-shaped authors, naming each one. Never silent.

    Returns the articles with ``author=None`` where the value was an address,
    plus a diagnostic per redaction. The address itself is *not* echoed into
    the diagnostics — diagnostics get logged, and the entire point is to stop
    carrying it around.
    """
    cleaned: list[Article] = []
    diagnostics: list[str] = []
    for article in articles:
        if article.author and _EMAIL_SHAPED.match(article.author):
            diagnostics.append(
                f"{article.source_id}: redacted an email-shaped author on {article.id} "
                "— a CMS login is not a byline"
            )
            cleaned.append(replace(article, author=None))
        else:
            cleaned.append(article)
    return cleaned, diagnostics


# -- the widened set ---------------------------------------------------------

#: Everything, in the order a reader should meet it: the student papers first
#: because it is their campus, then the institution, then the state.
ALL_SOURCES: tuple[FeedSource, ...] = SOURCES + EXTENDED_SOURCES

#: Both gap tables. Disjoint by construction — asserted in the tests, because
#: a key collision would silently drop one publication's recorded reason.
ALL_GAPS: dict[str, str] = {**GAPS, **EXTENDED_GAPS}


def collect_widened(
    sources: Sequence[FeedSource] = ALL_SOURCES,
    fixture_dir: Path | None = None,
) -> tuple[list[Article], dict[str, str], list[str]]:
    """:func:`collect_articles`, then redaction, then cross-outlet dedupe.

    Returns the same triple as :func:`collect_articles` — articles, raw feed
    text per source id, diagnostics — so it is a drop-in replacement at the one
    call site inside ``run_publications_job``. The raw text is passed through
    untouched because the licence gate needs the prose it is checking against,
    and dropping a duplicate must not drop the evidence for the rows that stay.

    Order of operations is not arbitrary:

    1. ``collect_articles`` parses and dedupes on exact canonical URL *within*
       the fetch, keeping the first source listed.
    2. Redaction runs **before** dedupe so the licence-gate failure described
       in :data:`CMS_LOGIN_AUTHOR_SOURCES` cannot survive as a "winner".
    3. ``deduplicate`` runs last and keeps the **earliest** published of any
       duplicate set, which is a different tie-break from step 1's
       first-source-wins. That is deliberate: step 1 breaks ties inside one
       publication's own feed, where source order is the only signal; step 3
       breaks them across publications, where "who had it first" is the
       honest one. Where they disagree, step 3 is the one that ships.
    """
    articles, raw_by_source, diagnostics = collect_articles(sources, fixture_dir)

    articles, redactions = redact_cms_authors(articles)
    diagnostics.extend(redactions)

    articles, dedupe_notes = deduplicate(articles)
    diagnostics.extend(dedupe_notes)

    for source_id, reason in sorted(EXTENDED_GAPS.items()):
        diagnostics.append(f"gap: {source_id} — {reason}")

    return articles, raw_by_source, diagnostics
