"""Offline tests for the Task 8 capture-harness extension.

The athletics ICS joins the recorded evidence via a selective ``--groups``
run that must MERGE into the existing manifest: Task 3's fixtures, gaps, and
notes for unselected groups survive byte-for-byte, while entries for the
selected groups are replaced by the fresh capture. Importing the harness
module performs no network access; only ``main`` does.
"""
from __future__ import annotations

import json
from pathlib import Path

from brownsync_ingest import fixtures_capture as harness


SAMPLE_ICS = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SIDEARM Sports//NONSGML SIDEARM//EN",
        "X-WR-CALNAME:Brown University Athletics",
        "X-PUBLISHED-TTL:PT120M",
        "BEGIN:VEVENT",
        "UID:vcal_1-admin.brownbears.com",
        "SUMMARY:Brown University Women's Soccer vs New Haven",
        "LOCATION:Providence\\, R.I., Stevenson-Pincince ",
        " Field",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:vcal_2-admin.brownbears.com",
        "SUMMARY:Brown University Football at Harvard",
        "LOCATION:Cambridge\\, Mass.",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:vcal_3-admin.brownbears.com",
        "SUMMARY:Brown University Men's Soccer vs Yale",
        "LOCATION:Providence\\, R.I., Stevenson-Pincince Field",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
)


class TestAthleticsGroup:
    def test_the_athletics_group_is_registered_with_its_single_source(self) -> None:
        assert "athletics" in harness.GROUPS
        assert harness.GROUP_SOURCES["athletics"] == ("athletics_ics",)

    def test_expected_facts_count_vevents_and_distinct_unfolded_locations(self) -> None:
        facts = harness._athletics_ics_expected(SAMPLE_ICS.encode())
        assert facts["vevent_count"] == 3
        assert facts["calendar_name"] == "Brown University Athletics"
        assert facts["published_ttl"] == "PT120M"
        # The folded and unfolded spellings of Stevenson-Pincince Field are
        # one LOCATION value; the away game is the second.
        assert facts["distinct_location_count"] == 2
        assert "BEGIN:VCALENDAR" in facts["body_contains"]
        assert "X-WR-CALNAME:Brown University Athletics" in facts["body_contains"]

    def test_expected_fact_anchors_all_appear_in_the_raw_body(self) -> None:
        facts = harness._athletics_ics_expected(SAMPLE_ICS.encode())
        for anchor in facts["body_contains"]:
            assert anchor in SAMPLE_ICS


class TestManifestMerge:
    def _write_manifest(self, root: Path) -> dict:
        manifest = {
            "schema_version": 1,
            "generated_at": "2026-07-28T21:50:53.049590Z",
            "recorded_user_agent": "BrownSync/1.0 (+noah_finkelstein@brown.edu)",
            "notes": [
                "livewhale_events: contact_info values are blanked at capture",
                "overpass_buildings: OpenStreetMap data, ODbL licence",
            ],
            "gaps": [
                {"source": "dining_landing", "reason": "403 Forbidden"},
                {"source": "athletics_ics", "reason": "stale gap from an aborted run"},
            ],
            "fixtures": [
                {
                    "path": "recorded/livewhale/events.json",
                    "source": "livewhale_events",
                    "sha256": "0" * 64,
                    "bytes": 1,
                },
                {
                    "path": "recorded/athletics/calendar.ics",
                    "source": "athletics_ics",
                    "sha256": "1" * 64,
                    "bytes": 1,
                },
                {
                    "path": "user_provided/brown_fall_2026_classes_and_locations.csv",
                    "kind": "user_provided",
                    "source": "cab_fall_2026_csv",
                    "sha256": "2" * 64,
                    "bytes": 1,
                },
            ],
        }
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def _session(self, root: Path) -> harness.CaptureSession:
        return harness.CaptureSession(
            contact_email="noah_finkelstein@brown.edu",
            fixtures_root=root,
            cache_dir=root / "cache",
        )

    def test_preload_keeps_unselected_evidence_and_drops_selected_sources(
        self, tmp_path: Path
    ) -> None:
        self._write_manifest(tmp_path)
        session = self._session(tmp_path)
        harness.preload_manifest(session, selected_sources={"athletics_ics"})
        assert [entry["source"] for entry in session.entries] == [
            "livewhale_events",
            "cab_fall_2026_csv",
        ]
        assert [gap["source"] for gap in session.gaps] == ["dining_landing"]
        assert len(session.notes) == 2

    def test_preload_drops_stale_notes_of_the_selected_sources(self, tmp_path: Path) -> None:
        manifest = self._write_manifest(tmp_path)
        manifest["notes"].append("athletics_ics: stale note from an aborted run")
        (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        session = self._session(tmp_path)
        harness.preload_manifest(session, selected_sources={"athletics_ics"})
        assert session.notes == manifest["notes"][:2]

    def test_preload_without_an_existing_manifest_is_a_no_op(self, tmp_path: Path) -> None:
        session = self._session(tmp_path)
        harness.preload_manifest(session, selected_sources={"athletics_ics"})
        assert session.entries == [] and session.gaps == [] and session.notes == []

    def test_a_full_run_preloads_nothing_so_every_group_recaptures(self, tmp_path: Path) -> None:
        """Selecting every group replaces the whole manifest, as in Task 3."""
        self._write_manifest(tmp_path)
        session = self._session(tmp_path)
        selected = {
            source
            for group in harness.GROUPS
            for source in harness.GROUP_SOURCES[group]
        }
        harness.preload_manifest(session, selected_sources=selected)
        # user_provided entries are not owned by any capture group: preserved.
        assert [entry["source"] for entry in session.entries] == ["cab_fall_2026_csv"]
