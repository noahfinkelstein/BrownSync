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
USER_PROVIDED_ROOT = FIXTURES_ROOT / "user_provided"

# Manifest entries carry a "kind": "recorded" HTTP captures (the default when
# absent) keep every original check; "user_provided" inputs handed over by the
# user are hash-pinned with provenance and must name the capture gaps they
# fill. No other kind is allowed.
KNOWN_KINDS = {"recorded", "user_provided"}

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
    "athletics_ics": 1,
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


def entry_kind(entry: dict) -> str:
    kind = entry.get("kind", "recorded")
    assert kind in KNOWN_KINDS, f"{entry.get('path')}: unknown fixture kind {kind!r}"
    return kind


@pytest.fixture(scope="module")
def recorded_entries(entries: list[dict]) -> list[dict]:
    return [entry for entry in entries if entry_kind(entry) == "recorded"]


@pytest.fixture(scope="module")
def user_provided_entries(entries: list[dict]) -> list[dict]:
    return [entry for entry in entries if entry_kind(entry) == "user_provided"]


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
        expected_root = "recorded/" if entry_kind(entry) == "recorded" else "user_provided/"
        assert relative.startswith(expected_root), (
            f"{relative}: {entry_kind(entry)} fixture outside {expected_root}"
        )
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
    roots = [RECORDED_ROOT]
    if USER_PROVIDED_ROOT.is_dir():
        # user_provided/ holds inputs handed over by the user; since Task 6
        # they are manifest-mandatory exactly like recorded evidence.
        roots.append(USER_PROVIDED_ROOT)
    on_disk = {
        str(path.relative_to(FIXTURES_ROOT))
        for root in roots
        for path in root.rglob("*")
        if path.is_file()
    }
    unmanifested = on_disk - manifested
    assert not unmanifested, f"unmanifested fixture files present: {sorted(unmanifested)}"
    stray = {
        str(path.relative_to(FIXTURES_ROOT))
        for path in FIXTURES_ROOT.iterdir()
        if path.name not in {"manifest.json", "recorded", "user_provided"}
    }
    assert not stray, f"unexpected files beside the manifest: {sorted(stray)}"


def test_entry_identities_are_unique_and_well_formed(
    entries: list[dict], recorded_entries: list[dict]
) -> None:
    paths = [entry["path"] for entry in entries]
    assert len(paths) == len(set(paths)), "duplicate fixture paths in manifest"
    fingerprints = [entry["request_fingerprint"] for entry in recorded_entries]
    assert len(fingerprints) == len(set(fingerprints)), "duplicate request fingerprints in manifest"
    now = datetime.now(UTC) + timedelta(minutes=5)
    for entry in recorded_entries:
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


def test_user_provided_entries_carry_provenance_and_fill_declared_gaps(
    manifest: dict, user_provided_entries: list[dict]
) -> None:
    """User-provided inputs are hash-pinned data with provenance, not captures.

    They must say who provided them and when, explain why they exist (the
    provenance note), and name the declared capture gaps they stand in for
    (an empty list marks a supplementary input that fills no declared gap) —
    and they must never masquerade as recorded HTTP evidence.
    """
    gap_sources = {gap["source"] for gap in manifest["gaps"]}
    now = datetime.now(UTC) + timedelta(minutes=5)
    for entry in user_provided_entries:
        context = entry["path"]
        assert HEX_64.fullmatch(entry["sha256"]), f"{context}: malformed sha256"
        assert isinstance(entry["source"], str) and entry["source"], f"{context}: missing source key"
        assert entry.get("provided_by") == "user", f"{context}: provided_by must be 'user'"
        provided = datetime.fromisoformat(entry["provided_at"].replace("Z", "+00:00"))
        assert provided.tzinfo is not None, f"{context}: naive provided_at"
        assert provided <= now, f"{context}: provided_at is in the future"
        provenance = entry.get("provenance")
        assert isinstance(provenance, str) and provenance.strip(), f"{context}: missing provenance note"
        fills = entry.get("fills_gaps")
        assert isinstance(fills, list), f"{context}: fills_gaps must be a list (may be empty)"
        for source in fills:
            assert source in gap_sources, (
                f"{context}: fills_gaps names {source!r} which is not a declared gap"
            )
        for http_key in ("route", "request_fingerprint", "request_body", "status", "scrubbed"):
            assert http_key not in entry, (
                f"{context}: user_provided entry must not carry HTTP capture key {http_key!r}"
            )


# The 2026-07-29 data pack: 12 CSVs collected by Codex via browser and
# delivered by the user (the 13th, the Fall 2026 CAB export, is byte-identical
# to the Task 6 registration and stays under its original entry).
CODEX_PACK_PATHS = {
    "user_provided/brown_a_to_z_resources.csv",
    "user_provided/brown_academic_calendar_2026_2027.csv",
    "user_provided/brown_all_student_groups.csv",
    "user_provided/brown_athletics_calendar.csv",
    "user_provided/brown_college_hill_buildings.csv",
    "user_provided/brown_daily_herald_news.csv",
    "user_provided/brown_data_sources.csv",
    "user_provided/brown_dining_menu_links.csv",
    "user_provided/brown_event_locations.csv",
    "user_provided/brown_library_hours.csv",
    "user_provided/brown_news_archive.csv",
    "user_provided/brown_upcoming_events.csv",
}
CODEX_PROVENANCE_KEYS = {
    "dataset",
    "row_count",
    "coverage",
    "snapshot_utc",
    "source_name",
    "source_url",
    "update_strategy",
    "license_or_terms",
}


def test_the_codex_data_pack_is_registered_with_mirrored_provenance(
    user_provided_entries: list[dict],
) -> None:
    """Each pack CSV mirrors its brown_data_sources.csv provenance row."""
    by_path = {entry["path"]: entry for entry in user_provided_entries}
    missing = CODEX_PACK_PATHS - set(by_path)
    assert not missing, f"unregistered Codex pack CSVs: {sorted(missing)}"
    for path in sorted(CODEX_PACK_PATHS):
        entry = by_path[path]
        assert "collected by Codex via browser" in entry["provenance"], path
        assert "2026-07-29" in entry["provenance"], path
        mirrored = entry.get("codex_provenance")
        assert isinstance(mirrored, dict), f"{path}: missing codex_provenance mirror"
        assert set(mirrored) == CODEX_PROVENANCE_KEYS, (
            f"{path}: codex_provenance keys {sorted(mirrored)}"
        )
        snapshot = datetime.fromisoformat(mirrored["snapshot_utc"].replace("Z", "+00:00"))
        assert snapshot.tzinfo is not None, f"{path}: naive snapshot_utc"


def test_the_student_groups_csv_is_manifested_as_the_clubs_source(
    user_provided_entries: list[dict],
) -> None:
    """Task 7 consumes the user-supplied clubs export; it must be pinned here."""
    by_path = {entry["path"]: entry for entry in user_provided_entries}
    entry = by_path.get("user_provided/brown_all_student_groups.csv")
    assert entry is not None, "the student groups CSV is not manifested as user_provided"
    assert entry["source"] == "clubs_directory_csv"
    assert set(entry["fills_gaps"]) == {"clubs_undergraduate", "clubs_graduate"}
    expected = entry["expected"]
    assert expected["data_rows"] == 457
    assert expected["group_type_counts"] == {
        "Undergraduate student group": 424,
        "Graduate student group": 33,
    }


def test_the_cab_fall_2026_csv_is_manifested_as_user_provided(
    user_provided_entries: list[dict],
) -> None:
    """Task 6 consumes the user-supplied CAB export; it must be pinned here."""
    by_path = {entry["path"]: entry for entry in user_provided_entries}
    entry = by_path.get("user_provided/brown_fall_2026_classes_and_locations.csv")
    assert entry is not None, "the Fall 2026 CAB CSV is not manifested as user_provided"
    assert entry["source"] == "cab_fall_2026_csv"
    assert set(entry["fills_gaps"]) == {"cab_home", "cab_bootstrap", "cab_search", "cab_details"}
    expected = entry["expected"]
    assert expected["data_rows"] == 5275
    assert expected["term_code"] == "202610"


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


def _email_like_strings(path: str) -> set[str]:
    text = (FIXTURES_ROOT / path).read_text(encoding="utf-8", errors="replace")
    return {
        match.group(0)
        for match in EMAIL.finditer(text)
        # A match ending in the placeholder is scrubbed by construction:
        # the scan regex may absorb one preserved escape letter (e.g. the
        # "n" of a JSON "\n") into the local part.
        if not match.group(0).endswith(SCRUB_PLACEHOLDER)
        and not match.group(0).lower().endswith(NON_EMAIL_SUFFIXES)
    }


def test_no_personal_email_addresses_survive_in_recorded_fixtures(
    recorded_entries: list[dict],
) -> None:
    """Recorded HTTP evidence stays strictly scrubbed — unchanged since Task 3."""
    for entry in recorded_entries:
        leaked = _email_like_strings(entry["path"])
        assert not leaked, f"{entry['path']}: unscrubbed email-like strings {sorted(leaked)[:5]}"


def test_user_provided_contact_data_is_declared_never_silent(
    manifest: dict, user_provided_entries: list[dict]
) -> None:
    """User-provided files are pinned byte-for-byte as delivered, so they
    cannot be scrubbed without breaking the hash pin. Published directory
    contact data inside them is therefore permitted ONLY when the entry
    declares ``published_contact_data: true`` AND a manifest note explains
    the allowance; an undeclared email-bearing file still fails. Consumption
    stays contract-gated: no contract row carries these addresses.
    """
    notes = " ".join(manifest["notes"]).lower()
    for entry in user_provided_entries:
        declared = entry.get("published_contact_data", False)
        assert isinstance(declared, bool), f"{entry['path']}: flag must be boolean"
        leaked = _email_like_strings(entry["path"])
        if declared:
            assert leaked, (
                f"{entry['path']}: declares published contact data but contains none"
            )
            assert "published_contact_data" in notes, (
                "manifest notes must explain the published-contact allowance"
            )
        else:
            assert not leaked, (
                f"{entry['path']}: undeclared email-like strings {sorted(leaked)[:5]}"
            )
