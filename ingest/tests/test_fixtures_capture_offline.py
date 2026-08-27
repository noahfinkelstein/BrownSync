"""Offline behavioral tests for the capture harness (Task 10 coverage).

``fixtures_capture`` parses external data (CAB HTML/JSON, Drupal club pages,
LiveWhale JSON, Overpass JSON, SIDEARM ICS) into the manifest's expected
parser facts, so it falls under the per-parser 80% branch-coverage gate.

Nothing here touches the network: transport is an ``httpx.MockTransport``
plugged into the production ``CachedHttpClient``, and the expected-fact
builders are additionally replayed against the real recorded fixtures so the
facts pinned in ``fixtures/manifest.json`` stay reproducible from the stored
bytes alone.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Callable

from bs4 import BeautifulSoup
import httpx
import pytest

from brownsync_ingest import fixtures_capture as harness
from brownsync_ingest.common.http import CachedHttpClient

FIXTURES_ROOT = Path(__file__).resolve().parents[1] / "fixtures"
CONTACT = "noah_finkelstein@brown.edu"

SAMPLE_ICS = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:Brown University Athletics",
        "X-PUBLISHED-TTL:PT120M",
        "BEGIN:VEVENT",
        "SUMMARY:Brown University Women's Soccer vs New Haven",
        "LOCATION:Providence\\, R.I.\\, Stevenson-Pincince Field",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
)


def offline_session(tmp_path: Path, handler: Callable[[httpx.Request], httpx.Response]) -> harness.CaptureSession:
    """A real CaptureSession whose production client talks to a mock transport."""
    session = harness.CaptureSession(
        contact_email=CONTACT,
        fixtures_root=tmp_path / "fixtures",
        cache_dir=tmp_path / "cache",
    )
    session.client = CachedHttpClient(
        contact_email=CONTACT,
        cache_dir=tmp_path / "cache",
        transport=httpx.MockTransport(handler),
        min_interval_seconds=0.0,
    )
    return session


def soup_of(text: str) -> BeautifulSoup:
    return BeautifulSoup(text, "html.parser")


# -- scrub -------------------------------------------------------------------


class TestScrub:
    def test_a_plain_email_is_replaced_and_the_change_is_flagged(self) -> None:
        stored, was_scrubbed = harness.scrub(b"contact person.name@brown.edu today")
        assert stored == b"contact scrubbed@example.invalid today"
        assert was_scrubbed is True

    def test_asset_names_and_the_placeholder_itself_survive_unchanged(self) -> None:
        body = b"<img src=logo@2x.png> mailto:scrubbed@example.invalid"
        stored, was_scrubbed = harness.scrub(body)
        assert stored == body
        assert was_scrubbed is False

    def test_a_match_after_a_json_escape_keeps_the_escape_letter(self) -> None:
        # In JSON text "<br \/>\nperson@brown.edu" the regex match begins at
        # the "n" of "\n"; the scrub must not corrupt the escape sequence.
        body = b'{"description": "<br \\/>\\nperson@brown.edu"}'
        stored, was_scrubbed = harness.scrub(body)
        assert stored == b'{"description": "<br \\/>\\nscrubbed@example.invalid"}'
        assert was_scrubbed is True


# -- expected facts replayed against the real recorded fixtures --------------


class TestExpectedFactsRoundTripAgainstRecordedFixtures:
    """Re-deriving the facts from the stored bytes must reproduce the manifest."""

    BUILDERS = {
        "recorded/livewhale/events.json": harness._livewhale_events_expected,
        "recorded/livewhale/groups.json": harness._livewhale_groups_expected,
        "recorded/overpass/college-hill-buildings.json": harness._overpass_expected,
        "recorded/athletics/calendar.ics": harness._athletics_ics_expected,
    }

    @pytest.mark.parametrize("relpath", sorted(BUILDERS))
    def test_builder_output_matches_the_manifested_expected_facts(self, relpath: str) -> None:
        manifest = json.loads((FIXTURES_ROOT / "manifest.json").read_text(encoding="utf-8"))
        entry = next(e for e in manifest["fixtures"] if e["path"] == relpath)
        stored = (FIXTURES_ROOT / relpath).read_bytes()
        assert self.BUILDERS[relpath](stored) == entry["expected"]


# -- CAB fact builders -------------------------------------------------------


class TestFall2026SrcdbDiscovery:
    def test_an_option_labelled_fall_2026_wins_and_empty_values_are_skipped(self) -> None:
        text = (
            '<select><option value="">Choose a term</option>'
            '<option value="999998">Spring 2026</option>'
            '<option value="999999">Fall 2026</option></select>'
        )
        assert harness._find_fall_2026_srcdb(soup_of(text), text) == "999999"

    def test_a_json_blob_with_srcdb_and_fall_2026_in_one_object_is_parsed(self) -> None:
        text = 'var terms = [{"srcdb":"202710","name":"Fall 2026"}];'
        assert harness._find_fall_2026_srcdb(soup_of(text), text) == "202710"

    def test_fall_2026_text_followed_by_a_srcdb_key_is_the_last_resort(self) -> None:
        text = 'The Fall 2026 term uses "srcdb": "202710" internally.'
        assert harness._find_fall_2026_srcdb(soup_of(text), text) == "202710"

    def test_a_document_without_fall_2026_yields_none(self) -> None:
        text = '<option value="202620">Summer 2026</option>'
        assert harness._find_fall_2026_srcdb(soup_of(text), text) is None

    def test_home_facts_carry_the_srcdb_only_when_discovered(self) -> None:
        with_srcdb = harness._cab_home_expected(b'<option value="999999">Fall 2026</option>')
        assert with_srcdb["fall_2026_srcdb"] == "999999"
        assert "999999" in with_srcdb["body_contains"]
        without = harness._cab_home_expected(b"<p>Welcome to Courses at Brown</p>")
        assert "fall_2026_srcdb" not in without
        assert without["body_contains"] == ["Fall 2026"]


class TestBootstrapUrlDiscovery:
    def test_a_fose_bootstrap_script_src_is_resolved_against_the_cab_base(self) -> None:
        text = '<script src="/scripts/fose-bootstrap.min.js"></script>'
        url = harness._find_bootstrap_url(soup_of(text), text)
        assert url == "https://cab.brown.edu/scripts/fose-bootstrap.min.js"

    def test_a_quoted_route_bootstrap_url_is_the_fallback(self) -> None:
        text = '<script src="/other.js"></script> fetch("/api/?page=fose&route=bootstrap")'
        url = harness._find_bootstrap_url(soup_of(text), text)
        assert url == "https://cab.brown.edu/api/?page=fose&route=bootstrap"

    def test_a_page_without_any_bootstrap_reference_yields_none(self) -> None:
        text = '<script src="/plain.js"></script>'
        assert harness._find_bootstrap_url(soup_of(text), text) is None


class TestCabSearchAndDetailFacts:
    def test_search_facts_sample_the_first_result(self) -> None:
        body = json.dumps(
            {"srcdb": "999999", "results": [{"crn": "10001", "code": "CSCI 0150"}, {"crn": "10002"}]}
        ).encode()
        facts = harness._cab_search_expected(body)
        assert facts["result_count"] == 2
        assert facts["srcdb"] == "999999"
        assert facts["sample_crn"] == "10001"
        assert facts["sample_code"] == "CSCI 0150"
        assert facts["body_contains"] == ['"results"', "10001", "CSCI 0150"]

    def test_an_empty_search_keeps_only_the_structural_anchor(self) -> None:
        facts = harness._cab_search_expected(b'{"results": []}')
        assert facts["result_count"] == 0
        assert "sample_crn" not in facts
        assert facts["body_contains"] == ['"results"']

    def test_detail_facts_record_crn_code_and_html_presence(self) -> None:
        body = json.dumps(
            {"crn": "10001", "code": "CSCI 0150", "srcdb": "999999", "meeting_html": "<p>MWF</p>"}
        ).encode()
        facts = harness._cab_detail_expected(body)
        assert facts["crn"] == "10001"
        assert facts["has_meeting_html"] is True
        assert facts["has_instructordetail_html"] is False
        assert facts["body_contains"] == ["10001", "CSCI 0150"]

    def test_a_detail_without_identifiers_anchors_on_the_crn_key(self) -> None:
        facts = harness._cab_detail_expected(b"{}")
        assert facts["body_contains"] == ['"crn"']


class TestSelectDiverseSections:
    def test_duplicate_crns_and_incomplete_results_are_dropped(self) -> None:
        results = [
            {"crn": "1", "code": "A 1", "meets": "MWF"},
            {"crn": "1", "code": "A 1 duplicate", "meets": "MWF"},
            {"code": "no-crn", "meets": "MWF"},
            {"crn": "no-code"},
        ]
        selected = harness._select_diverse_sections(results, target=10)
        assert [s["code"] for s in selected] == ["A 1"]

    def test_selection_rotates_across_distinct_meeting_patterns(self) -> None:
        results = [
            {"crn": "1", "code": "A", "meets": "MWF 9"},
            {"crn": "2", "code": "B", "meets": "MWF 9"},
            {"crn": "3", "code": "C", "meets": "TTh 1"},
            {"crn": "4", "code": "D", "meets": "TTh 1"},
        ]
        selected = harness._select_diverse_sections(results, target=3)
        # One from each pattern bucket first, then the rotation wraps around.
        assert [s["crn"] for s in selected] == ["1", "3", "2"]

    def test_no_results_selects_nothing(self) -> None:
        assert harness._select_diverse_sections([], target=5) == []


# -- clubs fact builders -----------------------------------------------------


class TestClubsFacts:
    def test_a_directory_page_samples_the_first_group_heading(self) -> None:
        body = (
            b"<h1>Student Groups</h1>"
            b'<div class="views-row"><h3>Brown Ballroom Dance</h3></div>'
            b'<div class="views-row"><h3>Chess Club</h3></div>'
        )
        facts = harness._clubs_expected(body)
        assert facts["views_rows"] == 2
        assert facts["sample_group"] == "Brown Ballroom Dance"
        assert facts["body_contains"] == ["Student Groups", "Brown Ballroom Dance"]

    def test_a_row_without_a_heading_yields_no_sample(self) -> None:
        facts = harness._clubs_expected(b'<div class="views-row"><span>plain</span></div>')
        assert facts["views_rows"] == 1
        assert "sample_group" not in facts

    def test_a_page_without_rows_counts_zero(self) -> None:
        assert harness._clubs_expected(b"<p>Student Groups</p>")["views_rows"] == 0

    def test_the_drupal_pager_reports_the_highest_page_number(self) -> None:
        text = (
            '<a href="?page=1">2</a><a href="/dir?page=3">4</a>'
            '<a href="?page=2">3</a><a href="/unrelated">x</a>'
        )
        assert harness._drupal_last_page(soup_of(text)) == 3

    def test_a_pagerless_page_is_page_zero_only(self) -> None:
        assert harness._drupal_last_page(soup_of("<p>no pager</p>")) == 0

    def test_the_graduate_url_is_found_by_href_tokens(self) -> None:
        text = '<a href="/student-groups/graduate-student-groups">More</a>'
        url = harness._find_graduate_url(soup_of(text))
        assert url == "https://studentactivities.brown.edu/student-groups/graduate-student-groups"

    def test_the_graduate_url_is_found_by_link_text_when_href_is_opaque(self) -> None:
        text = '<a href="/gsg-directory">Graduate Student Groups</a>'
        assert harness._find_graduate_url(soup_of(text)) == "https://studentactivities.brown.edu/gsg-directory"

    def test_a_page_without_a_graduate_link_yields_none(self) -> None:
        assert harness._find_graduate_url(soup_of('<a href="/about">About us</a>')) is None


# -- LiveWhale fact builders -------------------------------------------------


class TestLiveWhaleEventFacts:
    def test_a_json_event_list_is_counted_and_sampled(self) -> None:
        body = json.dumps(
            [
                {"title": "Concert on the Green", "location_latitude": "41.8", "custom": "x"},
                {"title": "Lecture"},
            ]
        ).encode()
        facts = harness._livewhale_events_expected(body)
        assert facts["strict_json"] is True
        assert facts["event_count"] == 2
        assert facts["sample_title"] == "Concert on the Green"
        assert facts["first_event_fields"] == ["location_latitude", "title"]
        assert "Concert on the Green" in facts["body_contains"]

    def test_a_wrapped_events_object_and_non_dict_entries_are_tolerated(self) -> None:
        body = json.dumps({"events": ["not-a-dict", {"title": "Lecture"}]}).encode()
        facts = harness._livewhale_events_expected(body)
        assert facts["event_count"] == 2
        assert facts["sample_title"] == "Lecture"
        assert "first_event_fields" not in facts  # first entry is not a dict

    def test_a_non_json_body_falls_back_to_counting_title_keys(self) -> None:
        facts = harness._livewhale_events_expected(b'not json "title" x "title"')
        assert facts["strict_json"] is False
        assert facts["title_key_occurrences"] == 2
        assert "event_count" not in facts


class TestLiveWhaleGroupFacts:
    def test_group_names_fall_back_from_title_to_fullname(self) -> None:
        body = json.dumps({"groups": [17, {"fullname": "Brown Outing Club", "id": 1}]}).encode()
        facts = harness._livewhale_groups_expected(body)
        assert facts["group_count"] == 2
        assert facts["sample_group"] == "Brown Outing Club"
        assert facts["body_contains"] == ['"title"', "Brown Outing Club"]
        assert "first_group_fields" not in facts  # first entry is not a dict

    def test_a_bare_group_list_records_its_first_entry_fields(self) -> None:
        body = json.dumps([{"id": 3, "title": "Chess Club", "timezone": "EST", "extra": True}]).encode()
        facts = harness._livewhale_groups_expected(body)
        assert facts["group_count"] == 1
        assert facts["first_group_fields"] == ["id", "timezone", "title"] or facts[
            "first_group_fields"
        ] == sorted(["id", "title", "timezone"])

    def test_a_non_json_groups_body_falls_back_to_counting_title_keys(self) -> None:
        facts = harness._livewhale_groups_expected(b'<html>"title"</html>')
        assert facts["strict_json"] is False
        assert facts["title_key_occurrences"] == 1

    def test_contact_info_values_are_blanked_including_escaped_quotes(self) -> None:
        body = b'{"contact_info": "Jane Doe \\"Registrar\\" 401-863-1000", "title": "Event"}'
        scrubbed = harness._scrub_livewhale_contact_info(body)
        assert scrubbed == b'{"contact_info": "[contact scrubbed]", "title": "Event"}'


# -- Overpass fact builders --------------------------------------------------


class TestOverpassFacts:
    def test_ways_and_relations_are_counted_and_a_named_building_sampled(self) -> None:
        body = json.dumps(
            {
                "elements": [
                    {"type": "way", "id": 1, "tags": {"name": "Sayles Hall"}},
                    {"type": "relation", "id": 2, "tags": {}},
                    {"type": "node", "id": 3},
                ]
            }
        ).encode()
        facts = harness._overpass_expected(body)
        assert facts["element_count"] == 3
        assert facts["way_count"] == 1
        assert facts["relation_count"] == 1
        assert facts["sample_building_name"] == "Sayles Hall"
        assert facts["body_contains"] == ['"elements"', "Sayles Hall"]

    def test_an_anonymous_extract_yields_counts_without_a_sample(self) -> None:
        body = json.dumps({"elements": [{"type": "way", "id": 1}]}).encode()
        facts = harness._overpass_expected(body)
        assert facts["way_count"] == 1
        assert "sample_building_name" not in facts
        assert facts["body_contains"] == ['"elements"']


# -- CaptureSession transport behavior ---------------------------------------


class TestFetchRedirects:
    def test_relative_redirects_are_followed_to_the_final_url(self, tmp_path: Path) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/start":
                return httpx.Response(302, headers={"location": "/middle"})
            if request.url.path == "/middle":
                return httpx.Response(301, headers={"location": "https://example.org/final"})
            return httpx.Response(200, content=b"done")

        session = offline_session(tmp_path, handler)
        response, final_url = session.fetch("GET", "https://example.org/start")
        assert response.content == b"done"
        assert final_url == "https://example.org/final"

    def test_a_303_turns_the_post_into_a_bodyless_get(self, tmp_path: Path) -> None:
        seen: list[tuple[str, bytes]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append((request.method, request.content))
            if request.url.path == "/submit":
                return httpx.Response(303, headers={"location": "/result"})
            return httpx.Response(200, content=b"created")

        session = offline_session(tmp_path, handler)
        response, final_url = session.fetch("POST", "https://example.org/submit", json_body={"a": 1})
        assert response.content == b"created"
        assert final_url == "https://example.org/result"
        assert seen[0] == ("POST", b'{"a":1}')
        assert seen[1] == ("GET", b"")

    def test_an_endless_redirect_chain_is_cut_off(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path, lambda request: httpx.Response(302, headers={"location": "/loop"})
        )
        with pytest.raises(RuntimeError, match="too many redirects"):
            session.fetch("GET", "https://example.org/loop")

    def test_a_redirect_without_location_and_a_plain_404_both_raise(self, tmp_path: Path) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302) if request.url.path == "/bare" else httpx.Response(404)

        session = offline_session(tmp_path, handler)
        with pytest.raises(httpx.HTTPStatusError):
            session.fetch("GET", "https://example.org/bare")
        with pytest.raises(httpx.HTTPStatusError):
            session.fetch("GET", "https://example.org/missing")


class TestCaptureRecording:
    def test_a_200_is_scrubbed_stored_and_manifested_with_matching_hashes(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path,
            lambda request: httpx.Response(200, content=b"ask person@brown.edu", headers={"content-type": "text/html"}),
        )
        stored = session.capture(
            source="demo",
            relpath="recorded/demo/page.html",
            method="GET",
            url="https://example.org/page",
            expected=lambda body: {"body_contains": ["ask"]},
        )
        assert stored == b"ask scrubbed@example.invalid"
        on_disk = (tmp_path / "fixtures/recorded/demo/page.html").read_bytes()
        assert on_disk == stored
        (entry,) = session.entries
        assert entry["sha256"] == hashlib.sha256(stored).hexdigest()
        assert entry["bytes"] == len(stored)
        assert entry["scrubbed"] is True
        assert entry["route"] == "GET https://example.org/page"
        assert entry["content_type"] == "text/html"
        # The manifested fingerprint is exactly the production cache identity.
        assert (tmp_path / "cache" / f"{entry['request_fingerprint']}.json").is_file()

    def test_a_json_request_body_is_displayed_in_the_manifest_entry(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(200, content=b"{}"))
        session.capture(
            source="demo",
            relpath="recorded/demo/api.json",
            method="POST",
            url="https://example.org/api",
            json_body={"criteria": []},
            expected=lambda body: {"body_contains": ["{}"]},
        )
        assert session.entries[0]["request_body"] == {"criteria": []}

    def test_a_waf_challenge_header_is_blocked_and_never_stored(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path,
            lambda request: httpx.Response(200, headers={"x-amzn-waf-action": "challenge"}, content=b"solve me"),
        )
        with pytest.raises(harness.CaptureBlockedError, match="bot challenge"):
            session.capture(
                source="demo",
                relpath="recorded/demo/waf.html",
                method="GET",
                url="https://example.org/",
                expected=lambda body: {},
            )
        assert session.entries == []
        assert not (tmp_path / "fixtures/recorded/demo/waf.html").exists()

    @pytest.mark.parametrize("content", [b"", b"<html>awsWaf token</html>"])
    def test_a_202_challenge_body_is_blocked(self, tmp_path: Path, content: bytes) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(202, content=content))
        with pytest.raises(harness.CaptureBlockedError, match="bot challenge"):
            session.capture(
                source="demo",
                relpath="recorded/demo/challenge.html",
                method="GET",
                url="https://example.org/",
                expected=lambda body: {},
            )

    def test_a_non_200_success_is_rejected_as_unrecordable(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(202, content=b"accepted"))
        with pytest.raises(harness.CaptureBlockedError, match="only plain 200"):
            session.capture(
                source="demo",
                relpath="recorded/demo/accepted.html",
                method="GET",
                url="https://example.org/",
                expected=lambda body: {},
            )

    def test_a_failing_fact_builder_leaves_no_unmanifested_fixture_behind(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(200, content=b"body"))
        with pytest.raises(ValueError, match="broken builder"):
            session.capture(
                source="demo",
                relpath="recorded/demo/broken.html",
                method="GET",
                url="https://example.org/",
                expected=lambda body: (_ for _ in ()).throw(ValueError("broken builder")),
            )
        assert session.entries == []
        assert not (tmp_path / "fixtures/recorded/demo/broken.html").exists()

    def test_a_pre_scrub_transform_marks_the_fixture_as_scrubbed(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(200, content=b"a secret b"))
        stored = session.capture(
            source="demo",
            relpath="recorded/demo/pre.html",
            method="GET",
            url="https://example.org/",
            pre_scrub=lambda body: body.replace(b"secret", b"[gone]"),
            expected=lambda body: {"body_contains": ["a"]},
        )
        assert stored == b"a [gone] b"
        assert session.entries[0]["scrubbed"] is True

    def test_gap_reasons_are_flattened_to_a_single_boilerplate_free_line(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(200))
        session.gap(
            "demo",
            "Client error '403 Forbidden'\n  for url\nFor more information check: https://developer.mozilla.org",
        )
        assert session.gaps == [{"source": "demo", "reason": "Client error '403 Forbidden' for url"}]

    def test_the_manifest_is_written_with_entries_sorted_by_path(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, lambda request: httpx.Response(200))
        (tmp_path / "fixtures").mkdir()
        session.entries = [
            {"path": "recorded/z/last.json", "source": "z"},
            {"path": "recorded/a/first.json", "source": "a"},
        ]
        session.gap("demo", "reason")
        session.note("demo: note")
        manifest_path = session.write_manifest()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["schema_version"] == 1
        assert manifest["recorded_user_agent"] == f"BrownSync/1.0 (+{CONTACT})"
        assert [entry["path"] for entry in manifest["fixtures"]] == [
            "recorded/a/first.json",
            "recorded/z/last.json",
        ]
        assert manifest["gaps"] == [{"source": "demo", "reason": "reason"}]
        assert manifest["notes"] == ["demo: note"]


# -- capture group orchestration ---------------------------------------------


def _cab_handler(home_html: str, results_by_subject: dict[str, list[dict]]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cab.brown.edu" and request.url.path == "/":
            return httpx.Response(200, content=home_html.encode())
        if "bootstrap" in request.url.path:
            return httpx.Response(200, content=b'var terms=[{"srcdb":"999999"}];')
        route = request.url.params.get("route")
        if route == "search":
            payload = json.loads(request.content)
            subject = payload["criteria"][0]["value"]
            return httpx.Response(
                200, content=json.dumps({"srcdb": "999999", "results": results_by_subject.get(subject, [])}).encode()
            )
        if route == "details":
            payload = json.loads(request.content)
            crn = payload["key"].split(":", 1)[1]
            return httpx.Response(
                200,
                content=json.dumps(
                    {"crn": crn, "code": f"DEMO {crn}", "srcdb": "999999", "meeting_html": "<p>MWF</p>"}
                ).encode(),
            )
        return httpx.Response(404)

    return handler


class TestCaptureCab:
    def test_a_small_export_records_searches_details_and_a_scarcity_gap(self, tmp_path: Path) -> None:
        home = (
            '<option value="999999">Fall 2026</option>'
            '<script src="/scripts/fose-bootstrap.min.js"></script>'
        )
        results = {
            "CSCI": [
                {"crn": "10001", "code": "CSCI 0150", "meets": "MWF 9-9:50a"},
                {"crn": "10002", "code": "CSCI 0170", "meets": "TTh 10:30-11:50a"},
            ],
            "ENGN": [{"crn": "20001", "code": "ENGN 0030", "meets": "MWF 9-9:50a"}],
        }
        session = offline_session(tmp_path, _cab_handler(home, results))
        harness.capture_cab(session)
        sources = [entry["source"] for entry in session.entries]
        assert sources.count("cab_search") == 3  # one per subject, HIST empty
        assert sources.count("cab_details") == 3
        assert "cab_bootstrap" in sources
        home_entry = next(e for e in session.entries if e["source"] == "cab_home")
        assert home_entry["expected"]["fall_2026_srcdb"] == "999999"
        assert any("srcdb discovered" in note for note in session.notes)
        (gap,) = session.gaps
        assert gap["source"] == "cab_details"
        assert "only 3 distinct sections" in gap["reason"]

    def test_a_home_page_without_fall_2026_becomes_two_gaps(self, tmp_path: Path) -> None:
        session = offline_session(tmp_path, _cab_handler("<p>maintenance</p>", {}))
        harness.capture_cab(session)
        assert [entry["source"] for entry in session.entries] == ["cab_home"]
        assert [gap["source"] for gap in session.gaps] == ["cab_search", "cab_details"]

    def test_a_rich_export_meets_the_detail_target_without_gaps(self, tmp_path: Path) -> None:
        home = '<div>terms {"srcdb":"202710","name":"Fall 2026"}</div>'
        results = {
            "CSCI": [
                {"crn": str(30000 + i), "code": f"CSCI {i:04d}", "meets": f"pattern-{i % 5}"}
                for i in range(25)
            ]
        }
        session = offline_session(tmp_path, _cab_handler(home, results))
        harness.capture_cab(session)
        details = [entry for entry in session.entries if entry["source"] == "cab_details"]
        assert len(details) == harness.CAB_DETAIL_TARGET
        assert session.gaps == []
        assert any("embedded in the home HTML" in note for note in session.notes)


class TestCaptureClubs:
    UNDERGRAD_HOST = "studentactivities.brown.edu"

    def test_pager_pages_are_walked_and_a_failing_graduate_fetch_is_a_gap(self, tmp_path: Path) -> None:
        page0 = (
            "<h1>Student Groups</h1>"
            '<div class="views-row"><h3>Brown Ballroom Dance</h3></div>'
            '<a href="?page=1">2</a>'
            '<a href="/student-groups/graduate-student-groups">Graduate Student Groups</a>'
        )
        page1 = '<h1>Student Groups</h1><div class="views-row"><h3>Chess Club</h3></div>'

        def handler(request: httpx.Request) -> httpx.Response:
            # NB: "undergraduate-student-groups" ends with "graduate-student-groups",
            # so the graduate route must be matched by its full path.
            if request.url.path == "/student-groups/graduate-student-groups":
                return httpx.Response(404)
            if request.url.params.get("page") == "1":
                return httpx.Response(200, content=page1.encode())
            return httpx.Response(200, content=page0.encode())

        session = offline_session(tmp_path, handler)
        harness.capture_clubs(session)
        assert [entry["source"] for entry in session.entries] == ["clubs_undergraduate"] * 2
        assert any("captured pages 0..1" in note for note in session.notes)
        (gap,) = session.gaps
        assert gap["source"] == "clubs_graduate"
        assert "fetch failed after retries" in gap["reason"]

    def test_a_single_page_graduate_directory_is_captured_without_gaps(self, tmp_path: Path) -> None:
        undergrad = (
            "<h1>Student Groups</h1>"
            '<div class="views-row"><h3>Brown Ballroom Dance</h3></div>'
            '<a href="/gsg-directory">Graduate Student Groups</a>'
        )
        grad = '<h1>Student Groups</h1><div class="views-row"><h3>Grad Chess</h3></div>'

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/gsg-directory":
                return httpx.Response(200, content=grad.encode())
            return httpx.Response(200, content=undergrad.encode())

        session = offline_session(tmp_path, handler)
        harness.capture_clubs(session)
        assert [entry["source"] for entry in session.entries] == [
            "clubs_undergraduate",
            "clubs_graduate",
        ]
        assert session.gaps == []

    def test_a_missing_graduate_link_is_an_explicit_gap(self, tmp_path: Path) -> None:
        undergrad = '<h1>Student Groups</h1><div class="views-row"><h3>Solo Club</h3></div>'
        session = offline_session(tmp_path, lambda request: httpx.Response(200, content=undergrad.encode()))
        harness.capture_clubs(session)
        (gap,) = session.gaps
        assert gap["source"] == "clubs_graduate"
        assert "no graduate student groups link" in gap["reason"]


class TestCaptureLivewhale:
    def test_a_short_event_list_notes_the_ignored_max_and_a_failing_groups_fetch_gaps(
        self, tmp_path: Path
    ) -> None:
        events = json.dumps([{"title": "Concert on the Green"}, {"title": "Lecture"}])

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/events"):
                return httpx.Response(200, content=events.encode())
            return httpx.Response(404)

        session = offline_session(tmp_path, handler)
        harness.capture_livewhale(session)
        assert [entry["source"] for entry in session.entries] == ["livewhale_events"]
        assert any("was not honored — the endpoint returned 2 events" in note for note in session.notes)
        (gap,) = session.gaps
        assert gap["source"] == "livewhale_groups"

    def test_a_full_batch_of_200_events_and_healthy_groups_needs_no_extra_note(self, tmp_path: Path) -> None:
        events = json.dumps({"events": [{"title": f"Event {i}"} for i in range(200)]})
        groups = json.dumps({"groups": [{"fullname": "Brown Outing Club", "id": 1}]})

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/events"):
                return httpx.Response(200, content=events.encode())
            return httpx.Response(200, content=groups.encode())

        session = offline_session(tmp_path, handler)
        harness.capture_livewhale(session)
        assert [entry["source"] for entry in session.entries] == [
            "livewhale_events",
            "livewhale_groups",
        ]
        assert not any("was not honored" in note for note in session.notes)
        groups_entry = session.entries[1]
        assert groups_entry["expected"]["sample_group"] == "Brown Outing Club"
        assert session.gaps == []


#: Smallest payload that satisfies `_dining_expected`'s anchors. The anchors
#: are asserted against the STORED BYTES, so a stub that omits `"stations"` or
#: `"allergens"` fails the capture rather than the assertion — which is the
#: behaviour we want in production and therefore the behaviour to stub here.
DINING_MENUS_BODY = json.dumps(
    [
        {
            "name": "Blue Room",
            "locationId": "BR",
            "locationAddress": "75 Waterman St.",
            "meals": {
                "2026-07-29": [
                    {
                        "name": "Blue Room",
                        "meal": "Lunch",
                        "menu": {
                            "date": "2026-07-29",
                            "hours": {"start": "2026-07-29T07:30:00-04:00", "end": None},
                            "stations": [
                                {
                                    "stationId": 1,
                                    "name": "Pastry",
                                    "items": [
                                        {
                                            "itemId": 1,
                                            "item": "Muffin",
                                            "icons": [],
                                            "allergens": ["DAIRY"],
                                            "description": "",
                                            "itemType": "recipe",
                                        }
                                    ],
                                }
                            ],
                        },
                    }
                ]
            },
        }
    ]
).encode()


class TestCaptureOverpassDiningAthletics:
    def test_overpass_records_the_query_display_body_and_the_odbl_note(self, tmp_path: Path) -> None:
        body = json.dumps({"elements": [{"type": "way", "id": 1, "tags": {"name": "Sayles Hall"}}]})
        session = offline_session(tmp_path, lambda request: httpx.Response(200, content=body.encode()))
        harness.capture_overpass(session)
        (entry,) = session.entries
        assert entry["source"] == "overpass_buildings"
        assert entry["request_body"] == harness.OVERPASS_QUERY
        assert entry["expected"]["sample_building_name"] == "Sayles Hall"
        assert any("ODbL" in note for note in session.notes)

    def test_dining_bundles_are_deduplicated_captured_and_failures_gapped(self, tmp_path: Path) -> None:
        landing = (
            "<h1>Dining</h1>"
            '<script src="/sites/all/files/app.js"></script>'
            '<script src="/sites/all/files/app.js"></script>'
            '<script src="https://cdn.example.com/main.js"></script>'
            '<script src="/misc/other.js"></script>'
            '<script src="/themes/menu-config.js"></script>'
        )

        def handler(request: httpx.Request) -> httpx.Response:
            # The menus API is fetched FIRST now; the landing page is the
            # secondary discovery path.
            if "brown-dining" in request.url.path:
                return httpx.Response(200, content=DINING_MENUS_BODY)
            if request.url.path == "/":
                return httpx.Response(200, content=landing.encode())
            if request.url.path.endswith("app.js"):
                return httpx.Response(200, content=b"console.log(1)")
            return httpx.Response(404)

        session = offline_session(tmp_path, handler)
        harness.capture_dining(session)
        sources = [entry["source"] for entry in session.entries]
        # app.js is deduplicated and the cdn script is filtered as off-site;
        # every same-site script matches the "dining" host token, so other.js
        # and menu-config.js are attempted and their 404s become gaps.
        assert sources == ["dining_menus", "dining_landing", "dining_bundle"]
        assert [gap["source"] for gap in session.gaps] == ["dining_bundle", "dining_bundle"]
        assert "other.js" in session.gaps[0]["reason"]
        assert "menu-config.js" in session.gaps[1]["reason"]

    def test_a_bundleless_dining_page_is_an_explicit_gap(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path,
            lambda request: httpx.Response(200, content=DINING_MENUS_BODY)
            if "brown-dining" in request.url.path
            else httpx.Response(200, content=b"<h1>Dining</h1><p>static</p>")
        )
        harness.capture_dining(session)
        assert [entry["source"] for entry in session.entries] == ["dining_menus", "dining_landing"]
        (gap,) = session.gaps
        assert gap["source"] == "dining_bundle"
        assert "no same-site script/config bundles" in gap["reason"]

    def test_athletics_records_the_ics_facts_and_the_polling_note(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path, lambda request: httpx.Response(200, content=SAMPLE_ICS.encode())
        )
        harness.capture_athletics(session)
        (entry,) = session.entries
        assert entry["source"] == "athletics_ics"
        assert entry["expected"]["vevent_count"] == 1
        assert entry["expected"]["published_ttl"] == "PT120M"
        assert any("poll no more often" in note for note in session.notes)


class TestCaptureLibraries:
    LIBCAL_BODY = "<table><tr><td>Rockefeller</td></tr></table>"

    def test_a_previous_weeks_grid_that_rolled_out_of_the_window_is_deleted(self, tmp_path: Path) -> None:
        # 2026-08-26 is a Wednesday; the window anchors to Sunday 2026-08-23
        # and runs LIBCAL_WEEKS forward. 2026-07-26 is well before that
        # window, so it must be pruned rather than left as an orphan that
        # `test_every_stored_fixture_is_manifested` would trip on forever.
        session = offline_session(
            tmp_path, lambda request: httpx.Response(200, content=self.LIBCAL_BODY.encode())
        )
        stale = session.fixtures_root / "recorded" / "libraries" / "hours-grid-2026-07-26.html"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text("stale week, long rolled out of the window")

        harness.capture_libraries(session, start=date(2026, 8, 26))

        assert not stale.exists()
        captured_paths = {entry["path"] for entry in session.entries}
        assert "recorded/libraries/hours-grid-2026-07-26.html" not in captured_paths
        assert "recorded/libraries/hours-grid-2026-08-23.html" in captured_paths

    def test_a_file_still_inside_the_window_survives_pruning(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path, lambda request: httpx.Response(200, content=self.LIBCAL_BODY.encode())
        )
        in_window = session.fixtures_root / "recorded" / "libraries" / "hours-grid-2026-08-30.html"
        in_window.parent.mkdir(parents=True, exist_ok=True)
        in_window.write_text("last run's copy of a week still inside the new window")

        harness.capture_libraries(session, start=date(2026, 8, 26))

        # Overwritten by the fresh capture, not merely left alone — but never
        # unlinked, since 2026-08-30 falls inside the 08-23..7-week window.
        assert in_window.read_text() == self.LIBCAL_BODY

    def test_no_recorded_directory_yet_is_not_an_error(self, tmp_path: Path) -> None:
        session = offline_session(
            tmp_path, lambda request: httpx.Response(200, content=self.LIBCAL_BODY.encode())
        )
        harness.capture_libraries(session, start=date(2026, 8, 26))
        assert len(session.entries) == harness.LIBCAL_WEEKS


# -- main --------------------------------------------------------------------


class TestMain:
    @staticmethod
    def _good(session: harness.CaptureSession) -> None:
        session.entries.append({"path": "recorded/good/x.json", "source": "good_src"})

    @staticmethod
    def _bad(session: harness.CaptureSession) -> None:
        session.entries.append({"path": "recorded/bad/one.json", "source": "bad_captured"})
        session.gap("bad_declared", "known failure")
        raise RuntimeError("boom")

    def _patch_groups(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(harness, "GROUPS", {"good": self._good, "bad": self._bad})
        monkeypatch.setattr(
            harness,
            "GROUP_SOURCES",
            {"good": ("good_src",), "bad": ("bad_captured", "bad_declared", "bad_untouched")},
        )

    def test_a_failing_group_gaps_only_its_untouched_sources(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._patch_groups(monkeypatch)
        root = tmp_path / "fixtures"
        root.mkdir()
        exit_code = harness.main(["--root", str(root), "--cache-dir", str(tmp_path / "cache")])
        assert exit_code == 0
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        assert [entry["source"] for entry in manifest["fixtures"]] == ["bad_captured", "good_src"]
        gaps = {gap["source"]: gap["reason"] for gap in manifest["gaps"]}
        assert gaps["bad_declared"] == "known failure"
        assert gaps["bad_untouched"] == "capture failed after polite retries: RuntimeError: boom"
        assert set(gaps) == {"bad_declared", "bad_untouched"}

    def test_a_selective_run_merges_over_the_existing_manifest(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._patch_groups(monkeypatch)
        root = tmp_path / "fixtures"
        root.mkdir()
        (root / "manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "notes": [],
                    "gaps": [{"source": "bad_declared", "reason": "stale 403"}],
                    "fixtures": [{"path": "recorded/other/kept.json", "source": "other_src"}],
                }
            ),
            encoding="utf-8",
        )
        exit_code = harness.main(
            ["--root", str(root), "--cache-dir", str(tmp_path / "cache"), "--groups", "good"]
        )
        assert exit_code == 0
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        assert [entry["source"] for entry in manifest["fixtures"]] == ["good_src", "other_src"]
        # The bad group was not selected, so its stale gap survives untouched.
        assert manifest["gaps"] == [{"source": "bad_declared", "reason": "stale 403"}]
