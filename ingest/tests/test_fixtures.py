"""Integrity checks binding recorded fixtures to the capture manifest.

These tests are the gate against silent synthetic substitution: every stored
fixture must be named by ``ingest/fixtures/manifest.json`` with a matching
hash, every required source must either meet its capture minimum or be
declared as an explicit gap, and no personal email addresses may survive in
stored bodies.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
import re

import pytest

FIXTURES_ROOT = Path(__file__).resolve().parents[1] / "fixtures"
MANIFEST_PATH = FIXTURES_ROOT / "manifest.json"
RECORDED_ROOT = FIXTURES_ROOT / "recorded"

EXPECTED_USER_AGENT = "BrownSync/1.0 (+noah_finkelstein@brown.edu)"
SCRUB_PLACEHOLDER = "scrubbed@example.invalid"
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
ROUTE = re.compile(r"^(GET|POST) https://\S+$")

# Independent copy of the email shape (do not import the harness scrubber:
# the test must not share a blind spot with the code it audits).
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
# Asset references like image@2x.png are not email addresses.
NON_EMAIL_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".js", ".css", ".map", ".woff", ".woff2")

# Source key -> minimum number of manifested fixtures, unless the source is
# named in the manifest's explicit ``gaps`` list with a non-empty reason.
REQUIRED_MINIMUMS = {
    "cab_home": 1,
    "cab_search": 2,
    "cab_details": 20,
    "clubs_undergraduate": 1,
    "clubs_graduate": 1,
    "livewhale_events": 1,
    "livewhale_groups": 1,
    "overpass_buildings": 1,
    "dining_landing": 1,
    "dining_bundle": 1,
}


@pytest.fixture(scope="module")
def manifest() -> dict:
    if not MANIFEST_PATH.is_file():
        pytest.fail(f"fixture manifest is missing: {MANIFEST_PATH}")
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def entries(manifest: dict) -> list[dict]:
    fixtures = manifest["fixtures"]
    assert isinstance(fixtures, list) and fixtures, "manifest lists no fixtures"
    return fixtures


def test_manifest_header_is_schema_v1_with_the_exact_recorded_user_agent(manifest: dict) -> None:
    assert manifest["schema_version"] == 1
    assert manifest["recorded_user_agent"] == EXPECTED_USER_AGENT
    generated = datetime.fromisoformat(manifest["generated_at"].replace("Z", "+00:00"))
    assert generated.tzinfo is not None
    assert isinstance(manifest.get("notes"), list)
    assert isinstance(manifest.get("gaps"), list)
    for gap in manifest["gaps"]:
        assert isinstance(gap.get("source"), str) and gap["source"], "gap without a source key"
        assert isinstance(gap.get("reason"), str) and gap["reason"].strip(), "gap without a reason"


def test_every_manifest_entry_matches_a_stored_fixture_byte_for_byte(entries: list[dict]) -> None:
    for entry in entries:
        relative = entry["path"]
        assert relative.startswith("recorded/"), f"{relative}: fixture outside recorded/"
        assert ".." not in Path(relative).parts
        stored = FIXTURES_ROOT / relative
        assert stored.is_file(), f"{relative}: manifested fixture is missing on disk"
        body = stored.read_bytes()
        assert body, f"{relative}: fixture body is empty"
        assert len(body) == entry["bytes"], f"{relative}: stored length differs from manifest"
        assert hashlib.sha256(body).hexdigest() == entry["sha256"], f"{relative}: stored hash differs from manifest"


def test_every_stored_fixture_is_manifested(entries: list[dict]) -> None:
    assert RECORDED_ROOT.is_dir(), "recorded fixture tree is missing"
    manifested = {entry["path"] for entry in entries}
    on_disk = {
        str(path.relative_to(FIXTURES_ROOT))
        for path in RECORDED_ROOT.rglob("*")
        if path.is_file()
    }
    unmanifested = on_disk - manifested
    assert not unmanifested, f"unmanifested fixture files present: {sorted(unmanifested)}"
    stray = {
        str(path.relative_to(FIXTURES_ROOT))
        for path in FIXTURES_ROOT.iterdir()
        # user_provided/ holds inputs handed over by the user (not recorded
        # evidence); the task that consumes them must manifest them there.
        if path.name not in {"manifest.json", "recorded", "user_provided"}
    }
    assert not stray, f"unexpected files beside the manifest: {sorted(stray)}"


def test_entry_identities_are_unique_and_well_formed(entries: list[dict]) -> None:
    paths = [entry["path"] for entry in entries]
    assert len(paths) == len(set(paths)), "duplicate fixture paths in manifest"
    fingerprints = [entry["request_fingerprint"] for entry in entries]
    assert len(fingerprints) == len(set(fingerprints)), "duplicate request fingerprints in manifest"
    now = datetime.now(UTC) + timedelta(minutes=5)
    for entry in entries:
        context = entry["path"]
        assert HEX_64.fullmatch(entry["request_fingerprint"]), f"{context}: malformed fingerprint"
        assert HEX_64.fullmatch(entry["sha256"]), f"{context}: malformed sha256"
        assert ROUTE.fullmatch(entry["route"]), f"{context}: malformed route {entry['route']!r}"
        assert entry["status"] == 200, f"{context}: non-200 capture recorded"
        assert isinstance(entry["source"], str) and entry["source"], f"{context}: missing source key"
        assert isinstance(entry["content_type"], str) and entry["content_type"], f"{context}: missing content type"
        assert isinstance(entry["scrubbed"], bool), f"{context}: scrubbed flag must be boolean"
        if entry["route"].startswith("POST "):
            assert entry["request_body"] is not None, f"{context}: POST capture without its request body"
        retrieved = datetime.fromisoformat(entry["retrieved_at"].replace("Z", "+00:00"))
        assert retrieved.tzinfo is not None, f"{context}: naive retrieved_at"
        assert retrieved <= now, f"{context}: retrieved_at is in the future"


def test_expected_parser_facts_are_present_and_anchored_to_the_stored_bytes(entries: list[dict]) -> None:
    for entry in entries:
        context = entry["path"]
        expected = entry["expected"]
        assert isinstance(expected, dict) and expected, f"{context}: missing expected parser facts"
        anchors = expected.get("body_contains")
        assert isinstance(anchors, list) and anchors, f"{context}: expected.body_contains must be a non-empty list"
        text = (FIXTURES_ROOT / entry["path"]).read_text(encoding="utf-8", errors="replace")
        for anchor in anchors:
            assert isinstance(anchor, str) and anchor
            assert anchor in text, f"{context}: expected anchor {anchor!r} not found in stored body"


def test_required_sources_meet_minimums_or_are_explicit_gaps(manifest: dict, entries: list[dict]) -> None:
    gap_sources = {gap["source"] for gap in manifest["gaps"]}
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["source"]] = counts.get(entry["source"], 0) + 1
    for source, minimum in REQUIRED_MINIMUMS.items():
        if source in gap_sources:
            continue
        assert counts.get(source, 0) >= minimum, (
            f"{source}: {counts.get(source, 0)} fixture(s) recorded, {minimum} required, "
            "and no explicit gap declared — silent absence is not allowed"
        )
    notes = " ".join(manifest["notes"]).lower()
    if "cab_bootstrap" not in counts and "cab_bootstrap" not in gap_sources:
        assert "bootstrap" in notes, "cab_bootstrap absent without a fixture, gap, or explanatory note"


def test_cab_details_cover_at_least_twenty_distinct_crns(manifest: dict, entries: list[dict]) -> None:
    if "cab_details" in {gap["source"] for gap in manifest["gaps"]}:
        pytest.skip("cab_details declared as an explicit gap")
    crns = {entry["expected"].get("crn") for entry in entries if entry["source"] == "cab_details"}
    crns.discard(None)
    assert len(crns) >= 20, f"only {len(crns)} distinct CRNs captured in cab_details"


def test_no_personal_email_addresses_survive_in_stored_fixtures(entries: list[dict]) -> None:
    for entry in entries:
        text = (FIXTURES_ROOT / entry["path"]).read_text(encoding="utf-8", errors="replace")
        leaked = {
            match.group(0)
            for match in EMAIL.finditer(text)
            # A match ending in the placeholder is scrubbed by construction:
            # the scan regex may absorb one preserved escape letter (e.g. the
            # "n" of a JSON "\n") into the local part.
            if not match.group(0).endswith(SCRUB_PLACEHOLDER)
            and not match.group(0).lower().endswith(NON_EMAIL_SUFFIXES)
        }
        assert not leaked, f"{entry['path']}: unscrubbed email-like strings {sorted(leaked)[:5]}"
