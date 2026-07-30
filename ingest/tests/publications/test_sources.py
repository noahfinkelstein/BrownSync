"""The widened source set, and the sources we refused.

Two failures share this suite. The first is the one ``feeds.py`` was rebuilt
around — publishing somebody else's copy — and it reappears here in a new
shape: two of the sources probed for this module answered **200** and are still
gaps, because a feed being reachable is not the same fact as a feed being ours
to index. Those refusals only survive review if the reason is written down
verbatim, so the tests read the reasons.

The second is quieter and specific to what got added: brown.edu's ``dc:creator``
is a Drupal login spelled as a staff email address, and shipping it would put
four identifiable Brown addresses in a file the browser fetches — while also,
concretely, failing the licence gate. The redaction tests prove both, including
that the gate really does fire when the redaction is removed.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from brownsync_ingest.publications.feeds import (
    FIXTURE_DIR,
    GAPS,
    SOURCES,
    body_text_leaks,
    collect_articles,
    load_feed,
    synthetic_urls,
)
from brownsync_ingest.publications.sources import (
    ALL_GAPS,
    ALL_SOURCES,
    CMS_LOGIN_AUTHOR_SOURCES,
    EXTENDED_GAPS,
    EXTENDED_SOURCES,
    collect_widened,
    redact_cms_authors,
)


@pytest.fixture(scope="module")
def widened():
    return collect_widened(ALL_SOURCES)


@pytest.fixture(scope="module")
def raw_widened():
    """Parsed but NOT redeuped or redacted — the pre-treatment corpus."""
    return collect_articles(ALL_SOURCES)


# -- what answered -----------------------------------------------------------


class TestTheSourcesThatAnswered:
    def test_the_widened_set_is_the_two_papers_plus_the_new_ones(self) -> None:
        assert [s.id for s in SOURCES] == ["bdh", "bpr"]
        assert [s.id for s in EXTENDED_SOURCES] == ["brown", "ricurrent"]
        assert [s.id for s in ALL_SOURCES] == ["bdh", "bpr", "brown", "ricurrent"]
        assert len({s.id for s in ALL_SOURCES}) == len(ALL_SOURCES)

    def test_the_brown_feed_is_at_the_site_root_not_under_news(self) -> None:
        # Pinned because /news/rss.xml is the URL everybody tries first and it
        # 404s, as do /news/rss, /news/feed and /news/latest/rss. brown.edu/news
        # publishes no <link rel="alternate"> to discover the real one from, so
        # the only record that it lives at the root is this line.
        brown = next(s for s in EXTENDED_SOURCES if s.id == "brown")
        assert brown.feed_url == "https://www.brown.edu/rss.xml"
        assert "/news/" not in brown.feed_url

    def test_both_new_feeds_parse_into_articles(self, raw_widened) -> None:
        articles, _, _ = raw_widened
        counts = {source.id: 0 for source in ALL_SOURCES}
        for article in articles:
            counts[article.source_id] += 1
        assert counts == {"bdh": 35, "bpr": 10, "brown": 10, "ricurrent": 100}

    def test_every_new_source_has_a_recorded_fixture(self) -> None:
        for source in EXTENDED_SOURCES:
            assert (FIXTURE_DIR / source.fixture).is_file()
            assert load_feed(source).lstrip().startswith("<?xml")

    def test_the_new_fixtures_do_not_disturb_the_existing_gap_assertion(self) -> None:
        # test_feeds.py::test_no_fixture_exists_for_a_gap asserts that the
        # top-level glob is exactly the files behind SOURCES. These live one
        # level down so that stays true until they are registered — at which
        # point move them up rather than relaxing the glob.
        assert {path.name for path in FIXTURE_DIR.glob("*.xml")} == {
            source.fixture for source in SOURCES
        }
        for source in EXTENDED_SOURCES:
            assert source.fixture.startswith("extended/")


# -- what we refused ---------------------------------------------------------


class TestTheSourcesWeRefused:
    def test_the_gap_tables_do_not_collide(self) -> None:
        # A shared key would silently overwrite one publication's recorded
        # reason with another's, which is the one thing a gap table must never
        # do.
        assert set(GAPS) & set(EXTENDED_GAPS) == set()
        assert set(ALL_GAPS) == set(GAPS) | set(EXTENDED_GAPS)

    def test_no_gap_is_also_a_source(self) -> None:
        assert set(ALL_GAPS) & {source.id for source in ALL_SOURCES} == set()

    def test_no_fixture_was_ever_invented_for_a_gap(self) -> None:
        # Checked against the directory, not the tables: the wrong way to close
        # a gap is to hand-write the file.
        recorded = {path.name for path in (FIXTURE_DIR / "extended").glob("*")}
        assert recorded == {source.fixture.split("/")[-1] for source in EXTENDED_SOURCES}

        # Exact stems, not a substring glob: gap ids include "x", and "*x*"
        # matches every filename with an x in it.
        stems = {path.stem for path in FIXTURE_DIR.rglob("*.xml")}
        assert stems & set(ALL_GAPS) == set()
        assert stems == {Path(source.fixture).stem for source in ALL_SOURCES}

    def test_google_news_records_both_independent_reasons(self) -> None:
        # It answered 200 with 100 items. It is a gap anyway, and it needs to
        # stay a gap even if one of the two reasons is later resolved — so both
        # are written down.
        reason = EXTENDED_GAPS["gnews"]
        # (1) the feed's own licence, quoted verbatim from its <copyright>
        assert "Any other use of the feed is expressly prohibited" in reason
        assert "personal feed reader for personal, non-commercial use" in reason
        # (2) the links cannot be resolved to a publisher
        assert "0 of 100 decoded ids contain a literal http URL" in reason
        assert "batchexecute" in reason
        assert "dedupe layer 1 is a no-op" in reason

    def test_reddit_was_not_fetched_at_all(self) -> None:
        # robots.txt is the operator answering before we knock. There is no 403
        # or 429 to quote because no request was made, and the gap has to say
        # so — otherwise a future reader assumes it was tried and retries it.
        reason = EXTENDED_GAPS["reddit_brownu"]
        assert "NOT FETCHED" in reason
        assert "'User-agent: *' / 'Disallow: /'" in reason
        assert "https://www.reddit.com/robots.txt" in reason
        assert "did not knock" in reason
        # And it names the lawful routes rather than leaving it looking closed.
        assert "OAuth" in reason

    def test_the_soft_404s_are_distinguished_from_hard_ones(self) -> None:
        # Both answered 200. A harness that trusts the status line, or the
        # content-type header, records an error page as a feed.
        assert "application/rss+xml" in EXTENDED_GAPS["bam"]
        assert "page-not-found" in EXTENDED_GAPS["bam"]
        assert "text/html" in EXTENDED_GAPS["watson"]
        # SPH is the genuinely different one: correct type, valid RSS, no items.
        assert "zero <item> elements" in EXTENDED_GAPS["sph"]
        assert "Worth re-probing later" in EXTENDED_GAPS["sph"]

    def test_twitter_is_out_of_scope_and_says_why(self) -> None:
        reason = EXTENDED_GAPS["x"]
        assert "not probed" in reason
        assert "bot-detection bypass" in reason

    def test_every_gap_names_the_thing_it_probed(self) -> None:
        for source_id, reason in EXTENDED_GAPS.items():
            assert len(reason) > 120, f"{source_id}: a one-line gap is not a reason"
            assert "http" in reason or "not probed" in reason

    def test_the_gaps_reach_the_diagnostics(self, widened) -> None:
        _, _, diagnostics = widened
        for source_id in ALL_GAPS:
            assert any(note.startswith(f"gap: {source_id} ") for note in diagnostics)


# -- the author redaction ----------------------------------------------------


class TestCmsLoginsAreNotBylines:
    def test_no_published_author_is_an_email_address(self, widened) -> None:
        articles, _, _ = widened
        assert not [a for a in articles if a.author and "@" in a.author]

    def test_the_brown_feed_really_does_carry_an_address_in_the_author_slot(
        self, raw_widened
    ) -> None:
        # Proves the redaction is not decorative: every brown row arrives with
        # an email in the byline field, and without this rule they ship.
        #
        # The FIXTURE reads "scrubbed@example.invalid" because the capture
        # harness scrubs addresses out of stored bodies before hashing
        # (fixtures_capture.scrub), and these recordings were put through it.
        # The LIVE feed carries four real staff logins — the 2026-07-30 probe
        # saw amcgreg3@, cpikul@, gloa@ and mspear1@ at brown.edu. That is
        # exactly why the rule is on the SHAPE of the value: the placeholder is
        # email-shaped too, so what this test exercises is the same branch
        # production takes, not a fixture-only path.
        articles, _, _ = raw_widened
        brown = [a for a in articles if a.source_id == "brown"]
        assert len(brown) == 10
        assert {a.author for a in brown} == {"scrubbed@example.invalid"}
        assert CMS_LOGIN_AUTHOR_SOURCES == {"brown"}

    def test_real_bylines_are_untouched(self, widened) -> None:
        # The rule is on the SHAPE of the value, so it must not take a byline
        # with it. Rhode Island Current files under reporters' names.
        articles, _, _ = widened
        bylines = {a.author for a in articles if a.source_id == "ricurrent" and a.author}
        assert "Nancy Lavin" in bylines
        assert len(bylines) > 20

    def test_the_diagnostic_does_not_echo_the_address(self, raw_widened) -> None:
        # Diagnostics get logged. Redacting a value into the log it was
        # redacted out of the artifact for is not a redaction.
        articles, _, _ = raw_widened
        _, notes = redact_cms_authors(articles)
        assert len(notes) == 10
        assert all("@" not in note for note in notes)
        assert all("redacted an email-shaped author" in note for note in notes)

    def test_redaction_is_what_clears_the_licence_gate(self, raw_widened) -> None:
        # Not just tidiness. Those brown rows are "Brown in the News" nodes
        # whose <description> is the headline followed by the creator address,
        # so title + author reproduces a five-word run that exists in the body.
        # Plant the failure back and watch the gate fire.
        articles, raw_by_source, _ = raw_widened
        failures = body_text_leaks(articles, raw_by_source)
        assert len(failures) == 10
        assert all("(brown)" in failure for failure in failures)

        cleaned, _ = redact_cms_authors(articles)
        assert body_text_leaks(cleaned, raw_by_source) == []

    def test_a_non_email_author_survives_the_shape_rule(self) -> None:
        from tests.publications.test_dedupe import article  # noqa: PLC0415

        kept = article("A headline about something", "https://a.org/x", author="Jane Doe")
        dropped = article("Another headline", "https://a.org/y", author="jdoe@brown.edu")
        cleaned, notes = redact_cms_authors([kept, dropped])
        assert [a.author for a in cleaned] == ["Jane Doe", None]
        assert len(notes) == 1


# -- the widened pipeline ----------------------------------------------------


class TestCollectWidened:
    def test_it_returns_the_same_shape_as_collect_articles(self, widened) -> None:
        # It is a drop-in replacement at one call site inside
        # run_publications_job, so the triple has to match exactly.
        articles, raw_by_source, diagnostics = widened
        assert isinstance(articles, list) and isinstance(raw_by_source, dict)
        assert isinstance(diagnostics, list)
        assert set(raw_by_source) == {source.id for source in ALL_SOURCES}
        assert all(isinstance(note, str) for note in diagnostics)

    def test_the_raw_feeds_survive_dedupe(self, widened) -> None:
        # The licence gate reads raw_by_source to know what it is checking
        # against. Dropping a duplicate must not drop the evidence for the rows
        # that stayed, or the gate silently stops covering that source.
        articles, raw_by_source, diagnostics = widened
        # "brown" is the source that loses a row to dedupe, so it is the one
        # whose raw feed could plausibly go missing with it.
        assert any("dropped" in n and "(brown)" in n for n in diagnostics)
        assert raw_by_source["brown"].lstrip().startswith("<?xml")
        assert set(raw_by_source) == {source.id for source in ALL_SOURCES}
        assert body_text_leaks(articles, raw_by_source) == []

    def test_the_widened_corpus_passes_both_halves_of_the_licence_gate(self, widened) -> None:
        # The whole point of matching feeds.py's allowlist rather than writing
        # a second parser: the new sources inherit the guarantee and it is
        # checked here on their actual recorded bytes.
        articles, raw_by_source, _ = widened
        assert body_text_leaks(articles, raw_by_source) == []
        assert synthetic_urls(articles, raw_by_source) == []

    def test_a_planted_leak_in_a_new_source_still_fires(self, widened) -> None:
        # The detector is not vacuous on the sources this module added either.
        articles, raw_by_source, _ = widened
        victim = next(a for a in articles if a.source_id == "ricurrent")
        from brownsync_ingest.publications.feeds import forbidden_shingles

        phrase = sorted(forbidden_shingles(raw_by_source["ricurrent"]))[0]
        assert body_text_leaks([replace(victim, section=phrase)], raw_by_source)

    def test_ordering_is_newest_first(self, widened) -> None:
        articles, _, _ = widened
        stamps = [a.published_at for a in articles]
        assert stamps == sorted(stamps, reverse=True)

    def test_ids_stay_unique_after_the_merge(self, widened) -> None:
        articles, _, _ = widened
        assert len({a.id for a in articles}) == len(articles)

    def test_diagnostics_carry_the_redactions_and_the_drop(self, widened) -> None:
        _, _, diagnostics = widened
        assert sum(1 for n in diagnostics if "redacted an email-shaped author" in n) == 10
        assert sum(1 for n in diagnostics if n.startswith("dedupe[")) == 1

    def test_it_accepts_a_custom_fixture_dir_like_collect_articles(self, tmp_path: Path) -> None:
        from brownsync_ingest.publications.feeds import FeedSource

        (tmp_path / "s.xml").write_text(
            '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>'
            "<item><title>A headline about campus</title>"
            "<link>https://example.org/a</link>"
            "<pubDate>Fri, 10 Jul 2026 00:36:45 -0400</pubDate></item>"
            "</channel></rss>",
            encoding="utf-8",
        )
        source = FeedSource(
            id="s", name="S", homepage="https://example.org/", feed_url="x", fixture="s.xml"
        )
        articles, raw, _ = collect_widened([source], tmp_path)
        assert len(articles) == 1
        assert set(raw) == {"s"}
