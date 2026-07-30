"""``parse_links`` never emits an href a browser would mis-follow.

The failures these tests name are the ones that actually reach a reader:

* ``href="@brownoutingclub"`` resolves against the current page and navigates
  into our own 404;
* ``href="mailto:club@brown.edu"`` opens a mail client from a button labelled
  "website";
* a Facebook page pasted into ``website_url`` — 7 of them in the pinned
  export — rendered under a globe icon because the column was trusted;
* ``?SUBED1=FRENCH_THEORY`` stripped as "tracking", producing a link that
  loads and shows the wrong list.

Every assertion below is on the real 2026-07-29 export or on a hand-built row
in the export's exact shape.
"""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from brownsync_ingest.clubs.csv_source import EXPECTED_COLUMNS
from brownsync_ingest.clubs.links import (
    LINK_COLUMNS,
    PLATFORMS,
    OrgLink,
    classify_platform,
    normalize_url,
    parse_links,
    parse_links_with_diagnostics,
)


INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_CSV = INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"


def row(**overrides: str) -> dict[str, str]:
    """A row with the export's real columns, all empty unless overridden."""
    base = dict.fromkeys(EXPECTED_COLUMNS, "")
    base["group_type"] = "Undergraduate student group"
    base["name"] = "Example Club"
    unknown = set(overrides) - set(EXPECTED_COLUMNS)
    assert not unknown, f"test names columns the export does not have: {unknown}"
    base.update(overrides)
    return base


@pytest.fixture(scope="module")
def real_rows() -> list[dict[str, str]]:
    with open(REAL_CSV, newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


class TestNonLinksAreRejected:
    def test_a_bare_handle_in_the_website_column_is_dropped_not_linked(self) -> None:
        # href="@brownoutingclub" is a RELATIVE url: the browser resolves it
        # against the current page and lands inside brownsync, not Instagram.
        links, diagnostics = parse_links_with_diagnostics(
            row(website_url="@brownoutingclub")
        )
        assert links == ()
        assert diagnostics == (
            "website_url: '@brownoutingclub' is not a URL and no platform can be inferred",
        )

    def test_a_bare_word_in_the_website_column_is_dropped(self) -> None:
        links, diagnostics = parse_links_with_diagnostics(row(website_url="brownoutingclub"))
        assert links == ()
        assert len(diagnostics) == 1

    @pytest.mark.parametrize(
        "value",
        [
            "mailto:brownoutingclub@brown.edu",
            "tel:+14018631000",
            "javascript:alert(1)",
            "ftp://files.brown.edu/club",
        ],
    )
    def test_a_non_http_scheme_never_becomes_a_link(self, value: str) -> None:
        links, diagnostics = parse_links_with_diagnostics(row(website_url=value))
        assert links == ()
        assert len(diagnostics) == 1
        assert value in diagnostics[0]

    def test_a_scheme_with_no_host_is_dropped(self) -> None:
        # "https://" alone would render as href="https://", which most browsers
        # resolve to the current origin's root.
        links, diagnostics = parse_links_with_diagnostics(row(website_url="https://"))
        assert links == ()
        assert "no host" in diagnostics[0]

    def test_an_empty_cell_is_absence_not_a_diagnostic(self) -> None:
        assert parse_links_with_diagnostics(row()) == ((), ())
        assert parse_links_with_diagnostics(row(website_url="   ")) == ((), ())

    def test_a_non_string_cell_is_reported_rather_than_coerced(self) -> None:
        # A caller handing us a parsed JSON row (None, list) should get a
        # diagnostic, not str(None) == "None" turned into https://None.
        links, diagnostics = parse_links_with_diagnostics({"website_url": 42})
        assert links == ()
        assert "expected a string" in diagnostics[0]
        assert parse_links({"website_url": None}) == ()

    def test_the_dataclass_itself_refuses_a_relative_url(self) -> None:
        # Defense in depth: nothing downstream can construct a broken link.
        with pytest.raises(ValueError):
            OrgLink(platform="website", url="@handle", source_column="website_url")
        with pytest.raises(ValueError):
            OrgLink(platform="myspace", url="https://a.example", source_column="website_url")


class TestBareInstagramHandles:
    def test_a_handle_in_the_instagram_column_becomes_a_profile_url(self) -> None:
        (link,) = parse_links(row(instagram_url="@brownoutingclub"))
        assert link.url == "https://instagram.com/brownoutingclub"
        assert link.platform == "instagram"

    def test_a_handle_without_the_at_sign_also_completes(self) -> None:
        (link,) = parse_links(row(instagram_url="brownoutingclub"))
        assert link.url == "https://instagram.com/brownoutingclub"

    def test_a_domain_in_the_instagram_column_is_a_domain_not_a_handle(self) -> None:
        # https://instagram.com/brownoutingclub.com would be a fabricated 404.
        # A value with a dotted TLD is read as a host and classified by it.
        (link,) = parse_links(row(instagram_url="brownoutingclub.com"))
        assert link.url == "https://brownoutingclub.com"
        assert link.platform == "website"

    def test_no_other_column_completes_a_handle(self) -> None:
        for column in ("website_url", "facebook_url", "twitter_url", "tiktok_url"):
            links, diagnostics = parse_links_with_diagnostics(row(**{column: "@someclub"}))
            assert links == (), f"{column} fabricated a link from a bare handle"
            assert len(diagnostics) == 1


class TestPlatformComesFromTheHost:
    @pytest.mark.parametrize(
        "url,platform",
        [
            ("https://instagram.com/brown180dc", "instagram"),
            ("https://www.instagram.com/brown180dc", "instagram"),
            ("https://discord.gg/AbCdEf", "discord"),
            ("https://discord.com/invite/AbCdEf", "discord"),
            ("https://linktr.ee/brownoutingclub", "linktree"),
            ("https://www.facebook.com/BrownAikidoClub", "facebook"),
            ("https://m.facebook.com/BrownAikidoClub", "facebook"),
            ("https://x.com/brownu", "twitter"),
            ("https://twitter.com/brownu", "twitter"),
            ("https://www.linkedin.com/company/brown", "linkedin"),
            ("https://brownwarwatch.com", "website"),
            ("https://sites.google.com/brown.edu/bgcc/home", "website"),
        ],
    )
    def test_classification(self, url: str, platform: str) -> None:
        assert classify_platform(url) == platform
        assert platform in PLATFORMS

    def test_a_discord_invite_in_the_website_column_is_a_discord_link(self) -> None:
        # The column says "website"; the host says Discord. The host wins, or
        # the directory shows a globe icon that dumps you into a chat server.
        (link,) = parse_links(row(website_url="https://discord.gg/AbCdEf"))
        assert link.platform == "discord"
        assert link.source_column == "website_url"

    def test_the_real_export_has_facebook_and_instagram_inside_website_url(
        self, real_rows: list[dict[str, str]]
    ) -> None:
        # This is why the rule exists — measured, not hypothesised.
        misfiled = [
            classify_platform(r["website_url"])
            for r in real_rows
            if r["website_url"].strip()
            and classify_platform(r["website_url"]) != "website"
        ]
        assert misfiled.count("facebook") == 7
        assert misfiled.count("instagram") == 2

    def test_a_youtube_or_tiktok_host_falls_back_to_website(self) -> None:
        # Both columns exist in the export and are empty in every row, so no
        # glyph was specified for them. `website` is the honest fallback; the
        # link still works.
        assert classify_platform("https://www.youtube.com/@brownband") == "website"
        assert classify_platform("https://www.tiktok.com/@brownband") == "website"


class TestNormalization:
    def test_a_missing_scheme_becomes_https(self) -> None:
        (link,) = parse_links(row(website_url="brownwarwatch.com"))
        assert link.url == "https://brownwarwatch.com"

    def test_a_protocol_relative_url_becomes_https(self) -> None:
        (link,) = parse_links(row(website_url="//instagram.com/brownband"))
        assert link.url == "https://instagram.com/brownband"
        assert link.platform == "instagram"

    def test_http_is_never_silently_upgraded_to_https(self) -> None:
        # A club on a certificate-less host would break; the scheme is data.
        (link,) = parse_links(row(website_url="http://brown-kgsa.com"))
        assert link.url == "http://brown-kgsa.com"

    def test_the_host_is_lowercased_but_the_path_is_not(self) -> None:
        # instagram.com/BrownUniversityAikidoClub is in the real export and
        # Instagram paths are case-preserving in display.
        (link,) = parse_links(row(instagram_url="https://INSTAGRAM.com/BrownUAikido"))
        assert link.url == "https://instagram.com/BrownUAikido"

    def test_trailing_slashes_and_fragments_are_dropped(self) -> None:
        (link,) = parse_links(row(facebook_url="https://www.facebook.com/bikesatbrown/#about"))
        assert link.url == "https://www.facebook.com/bikesatbrown"

    def test_campaign_parameters_are_stripped(self) -> None:
        (link,) = parse_links(
            row(instagram_url="https://instagram.com/brownband?igshid=abc&utm_source=linktree")
        )
        assert link.url == "https://instagram.com/brownband"

    def test_a_load_bearing_query_survives(self) -> None:
        # Both of these are in the real export. `?id=` IS the page identity and
        # `?SUBED1=` IS the mailing list — "strip the query" loses the page.
        (fb,) = parse_links(row(facebook_url="https://www.facebook.com/profile.php?id=61571865550828"))
        assert fb.url == "https://www.facebook.com/profile.php?id=61571865550828"
        (site,) = parse_links(
            row(website_url="https://listserv.brown.edu/cgi-bin/wa?SUBED1=FRENCH_THEORY")
        )
        assert site.url.endswith("?SUBED1=FRENCH_THEORY")

    def test_normalize_url_is_idempotent(self) -> None:
        once = normalize_url("HTTPS://WWW.Facebook.com/Bikes/?utm_source=x#f")
        assert normalize_url(once) == once


class TestDedupeAndOrder:
    def test_the_same_page_in_two_columns_yields_one_link(self) -> None:
        links = parse_links(
            row(
                website_url="https://www.facebook.com/BrownAikidoClub/",
                facebook_url="https://facebook.com/BrownAikidoClub",
            )
        )
        # `www.` and the trailing slash are cosmetic; one page, one link. The
        # first column scanned wins, so `www.` (as published) is what ships.
        assert len(links) == 1
        assert links[0].url == "https://www.facebook.com/BrownAikidoClub"
        assert links[0].source_column == "website_url"

    def test_links_come_back_in_column_order(self) -> None:
        links = parse_links(
            row(
                website_url="https://brownwarwatch.com",
                instagram_url="https://instagram.com/brownwarwatch",
                facebook_url="https://www.facebook.com/brownwarwatch",
            )
        )
        assert [link.platform for link in links] == ["website", "instagram", "facebook"]
        assert tuple(link.source_column for link in links) == LINK_COLUMNS[:3]

    def test_a_multi_value_cell_splits(self) -> None:
        # `other_social_urls` is empty in every pinned row, so its separator is
        # unmeasured; all the plausible ones are accepted.
        links = parse_links(
            row(other_social_urls="https://linktr.ee/a, https://discord.gg/b ; https://x.com/c")
        )
        assert [link.platform for link in links] == ["linktree", "discord", "twitter"]

    def test_the_directory_listing_urls_are_not_links(self) -> None:
        # Every one of the 457 rows carries these, and they are the same page.
        # Emitting them would bury the two links a club actually maintains.
        assert "source_url" not in LINK_COLUMNS
        assert "directory_source_url" not in LINK_COLUMNS
        assert (
            parse_links(
                row(
                    source_url="https://studentactivities.brown.edu/organizations/x",
                    directory_source_url="https://studentactivities.brown.edu/student-groups/x",
                )
            )
            == ()
        )


class TestAgainstTheRealExport:
    def test_every_link_from_every_row_is_an_absolute_http_url(
        self, real_rows: list[dict[str, str]]
    ) -> None:
        total = 0
        for record in real_rows:
            for link in parse_links(record):
                parts = urlsplit(link.url)
                assert parts.scheme in ("http", "https"), link
                assert parts.netloc, link
                assert " " not in link.url, link
                total += 1
        # 21 website_url + 337 instagram_url + 41 facebook_url, and no row
        # lists the same page in two columns. Pinned so a source change shows.
        assert total == 399

    def test_no_row_produces_a_diagnostic_today(
        self, real_rows: list[dict[str, str]]
    ) -> None:
        # The pinned export is clean; this is the tripwire for the next one.
        offenders = [
            (record["name"], diagnostics)
            for record in real_rows
            if (diagnostics := parse_links_with_diagnostics(record)[1])
        ]
        assert offenders == []

    def test_the_parser_recovers_links_contract_v1_drops(
        self, real_rows: list[dict[str, str]]
    ) -> None:
        # job.py emits `url` + `instagram` only. Facebook is the whole of what
        # is lost in this export; the point of the module is to get it back.
        counts = Counter(
            link.platform for record in real_rows for link in parse_links(record)
        )
        # Host-over-column, in numbers: the facebook_url column holds 41 rows
        # but 48 pages are Facebook, and the instagram_url column holds 337
        # while 339 links are Instagram. The 9 extra came out of website_url,
        # which correspondingly drops from 21 to 12.
        assert counts["facebook"] == 48
        assert counts["instagram"] == 339
        assert counts["website"] == 12

    def test_platforms_seen_are_a_subset_of_the_declared_set(
        self, real_rows: list[dict[str, str]]
    ) -> None:
        seen = {link.platform for record in real_rows for link in parse_links(record)}
        assert seen <= set(PLATFORMS)
        assert {"instagram", "facebook", "website"} <= seen
