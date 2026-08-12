"""Offline test for the libraries capture group's rolling-window pruning.

`capture_libraries` records a 7-week sliding window of LibCal hours grids
under `recorded/libraries/hours-grid-<date>.html`. Each day the window
shifts forward by one day (and by a full week once a Sunday passes), so a
filename that was in-window yesterday can fall out of it today. Nothing
else in the harness ever removes a fixture file, so those same-named files
were piling up on disk forever — present as bytes, absent from the fresh
manifest — which trips `test_every_stored_fixture_is_manifested` in
`test_fixtures.py`. This asserts the harness prunes them itself.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from brownsync_ingest import fixtures_capture as harness


class TestLibraryFixturePruning:
    def _session(self, root: Path) -> harness.CaptureSession:
        return harness.CaptureSession(
            contact_email="noah_finkelstein@brown.edu",
            fixtures_root=root,
            cache_dir=root / "cache",
        )

    def test_weeks_that_scrolled_out_of_the_window_are_deleted(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        libraries_dir = tmp_path / "recorded" / "libraries"
        libraries_dir.mkdir(parents=True)
        # Two weeks left behind by a run whose window has since moved on.
        (libraries_dir / "hours-grid-2026-07-26.html").write_text("stale")
        (libraries_dir / "hours-grid-2026-08-02.html").write_text("stale")
        # A file this capture group would never have produced — not its
        # business to touch.
        (libraries_dir / "not-ours.html").write_text("leave me alone")

        session = self._session(tmp_path)
        monkeypatch.setattr(harness.CaptureSession, "capture", lambda self, **kwargs: b"")

        harness.capture_libraries(session, start=date(2026, 8, 12))

        remaining = {path.name for path in libraries_dir.glob("*.html")}
        assert "hours-grid-2026-07-26.html" not in remaining
        assert "hours-grid-2026-08-02.html" not in remaining
        assert "not-ours.html" in remaining
        assert any(
            "pruned stale fixture hours-grid-2026-07-26.html" in note for note in session.notes
        )
        assert any(
            "pruned stale fixture hours-grid-2026-08-02.html" in note for note in session.notes
        )

    def test_a_file_still_inside_the_window_survives(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        libraries_dir = tmp_path / "recorded" / "libraries"
        libraries_dir.mkdir(parents=True)
        # 2026-08-09 is the Sunday on/before 2026-08-12, so it is week 0 of
        # the fresh window and must not be treated as stale.
        (libraries_dir / "hours-grid-2026-08-09.html").write_text("current")

        session = self._session(tmp_path)
        monkeypatch.setattr(harness.CaptureSession, "capture", lambda self, **kwargs: b"")

        harness.capture_libraries(session, start=date(2026, 8, 12))

        remaining = {path.name for path in libraries_dir.glob("*.html")}
        assert "hours-grid-2026-08-09.html" in remaining
        assert not any("pruned" in note for note in session.notes)
