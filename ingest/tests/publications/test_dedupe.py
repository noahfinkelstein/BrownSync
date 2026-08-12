"""Cross-outlet dedupe.

The failure this suite exists for is a **false merge**: two newsrooms cover the
same vote, we decide their headlines are close enough, and one publication's
reporting silently disappears from the artifact. There is no error, no gap, no
empty row — the story is simply not there, and the only evidence is a
diagnostic line. Every test below is organized around that asymmetry, so the
ones that matter most are the ones asserting that two articles STAYED.

The rest guard the other end: an identical story syndicated under two URLs, or
the same headline with a masthead bolted on, must collapse to one row — and
when it does, the *earliest* publication has to be the one that survives, with
the drop attributed to both sides.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import random
import subprocess
import sys

import pytest

from brownsync_ingest.publications.dedupe import (
    MIN_STEM_TOKENS,
    SIMHASH_BANDS,
    SIMHASH_BITS,
    SIMHASH_MAX_DISTANCE,
    SIMILARITY_THRESHOLD,
    SUFFIX_MAX_TOKENS,
    _band_keys,
    _fingerprint,
    deduplicate,
    hamming,
    normalize_title,
    resolve_syndication_url,
    simhash,
    strip_outlet_suffix,
    syndication_key,
    title_similarity,
    title_tokens,
)
from brownsync_ingest.publications.feeds import Article, article_id, canonical_url
from brownsync_ingest.publications.sources import ALL_SOURCES, collect_widened

BASE = datetime(2026, 7, 27, 9, 0, tzinfo=timezone.utc)


def article(
    title: str,
    url: str,
    *,
    source: str = "alpha",
    minutes: int = 0,
    section: str | None = None,
    author: str | None = None,
) -> Article:
    canonical = canonical_url(url)
    return Article(
        id=article_id(canonical),
        source_id=source,
        title=title,
        url=canonical,
        published_at=BASE + timedelta(minutes=minutes),
        section=section,
        author=author,
    )


# -- the failure that matters: articles that must survive ---------------------


class TestFalseMergesAreTheExpensiveFailure:
    def test_two_outlets_with_genuinely_different_headlines_both_survive(self) -> None:
        # The BDH reports the vote; the BPR analyses it. Same event, same day,
        # two pieces of journalism. Merging them deletes one outlet's work and
        # leaves no trace on the page — which is why the threshold is 0.72 and
        # not the 0.55 the gazetteer resolver can afford.
        herald = article(
            "Corporation approves 4.2% tuition increase for 2026-27",
            "https://www.browndailyherald.com/article/tuition-vote",
            source="bdh",
        )
        review = article(
            "Who actually pays when Brown raises tuition?",
            "https://brownpoliticalreview.org/2026/07/who-pays",
            source="bpr",
            minutes=180,
        )
        survivors, diagnostics = deduplicate([herald, review])
        assert len(survivors) == 2
        assert {a.id for a in survivors} == {herald.id, review.id}
        assert diagnostics == []

    def test_a_subset_headline_is_not_a_duplicate(self) -> None:
        # This is the specific reason title_similarity uses token_SORT_ratio.
        # token_set_ratio scores a subset as a perfect 1.0, so the longer and
        # more informative story would be the one deleted.
        from rapidfuzz import fuzz

        short = "University announces tuition increase"
        long = "University announces tuition increase after four-hour trustee vote"
        assert fuzz.token_set_ratio(short, long) / 100.0 == pytest.approx(1.0)
        assert title_similarity(short, long) < SIMILARITY_THRESHOLD

        survivors, _ = deduplicate(
            [
                article(short, "https://a.org/x", source="alpha"),
                article(long, "https://b.org/y", source="beta", minutes=30),
            ]
        )
        assert len(survivors) == 2

    def test_one_outlets_own_two_stories_survive_even_at_the_threshold(self) -> None:
        # Taken verbatim from the recorded corpus: Rhode Island Current filed
        # both of these six days apart, and they score 0.722 — over the line.
        # They are two developments in one confirmation fight, not one story
        # twice, so the fuzzy layers are not allowed to compare same-source
        # pairs at all.
        first = "US Senate Judiciary holds over vote on Blanche nomination for AG as Grassley slams Dems"
        second = "Grassley postpones vote in US Senate panel on Blanche nomination for AG"
        assert title_similarity(first, second) >= SIMILARITY_THRESHOLD

        survivors, diagnostics = deduplicate(
            [
                article(first, "https://rhodeislandcurrent.com/a", source="ricurrent"),
                article(
                    second,
                    "https://rhodeislandcurrent.com/b",
                    source="ricurrent",
                    minutes=60 * 24 * 6,
                ),
            ]
        )
        assert len(survivors) == 2
        assert diagnostics == []

    def test_the_same_guard_on_a_shared_section_tag(self) -> None:
        # Also from the corpus: two unrelated BDH narrative pieces score 0.667
        # purely because "[narrative]" is most of both strings. 0.05 of headroom
        # under the threshold is not a margin anyone should rely on.
        assert title_similarity("poly-tongued [narrative]", "on violins [narrative]") > 0.6
        survivors, _ = deduplicate(
            [
                article("poly-tongued [narrative]", "https://bdh.org/a", source="bdh"),
                article("on violins [narrative]", "https://bdh.org/b", source="bdh", minutes=90),
            ]
        )
        assert len(survivors) == 2

    def test_an_identical_url_still_collapses_within_one_source(self) -> None:
        # The same-source guard is only on the FUZZY layers. An identical
        # canonical URL is the same page and carries no false-positive risk,
        # so a feed listing one page twice still collapses.
        survivors, diagnostics = deduplicate(
            [
                article("A headline", "https://bdh.org/a", source="bdh"),
                article("A headline", "https://bdh.org/a/?utm_source=rss", source="bdh", minutes=5),
            ]
        )
        assert len(survivors) == 1
        assert "L1 canonical-url" in diagnostics[0]


# -- layer 1: the same link -------------------------------------------------


class TestLayerOneCanonicalUrl:
    def test_one_article_syndicated_under_two_urls_collapses_to_one(self) -> None:
        survivors, diagnostics = deduplicate(
            [
                article(
                    "Washington Bridge closure lengthened East Bay ambulance trips",
                    "https://rhodeislandcurrent.com/2026/07/27/washington-bridge/",
                    source="ricurrent",
                ),
                article(
                    "A completely unrelated headline about something else entirely",
                    "https://rhodeislandcurrent.com/2026/07/27/washington-bridge"
                    "?utm_source=feed&utm_medium=rss",
                    source="brown",
                    minutes=45,
                ),
            ]
        )
        # Different headlines, but the same page: layer 1 fires on the URL and
        # does not care what either outlet titled its link to it.
        assert len(survivors) == 1
        assert survivors[0].source_id == "ricurrent"
        assert "L1 canonical-url" in diagnostics[0]

    def test_a_feedburner_wrapper_resolves_to_the_publisher(self) -> None:
        wrapped = "https://feeds.feedburner.com/~r/x/~3/abc/?url=https%3A%2F%2Fbdh.org%2Farticle%2Fone"
        assert resolve_syndication_url(wrapped) == "https://bdh.org/article/one"
        assert syndication_key(wrapped) == canonical_url("https://bdh.org/article/one")

    def test_a_google_news_rss_link_cannot_be_resolved_and_says_so(self) -> None:
        # HALF THE REASON Google News is a gap and not a source. The article id
        # is base64url of a protobuf holding an opaque Google identifier — no
        # publisher URL is present in the string, and none of the 100 items in
        # the recorded probe decoded to one. Layer 1 therefore cannot see
        # through it, so every Google News item would arrive as a permanent
        # duplicate of a story we already index under its real URL.
        opaque = (
            "https://news.google.com/rss/articles/"
            "CBMilwFBVV95cUxQTFRLVjJNMG5WRl93RTVuTVljck1BRzVYcVN3ZW45Z3Vnb252UmQ5WWRCNlE"
        )
        assert resolve_syndication_url(opaque) == opaque

    def test_a_publishers_own_url_parameter_is_never_rewritten(self) -> None:
        # Unwrapping is keyed on the wrapper HOST. A CMS that genuinely serves
        # an article from ?url= must not be redirected out from under its
        # reader just because the parameter has a suggestive name.
        own = "https://example.org/reader?url=https://elsewhere.org/x"
        assert resolve_syndication_url(own) == own

    def test_resolution_never_makes_a_network_request(self, monkeypatch) -> None:
        # A resolver that fetched per article would turn dedupe into a crawl of
        # every outlet we link to, and make the artifact depend on their uptime.
        import socket

        def forbidden(*args, **kwargs):  # pragma: no cover - only runs on failure
            raise AssertionError("dedupe attempted a network connection")

        monkeypatch.setattr(socket.socket, "connect", forbidden)
        deduplicate(
            [
                article("A headline about something", "https://news.google.com/rss/articles/CBMi"),
                article("Another headline entirely", "https://feeds.feedburner.com/x?url=https://b.org/y"),
            ]
        )


# -- layer 2: title similarity ----------------------------------------------


class TestLayerTwoTitleSimilarity:
    def test_the_threshold_is_higher_than_the_events_pipeline_on_purpose(self) -> None:
        from brownsync_ingest.gazetteer.resolver import TRIGRAM_THRESHOLD

        assert SIMILARITY_THRESHOLD == 0.72
        assert SIMILARITY_THRESHOLD > TRIGRAM_THRESHOLD == 0.55

    def test_two_outlets_running_the_same_headline_collapse(self) -> None:
        headline = "Washington Bridge closure lengthened East Bay ambulance trips, study finds"
        survivors, diagnostics = deduplicate(
            [
                article(headline, "https://rhodeislandcurrent.com/x", source="ricurrent"),
                article(headline, "https://www.brown.edu/news/2026-07-27", source="brown", minutes=515),
            ]
        )
        assert len(survivors) == 1
        assert "L2 title-similarity 1.00" in diagnostics[0]

    def test_punctuation_and_curly_quotes_do_not_stop_a_match(self) -> None:
        # These feeds mix ASCII apostrophes with U+2019, so "Brown's" and
        # "Brown's" must normalize to one token or the same headline from two
        # CMSes reads as two stories.
        assert normalize_title("Brown’s Pre-College") == normalize_title("Brown's pre college")
        assert title_similarity("Brown’s budget gap widens", "Brown's budget gap widens") == 1.0


# -- layer 3: simhash + banding ---------------------------------------------


class TestLayerThreeSimhash:
    def test_a_headline_differing_only_by_an_outlet_suffix_collapses(self) -> None:
        bare = "Brown lab wins federal grant"
        badged = "Brown lab wins federal grant | The Brown Daily Herald"
        # Layer 2 alone cannot reach this: the masthead is long relative to the
        # headline, so the full-string ratio falls under the threshold. That is
        # exactly why layer 2 is not loosened — layer 3 handles it on the stem.
        assert title_similarity(bare, badged) < SIMILARITY_THRESHOLD

        survivors, diagnostics = deduplicate(
            [
                article(bare, "https://a.org/x", source="alpha"),
                article(badged, "https://b.org/y", source="beta", minutes=120),
            ]
        )
        assert len(survivors) == 1
        assert survivors[0].title == bare
        assert "L3 simhash" in diagnostics[0]

    @pytest.mark.parametrize(
        "badged",
        [
            "Brown lab wins federal grant - Higher Ed Dive",
            "Brown lab wins federal grant — Rhode Island Current",
            "Brown lab wins federal grant | Brown University School of Public Health",
            "Brown lab wins federal grant · WPRI.com",
        ],
    )
    def test_every_separator_an_aggregator_uses(self, badged: str) -> None:
        assert strip_outlet_suffix(badged) == "Brown lab wins federal grant"

    def test_a_hyphenated_word_is_not_a_masthead(self) -> None:
        # The separator must be flanked by whitespace, or "Pre-College" and
        # "2026-2027" get truncated and two unrelated headlines start sharing
        # a stem.
        for title in (
            "Pre-College students explore regenerative medicine",
            "Brown publishes the 2026-2027 academic calendar",
        ):
            assert strip_outlet_suffix(title) == title

    def test_a_long_tail_is_a_clause_not_a_masthead(self) -> None:
        long_tail = " ".join(["word"] * (SUFFIX_MAX_TOKENS + 1))
        title = f"Brown announces a new residential college - {long_tail}"
        assert strip_outlet_suffix(title) == title

    def test_a_short_stem_is_never_fingerprinted(self) -> None:
        # Below MIN_STEM_TOKENS a 64-bit simhash is a handful of hashes and
        # unrelated headlines start colliding, which is the deletion direction.
        # The guard has two halves and both are load-bearing.
        assert MIN_STEM_TOKENS == 4

        # (a) A three-word headline is not fingerprinted at all.
        assert _fingerprint("Brown wins grant") is None
        assert _fingerprint("Brown lab wins grant") is not None

        # (b) A masthead is not stripped when doing so would leave a stub, so
        # the masthead itself keeps these two apart instead of being discarded.
        assert strip_outlet_suffix("Brown wins grant | The Brown Daily Herald") == (
            "Brown wins grant | The Brown Daily Herald"
        )
        survivors, _ = deduplicate(
            [
                article("Brown wins grant | The Brown Daily Herald", "https://a.org/x", source="a"),
                article("Brown wins award | Rhode Island Current", "https://b.org/y", source="b", minutes=10),
            ]
        )
        assert len(survivors) == 2

    def test_banding_cannot_lose_a_true_pair(self) -> None:
        # The correctness argument for banding, exercised rather than asserted:
        # d differing bits can spoil at most d bands, so at d <= 3 with 4 bands
        # at least one band always survives intact. If SIMHASH_MAX_DISTANCE is
        # ever raised to 4 without adding a band, this fails.
        assert SIMHASH_MAX_DISTANCE < SIMHASH_BANDS
        rng = random.Random(20260730)
        for _ in range(500):
            left = rng.getrandbits(SIMHASH_BITS)
            flips = rng.sample(range(SIMHASH_BITS), SIMHASH_MAX_DISTANCE)
            right = left
            for bit in flips:
                right ^= 1 << bit
            assert hamming(left, right) == SIMHASH_MAX_DISTANCE
            assert set(_band_keys(left)) & set(_band_keys(right))

    def test_unrelated_headlines_do_not_land_within_the_hamming_radius(self) -> None:
        corpus = [
            "Corporation approves tuition increase for the coming academic year",
            "Providence City Council debates the tax treaty with the University",
            "Men's hockey falls to Cornell in double overtime at Meehan",
            "Researchers map a new pathway in early Alzheimer's diagnosis",
            "Dining Services extends late-night hours at the Ratty this fall",
        ]
        fingerprints = [simhash(title_tokens(title)) for title in corpus]
        for index, left in enumerate(fingerprints):
            for right in fingerprints[index + 1 :]:
                assert hamming(left, right) > SIMHASH_MAX_DISTANCE

    def test_the_fingerprint_is_stable_across_processes(self) -> None:
        # builtin hash() is randomized per process by PYTHONHASHSEED, so using
        # it would make WHICH ARTICLES SURVIVE differ between two runs of the
        # same input. blake2b does not move.
        script = (
            "from brownsync_ingest.publications.dedupe import simhash, title_tokens;"
            "print(simhash(title_tokens('Brown lab wins federal grant')))"
        )
        seen = {
            subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                text=True,
                check=True,
                env={"PYTHONHASHSEED": seed, "PATH": "/usr/bin:/bin"},
            ).stdout.strip()
            for seed in ("0", "1", "12345")
        }
        assert len(seen) == 1
        assert seen == {str(simhash(title_tokens("Brown lab wins federal grant")))}

    def test_an_empty_token_stream_does_not_explode(self) -> None:
        assert simhash([]) == 0


# -- attribution and ordering ------------------------------------------------


class TestKeepsTheEarliestAndSaysWhatItDropped:
    def test_the_earliest_publication_wins_regardless_of_input_order(self) -> None:
        headline = "Washington Bridge closure lengthened East Bay ambulance trips, study finds"
        early = article(headline, "https://rhodeislandcurrent.com/x", source="ricurrent", minutes=5)
        late = article(headline, "https://www.brown.edu/news/y", source="brown", minutes=520)
        for order in ([early, late], [late, early]):
            survivors, _ = deduplicate(order)
            assert [a.id for a in survivors] == [early.id]

    def test_a_drop_names_both_sides_and_the_layer(self) -> None:
        # A merge that only records the survivor is indistinguishable from an
        # article that was never fetched.
        headline = "Corporation approves tuition increase"
        loser = article(headline, "https://b.org/y", source="beta", minutes=90)
        winner = article(headline, "https://a.org/x", source="alpha")
        _, diagnostics = deduplicate([winner, loser])
        assert len(diagnostics) == 1
        note = diagnostics[0]
        assert loser.id in note and loser.url in note and "beta" in note
        assert winner.id in note and winner.url in note and "alpha" in note
        assert "L2" in note

    def test_nothing_is_ever_dropped_silently(self) -> None:
        articles = [
            article("Corporation approves tuition increase", "https://a.org/x", source="a"),
            article("Corporation approves tuition increase", "https://b.org/y", source="b", minutes=10),
            article("Corporation approves tuition increase", "https://c.org/z", source="c", minutes=20),
            article("An entirely different story about dining hall hours", "https://d.org/w", source="d"),
        ]
        survivors, diagnostics = deduplicate(articles)
        assert len(survivors) + len(diagnostics) == len(articles)

    def test_survivors_come_back_newest_first(self) -> None:
        # Matches collect_articles' ordering so this composes into that
        # pipeline without reshuffling the artifact.
        articles = [
            article(f"Headline number {index} about campus life", f"https://a.org/{index}", minutes=index * 10)
            for index in range(6)
        ]
        survivors, _ = deduplicate(articles)
        stamps = [a.published_at for a in survivors]
        assert stamps == sorted(stamps, reverse=True)

    def test_the_pass_is_deterministic(self) -> None:
        articles = [
            article("Corporation approves tuition increase", "https://a.org/x", source="a"),
            article("Corporation approves tuition increase", "https://b.org/y", source="b"),
        ]
        first, first_notes = deduplicate(articles)
        second, second_notes = deduplicate(list(reversed(articles)))
        assert [a.id for a in first] == [a.id for a in second]
        assert first_notes == second_notes

    def test_an_empty_input_is_not_a_special_case(self) -> None:
        assert deduplicate([]) == ([], [])


# -- the real corpus ---------------------------------------------------------


#: `collect_widened` defaults to `FIXTURE_DIR` (`fixtures/recorded/
#: publications/`), the same directory `refresh.yml` overwrites daily from
#: the live feeds. This class pins exact outcomes — a duplicate count, a
#: named story — against a real corpus, which only holds still if the
#: corpus is frozen: RSS windows roll forward daily, so the live directory
#: can never host a stable regression pin. This is a one-time snapshot of
#: that corpus kept solely for this class; never touched by the daily
#: capture, never read by production ingestion. See
#: `test_sources.py::FROZEN_DEDUPE_FIXTURES` for the sibling copy.
_FROZEN_DEDUPE_FIXTURES = Path(__file__).resolve().parent / "frozen_dedupe_fixtures"


class TestAgainstTheRecordedFeeds:
    def test_the_hit_rate_over_real_data_is_pinned(self) -> None:
        # 155 recorded articles across four sources collapse to 154 — one true
        # cross-outlet duplicate. Pinned as an equality, not a bound: a jump
        # would mean the fuzzy layers started eating real coverage, and that
        # failure is invisible on the page.
        articles, _, diagnostics = collect_widened(ALL_SOURCES, fixture_dir=_FROZEN_DEDUPE_FIXTURES)
        drops = [note for note in diagnostics if note.startswith("dedupe[")]
        assert len(articles) == 154
        assert len(drops) == 1

    def test_the_one_real_duplicate_is_the_one_we_expect(self) -> None:
        articles, _, diagnostics = collect_widened(ALL_SOURCES, fixture_dir=_FROZEN_DEDUPE_FIXTURES)
        note = next(n for n in diagnostics if n.startswith("dedupe["))
        # Rhode Island Current filed it at 09:05Z; Brown's newsroom linked to it
        # at 17:40Z. The outlet that broke it keeps the row.
        assert "L2 title-similarity 1.00" in note
        assert "dropped" in note and "(brown)" in note
        assert "duplicate of" in note and "(ricurrent)" in note
        titles = [a.title for a in articles if "Washington Bridge closure lengthened" in a.title]
        assert len(titles) == 1

    def test_every_source_still_contributes_after_dedupe(self) -> None:
        # A layer that quietly consumed one publication whole would still leave
        # a plausible-looking artifact.
        articles, _, _ = collect_widened(ALL_SOURCES, fixture_dir=_FROZEN_DEDUPE_FIXTURES)
        assert {a.source_id for a in articles} == {s.id for s in ALL_SOURCES}
