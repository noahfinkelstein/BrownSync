"""Brown student publications — headline-only RSS/Atom indexing.

The failure this suite exists for is not a crash. It is shipping one sentence
of somebody else's copyrighted article, which we already did once. So the
licence tests read the bodies out of the recorded fixtures and prove, byte for
byte, that none of that text reaches the artifact — and prove the detector
itself is not vacuous by planting a leak and watching it fire.

Everything else guards the quieter failures: a section rendering as
"Arts &amp; Culture", the BPR sorting above the BDH because ISO strings with
different offsets do not sort like the instants they name, or a feed that
truncates to three items quietly replacing a good artifact with a stub.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path

import pytest

from brownsync_ingest.publications.feeds import (
    FIXTURE_DIR,
    GAPS,
    LICENSE,
    MAX_TITLE_CHARS,
    MIN_ARTICLES,
    MIN_SOURCES,
    PLACEMENT_CATEGORIES,
    PROSE_EXEMPT_FIELDS,
    SAFE_ELEMENTS,
    SOURCES,
    Article,
    FeedSource,
    article_id,
    body_text_leaks,
    build_document,
    canonical_url,
    collect_articles,
    feed_urls,
    forbidden_shingles,
    load_feed,
    parse_feed,
    parse_timestamp,
    run_publications_job,
    safe_fields,
    synthetic_urls,
)

import xml.etree.ElementTree as ElementTree


# -- helpers -----------------------------------------------------------------


def rss(items: str, extra: str = "") -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"'
        ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f"<channel><title>Test</title>{extra}{items}</channel></rss>"
    )


def item(
    *,
    title: str = "A headline about something",
    link: str = "https://example.org/article/one",
    published: str = "Fri, 10 Jul 2026 00:36:45 -0400",
    categories: tuple[str, ...] = ("News",),
    author: str | None = "Jane Doe",
    description: str | None = None,
    guid: str | None = None,
) -> str:
    parts = [f"<title><![CDATA[{title}]]></title>"]
    if link:
        parts.append(f"<link>{link}</link>")
    if guid:
        parts.append(f"<guid>{guid}</guid>")
    if published:
        parts.append(f"<pubDate>{published}</pubDate>")
    parts.extend(f"<category><![CDATA[{c}]]></category>" for c in categories)
    if author:
        parts.append(f"<author><![CDATA[{author}]]></author>")
    if description:
        parts.append(f"<description><![CDATA[{description}]]></description>")
    return "<item>" + "".join(parts) + "</item>"


def source_for(tmp_path: Path, name: str, xml: str) -> FeedSource:
    (tmp_path / f"{name}.xml").write_text(xml, encoding="utf-8")
    return FeedSource(
        id=name,
        name=name.upper(),
        homepage=f"https://{name}.example.org/",
        feed_url=f"https://{name}.example.org/feed",
        fixture=f"{name}.xml",
    )


@pytest.fixture(scope="module")
def collected():
    return collect_articles()


@pytest.fixture(scope="module")
def articles(collected):
    return collected[0]


@pytest.fixture(scope="module")
def raw_by_source(collected):
    return collected[1]


# -- the licence -------------------------------------------------------------


class TestLicence:
    def test_no_published_field_carries_feed_prose(self, articles, raw_by_source) -> None:
        # The whole point of the module. Every word run that exists in an
        # article body and not in its headline/byline/section is forbidden.
        assert body_text_leaks(articles, raw_by_source) == []

    def test_the_detector_is_not_vacuous(self, tmp_path: Path) -> None:
        # A test that only ever passes proves nothing. Simulate the exact
        # regression — a parser change that reads <description> into a
        # published field — and require the gate to catch it.
        body = "<p>The provost announced a new residential college on Thayer Street.</p>"
        feed = source_for(tmp_path, "planted", rss(item(description=body)))
        parsed, raw, _ = collect_articles([feed], tmp_path)
        assert body_text_leaks(parsed, raw) == []

        leaked = replace(
            parsed[0], section="The provost announced a new residential college on Thayer Street"
        )
        failures = body_text_leaks([leaked], raw)
        assert failures and "carries body text" in failures[0]

    def test_a_body_quoting_its_own_headline_is_not_a_leak(self, tmp_path: Path) -> None:
        # WordPress appends "The post <a>Title</a> appeared first on ..." to
        # every description, so the headline genuinely appears in the body.
        # Without subtracting the metadata runs, every BPR row would fail.
        headline = "Photo Essay How Two Small Businesses Keep Hope Alive"
        feed = source_for(
            tmp_path,
            "echo",
            rss(item(title=headline, description=f"<p>The post {headline} appeared first.</p>")),
        )
        parsed, raw, _ = collect_articles([feed], tmp_path)
        assert body_text_leaks(parsed, raw) == []

    def test_the_url_exemption_is_load_bearing(self, articles, raw_by_source) -> None:
        # A canonical URL's slug is generated from the headline, so it echoes
        # the body by construction while the headline's own punctuation stops
        # it being covered ("kahan's out of body" vs "kahan out of body").
        # Pinned so nobody "simplifies" the exemption away and starts failing
        # correct data — the URL is proved by provenance instead.
        assert PROSE_EXEMPT_FIELDS == {"url"}
        widened = [replace(a, section=a.url) for a in articles]
        assert body_text_leaks(widened, raw_by_source)

    def test_every_published_url_came_from_the_feed(self, articles, raw_by_source) -> None:
        assert synthetic_urls(articles, raw_by_source) == []

    def test_a_hand_built_url_is_rejected(self, articles, raw_by_source) -> None:
        forged = replace(articles[0], url="https://www.browndailyherald.com/article/made-up")
        assert synthetic_urls([forged], raw_by_source)

    def test_the_parser_cannot_reach_a_body_element(self) -> None:
        # safe_fields looks each tag UP in an allowlist rather than reaching
        # for the tags it wants, so an element that is not listed is skipped
        # before its text is read. This is the licence guarantee in code.
        element = ElementTree.fromstring(
            "<item><title>T</title>"
            "<description>SECRET BODY</description>"
            "<content:encoded xmlns:content='http://purl.org/rss/1.0/modules/content/'>"
            "SECRET BODY</content:encoded>"
            "<summary>SECRET BODY</summary></item>"
        )
        fields = safe_fields(element)
        assert fields == {"title": ["T"]}
        assert "SECRET BODY" not in json.dumps(fields)

    def test_no_body_element_is_ever_allowlisted(self) -> None:
        for name in ("description", "summary", "content", "encoded"):
            assert not any(tag.split("}")[-1] == name for tag in SAFE_ELEMENTS)

    def test_the_artifact_bytes_contain_no_recorded_body_sentence(self, tmp_path: Path) -> None:
        # The end-to-end form of the same claim, on the real published file:
        # take prose that only exists in a <description> and grep the artifact.
        run_publications_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            generated_at="2026-07-29T21:00:00-04:00",
        )
        published = (tmp_path / "publications.json").read_text(encoding="utf-8").casefold()
        for source in SOURCES:
            # Every run, not a sample: a sample is how the one leaked sentence
            # is the one nobody checked.
            for phrase in forbidden_shingles(load_feed(source)):
                assert phrase not in published, f"{source.id}: {phrase!r}"

    def test_every_source_row_declares_headline_only(self, tmp_path: Path) -> None:
        # The constraint is DATA, not a code path: a consumer that starts
        # rendering excerpts has to ignore a field rather than miss a branch.
        result = run_publications_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", generated_at="2026-01-01T00:00:00+00:00"
        )
        assert result.document["sources"]
        for row in result.document["sources"]:
            assert row["license"] == LICENSE == "headline-only"

    def test_an_article_record_has_exactly_the_agreed_keys(self, articles) -> None:
        # A sibling agent consumes this schema, and an extra key is how an
        # excerpt would arrive. Equality, not a subset check.
        document = build_document(SOURCES, articles, "2026-01-01T00:00:00+00:00")
        for record in document["articles"]:
            assert set(record) == {
                "id",
                "sourceId",
                "title",
                "url",
                "published",
                "section",
                "author",
            }

    def test_the_document_adds_nothing_the_gate_did_not_see(self, articles) -> None:
        # Gates run on Articles, before assembly. That is only sound while
        # build_document is a pure projection — if it ever composes a new
        # string, the licence gate stops covering the artifact.
        document = build_document(SOURCES, articles[:20], "2026-01-01T00:00:00+00:00")
        for record, article in zip(document["articles"], articles[:20]):
            for value in record.values():
                if value is None:
                    continue
                assert value in {
                    article.id,
                    article.source_id,
                    article.title,
                    article.url,
                    article.published,
                    article.section,
                    article.author,
                }


# -- canonicalization and identity -------------------------------------------


class TestCanonicalUrl:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (
                "https://www.browndailyherald.com/article/x?utm_source=twitter&utm_medium=social",
                "https://www.browndailyherald.com/article/x",
            ),
            ("https://brownpoliticalreview.org/piece/", "https://brownpoliticalreview.org/piece"),
            ("https://example.org/a#comments", "https://example.org/a"),
            ("https://EXAMPLE.org/A", "https://example.org/A"),
            # A query parameter can be load-bearing — WordPress identifies a
            # post as ?p=46562 — so the rule is a utm_ denylist, not "drop
            # the query".
            ("https://example.org/?p=46562", "https://example.org/?p=46562"),
            ("https://example.org/", "https://example.org/"),
        ],
    )
    def test_canonicalization(self, raw: str, expected: str) -> None:
        assert canonical_url(raw) == expected

    def test_the_scheme_is_never_upgraded(self) -> None:
        # An http→https "fix" changes where the reader lands, and some student
        # sites still have a broken certificate on the https vhost.
        assert canonical_url("http://example.org/a").startswith("http://")

    def test_paths_keep_their_case(self) -> None:
        # Hosts are case-insensitive; paths are not. Lowercasing the whole URL
        # 404s any CMS that uses mixed-case slugs.
        assert canonical_url("https://example.org/Article/Ten") == "https://example.org/Article/Ten"

    def test_the_id_follows_the_canonical_url_not_the_raw_one(self) -> None:
        # Same story shared with a campaign tag must not become a second row.
        assert article_id(canonical_url("https://example.org/a?utm_source=x")) == article_id(
            canonical_url("https://example.org/a/")
        )

    def test_ids_are_stable_across_runs(self, articles) -> None:
        assert all(a.id == article_id(a.url) for a in articles)
        assert len({a.id for a in articles}) == len(articles)


class TestDedup:
    def test_the_same_url_in_two_feeds_is_one_article(self, tmp_path: Path) -> None:
        shared = "https://example.org/article/shared"
        first = source_for(tmp_path, "alpha", rss(item(link=shared)))
        second = source_for(tmp_path, "beta", rss(item(link=shared + "/?utm_campaign=rss")))
        parsed, _, diagnostics = collect_articles([first, second], tmp_path)
        assert len(parsed) == 1
        assert parsed[0].source_id == "alpha"
        assert any("already seen" in note for note in diagnostics)

    def test_two_outlets_covering_one_event_stay_two_articles(self, tmp_path: Path) -> None:
        # Deliberately NOT deduped on title similarity. The BDH's report and
        # the BPR's analysis of the same vote are two pieces of journalism,
        # and collapsing them deletes one publication's work.
        headline = "University announces tuition increase"
        first = source_for(tmp_path, "alpha", rss(item(title=headline, link="https://a.org/x")))
        second = source_for(tmp_path, "beta", rss(item(title=headline, link="https://b.org/y")))
        parsed, _, _ = collect_articles([first, second], tmp_path)
        assert len(parsed) == 2
        assert {a.title for a in parsed} == {headline}


# -- parsing -----------------------------------------------------------------


class TestParsing:
    def test_the_recorded_feeds_yield_every_item(self, articles) -> None:
        assert len(articles) == 45
        assert {a.source_id for a in articles} == {"bdh", "bpr"}

    def test_entities_inside_cdata_are_decoded(self, articles) -> None:
        # SNworks wraps values in CDATA *and* HTML-escapes inside it, so the
        # XML parser hands back the literal text "Arts &amp; Culture". Without
        # the second unescape the section chip renders the ampersand raw.
        sections = {a.section for a in articles}
        assert "Arts & Culture" in sections
        assert not any("&amp;" in (s or "") for s in sections)
        assert not any("&#" in (a.title or "") for a in articles)

    def test_non_breaking_spaces_are_folded(self, articles) -> None:
        # One BPR headline ends in U+00A0, which str.strip() leaves in place;
        # it renders as a trailing gap and breaks equality against the same
        # headline arriving from another feed.
        for article in articles:
            assert "\xa0" not in article.title
            assert article.title == article.title.strip()

    def test_placement_tags_never_become_a_section(self, articles) -> None:
        # SNworks tags front-page items "homepage" and urgent ones "breaking".
        # Taking the first category blindly files a story under "homepage".
        assert PLACEMENT_CATEGORIES == {"homepage", "breaking"}
        assert not any((a.section or "").lower() in PLACEMENT_CATEGORIES for a in articles)
        assert any(a.section == "University News" for a in articles)

    def test_an_article_with_only_placement_tags_has_a_null_section(self, tmp_path: Path) -> None:
        feed = source_for(tmp_path, "s", rss(item(categories=("homepage", "breaking"))))
        parsed, _, _ = collect_articles([feed], tmp_path)
        assert parsed[0].section is None

    def test_the_guid_is_a_fallback_and_only_when_it_is_a_url(self, tmp_path: Path) -> None:
        # The BPR's guid is "https://brownpoliticalreview.org/?p=46562" with
        # isPermaLink="false" — a real URL that is NOT the article's address.
        # Preferring it over <link> publishes a redirect-shaped permalink and
        # gives the same story two ids across a WordPress migration.
        both = source_for(
            tmp_path,
            "s",
            rss(item(link="https://brownpoliticalreview.org/piece", guid="https://brownpoliticalreview.org/?p=46562")),
        )
        parsed, _, _ = collect_articles([both], tmp_path)
        assert parsed[0].url == "https://brownpoliticalreview.org/piece"

        # An opaque guid is no URL at all, so the entry has no address and is
        # dropped rather than published as a dead link.
        opaque = source_for(tmp_path, "t", rss(item(link="", guid="urn:uuid:1234")))
        parsed, _, diagnostics = collect_articles([opaque], tmp_path)
        assert parsed == []
        assert any("missing title/url/published" in note for note in diagnostics)

    def test_an_entry_without_a_timestamp_is_dropped_not_dated_now(self, tmp_path: Path) -> None:
        # Stamping an undated item with the run time puts it at the top of a
        # newest-first list forever.
        feed = source_for(tmp_path, "s", rss(item(published="")))
        parsed, _, diagnostics = collect_articles([feed], tmp_path)
        assert parsed == []
        assert any("missing title/url/published" in note for note in diagnostics)

    def test_a_timestamp_without_an_offset_is_rejected(self) -> None:
        # Assuming Eastern would shift an article by up to a day in the sort,
        # silently and only for the feeds that omit the zone.
        assert parse_timestamp("Fri, 10 Jul 2026 00:36:45") is None
        assert parse_timestamp("2026-07-10T00:36:45") is None
        assert parse_timestamp("not a date") is None
        assert parse_timestamp("Fri, 10 Jul 2026 00:36:45 -0400") is not None
        assert parse_timestamp("2026-07-10T00:36:45Z") == datetime(
            2026, 7, 10, 0, 36, 45, tzinfo=timezone.utc
        )

    def test_one_bad_entry_does_not_take_down_the_feed(self, tmp_path: Path) -> None:
        feed = source_for(
            tmp_path,
            "s",
            rss(item(published="") + item(link="https://example.org/article/two")),
        )
        parsed, _, diagnostics = collect_articles([feed], tmp_path)
        assert len(parsed) == 1
        assert diagnostics

    def test_atom_feeds_parse_too(self, tmp_path: Path) -> None:
        # The Indy is a gap today; if it comes back it may well come back as
        # Atom, where the payload hides in @href, @term and a child <name>.
        atom = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<feed xmlns="http://www.w3.org/2005/Atom">'
            "<title>Test</title>"
            "<entry>"
            "<title>An Atom headline</title>"
            '<link rel="self" href="https://example.org/feed"/>'
            '<link href="https://example.org/atom/one"/>'
            "<id>urn:uuid:9</id>"
            "<published>2026-07-10T12:00:00Z</published>"
            '<category term="Culture"/>'
            "<author><name>Sam Reader</name></author>"
            "<summary>SECRET BODY</summary>"
            "</entry></feed>"
        )
        feed = source_for(tmp_path, "atom", atom)
        parsed, raw, _ = collect_articles([feed], tmp_path)
        assert len(parsed) == 1
        article = parsed[0]
        # rel="self" is the feed's own address, not the article's.
        assert article.url == "https://example.org/atom/one"
        assert article.title == "An Atom headline"
        assert article.section == "Culture"
        assert article.author == "Sam Reader"
        assert "SECRET" not in json.dumps(
            [article.id, article.title, article.url, article.section, article.author]
        )

    def test_a_feed_with_no_entries_is_diagnosed(self, tmp_path: Path) -> None:
        feed = source_for(tmp_path, "s", rss(""))
        parsed, _, diagnostics = collect_articles([feed], tmp_path)
        assert parsed == []
        assert any("carries no <item>" in note for note in diagnostics)

    def test_feed_urls_reads_links_and_permalink_guids(self) -> None:
        urls = feed_urls(rss(item(link="https://example.org/a/", guid="https://example.org/b")))
        assert urls == {"https://example.org/a", "https://example.org/b"}


# -- ordering ----------------------------------------------------------------


class TestOrdering:
    def test_newest_first(self, articles) -> None:
        stamps = [a.published_at for a in articles]
        assert stamps == sorted(stamps, reverse=True)

    def test_mixed_offsets_sort_by_instant_not_by_string(self, tmp_path: Path) -> None:
        # The BDH publishes at -04:00 and the BPR at +00:00. Sorting the ISO
        # strings puts "2026-07-09T22:00:00-04:00" (02:00Z on the 10th) BELOW
        # "2026-07-10T01:00:00+00:00", which is an hour older.
        eastern = source_for(
            tmp_path,
            "east",
            rss(item(link="https://a.org/later", published="Thu, 09 Jul 2026 22:00:00 -0400")),
        )
        utc = source_for(
            tmp_path,
            "utc",
            rss(item(link="https://b.org/earlier", published="Fri, 10 Jul 2026 01:00:00 +0000")),
        )
        parsed, _, _ = collect_articles([eastern, utc], tmp_path)
        assert [a.url for a in parsed] == ["https://a.org/later", "https://b.org/earlier"]
        assert parsed[0].published < parsed[1].published  # the string order is the opposite

    def test_the_publication_offset_survives(self, articles) -> None:
        # "-04:00" says a Providence newsroom posted this at 12:36 am, which
        # is the fact a reader recognizes. Normalizing to UTC throws it away.
        assert any(a.published.endswith("-04:00") for a in articles)
        assert any(a.published.endswith("+00:00") for a in articles)

    def test_ties_break_deterministically(self, tmp_path: Path) -> None:
        # Two articles at the same instant must not reorder between runs, or
        # every rebuild produces a diff and a cache miss.
        stamp = "Fri, 10 Jul 2026 01:00:00 +0000"
        feed = source_for(
            tmp_path,
            "s",
            rss(
                item(link="https://example.org/z", published=stamp)
                + item(link="https://example.org/a", published=stamp)
            ),
        )
        first, _, _ = collect_articles([feed], tmp_path)
        second, _, _ = collect_articles([feed], tmp_path)
        assert [a.id for a in first] == [a.id for a in second]
        assert [a.id for a in first] == sorted(a.id for a in first)


# -- gaps --------------------------------------------------------------------


class TestGaps:
    def test_the_unreachable_sources_are_recorded_not_invented(self) -> None:
        # A source that is simply absent is indistinguishable from one nobody
        # thought of. These two were probed and failed, and the reason is
        # verbatim so a future run can tell "still broken" from "changed".
        assert set(GAPS) == {"indy", "post"}
        assert set(GAPS) & {s.id for s in SOURCES} == set()
        assert "theindy.org/feed" in GAPS["indy"]
        assert "React app shell" in GAPS["indy"]
        assert "Could not resolve host" in GAPS["post"]
        assert "postmagazinebdh.com" in GAPS["post"]

    def test_no_fixture_exists_for_a_gap(self) -> None:
        # Checked against the directory, not just the source table: the way a
        # gap gets "fixed" wrongly is somebody hand-writing an indy.xml.
        assert {source.fixture for source in SOURCES} == {
            "browndailyherald.xml",
            "brownpoliticalreview.xml",
        }
        assert {path.name for path in FIXTURE_DIR.glob("*.xml")} == {
            source.fixture for source in SOURCES
        }

    def test_the_gaps_reach_the_job_diagnostics(self, tmp_path: Path) -> None:
        result = run_publications_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", generated_at="2026-01-01T00:00:00+00:00"
        )
        for source_id in GAPS:
            assert any(note.startswith(f"gap: {source_id} ") for note in result.diagnostics)


# -- job ---------------------------------------------------------------------


class TestJob:
    def test_publishes_when_the_gates_pass(self, tmp_path: Path) -> None:
        result = run_publications_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            generated_at="2026-07-29T21:00:00-04:00",
        )
        assert result.gate_failures == ()
        assert result.published_count == 45
        assert result.published_count > MIN_ARTICLES  # headroom, not a tripwire

        document = json.loads((tmp_path / "publications.json").read_text())
        assert document["schema_version"] == 1
        assert document["generated_at"] == "2026-07-29T21:00:00-04:00"
        assert [s["id"] for s in document["sources"]] == ["bdh", "bpr"]
        assert len(document["articles"]) == 45

    def test_sources_covers_every_article(self, tmp_path: Path) -> None:
        # A dangling sourceId means the UI has no name or homepage to render
        # the attribution with, which is exactly what the licence requires it
        # to render.
        result = run_publications_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", generated_at="2026-01-01T00:00:00+00:00"
        )
        known = {row["id"] for row in result.document["sources"]}
        assert {a["sourceId"] for a in result.document["articles"]} <= known

    def test_a_truncated_feed_leaves_yesterdays_artifact_alone(self, tmp_path: Path) -> None:
        # Fail closed. A feed that answers 200 with three items is a broken
        # feed, not a slow news week, and must not replace a good artifact
        # with a stub that the site then renders.
        destination = tmp_path / "publications.json"
        destination.write_text('{"schema_version":1,"articles":["yesterday"]}\n')
        before = destination.read_bytes()

        feed = source_for(tmp_path, "thin", rss(item()))
        result = run_publications_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            sources=[feed],
            fixture_dir=tmp_path,
        )
        assert result.published_count is None
        assert any("articles: 1 <" in failure for failure in result.gate_failures)
        assert destination.read_bytes() == before

    def test_one_silent_outlet_fails_the_source_gate(self, tmp_path: Path) -> None:
        # One publication is a single point of failure and reads as an
        # editorial choice we did not make. The gate names who went quiet.
        alive = source_for(
            tmp_path,
            "alive",
            rss(
                "".join(
                    item(link=f"https://example.org/a/{index}")
                    for index in range(MIN_ARTICLES + 5)
                )
            ),
        )
        silent = source_for(tmp_path, "silent", rss(""))
        result = run_publications_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            sources=[alive, silent],
            fixture_dir=tmp_path,
        )
        assert any("sources with articles" in f for f in result.gate_failures)
        assert any("silent: silent" in f for f in result.gate_failures)
        assert not (tmp_path / "publications.json").exists()
        assert MIN_SOURCES == 2

    def test_a_licence_failure_publishes_nothing(self, tmp_path: Path, monkeypatch) -> None:
        # The gate that matters most has to fail closed like the rest. If a
        # leak is ever detected, the correct outcome is no artifact at all.
        monkeypatch.setattr(
            "brownsync_ingest.publications.feeds.body_text_leaks",
            lambda articles, raw: ["planted leak"],
        )
        result = run_publications_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging"
        )
        assert result.gate_failures == ("licence: planted leak",)
        assert result.published_count is None
        assert result.document == {}
        assert not (tmp_path / "publications.json").exists()

    def test_a_headline_the_size_of_a_body_fails_closed(self, tmp_path: Path) -> None:
        # The crude backstop under the allowlist: the longest recorded headline
        # is 108 characters and the shortest recorded body is 122, so anything
        # over the cap is a body that found its way into a field.
        long_title = " ".join(["zzz"] * ((MAX_TITLE_CHARS // 4) + 10))
        feed = source_for(
            tmp_path,
            "long",
            rss(
                "".join(
                    item(title=long_title, link=f"https://example.org/a/{i}")
                    for i in range(MIN_ARTICLES + 5)
                )
            ),
        )
        other = source_for(
            tmp_path,
            "other",
            rss("".join(item(link=f"https://example.org/b/{i}") for i in range(5))),
        )
        result = run_publications_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            sources=[feed, other],
            fixture_dir=tmp_path,
        )
        assert any("over 300 chars" in f for f in result.gate_failures)
        assert result.published_count is None

    def test_the_artifact_is_compact(self, tmp_path: Path) -> None:
        # The browser fetches this one; pretty-printing it is bytes over the
        # wire for whitespace nobody reads.
        run_publications_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", generated_at="2026-01-01T00:00:00+00:00"
        )
        text = (tmp_path / "publications.json").read_text()
        assert '", "' not in text
        assert text.endswith("\n")
        assert text.count("\n") == 1

    def test_the_staging_root_is_left_clean(self, tmp_path: Path) -> None:
        staging = tmp_path / "staging"
        run_publications_job(
            seeds_dir=tmp_path, staging_root=staging, generated_at="2026-01-01T00:00:00+00:00"
        )
        assert list(staging.iterdir()) == []


class TestParseFeedDirectly:
    def test_parse_feed_returns_diagnostics_alongside_articles(self) -> None:
        source = SOURCES[0]
        parsed, diagnostics = parse_feed(load_feed(source), source)
        assert len(parsed) == 35
        assert diagnostics == []
        assert all(isinstance(a, Article) for a in parsed)
        assert all(a.source_id == "bdh" for a in parsed)
