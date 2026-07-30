"""Library hours from Brown's LibCal weekly grid.

The interesting failures here are quiet ones: a day the parser reports closed
when upstream never scheduled it, an overnight close time landing on the wrong
calendar day, a renamed row dropping a library off the map. Each test below
names the one it prevents.
"""

from __future__ import annotations

import csv
from datetime import date
import json
from pathlib import Path

import pytest

from brownsync_ingest.libraries.hours import (
    LIBCAL_LOCATIONS,
    MIN_DAY_ROWS,
    MIN_LIBRARIES,
    NOT_A_PLACE,
    REQUIRED_LIBRARY_IDS,
    Library,
    build_document,
    load_grids,
    normalize,
    parse_cell,
    parse_grid,
    run_library_hours_job,
)


@pytest.fixture(scope="module")
def libraries() -> list[Library]:
    rows, _ = normalize(load_grids())
    return rows


@pytest.fixture(scope="module")
def diagnostics() -> list[str]:
    _, messages = normalize(load_grids())
    return messages


class TestCellParsing:
    def test_plain_range_keeps_the_campus_offset(self) -> None:
        # Normalizing to UTC would make "closes at 9pm" unrenderable on a
        # client with no tz database — the whole point of keeping the offset.
        (row,) = parse_cell(date(2026, 7, 27), "8am – 9pm")
        assert row.opens == "2026-07-27T08:00:00-04:00"
        assert row.closes == "2026-07-27T21:00:00-04:00"
        assert row.note is None

    def test_offset_follows_daylight_saving(self) -> None:
        # Same wall-clock hour, different offset in January. A hardcoded
        # -04:00 would put every winter timestamp an hour out.
        (row,) = parse_cell(date(2027, 1, 20), "8am – 9pm")
        assert row.opens == "2027-01-20T08:00:00-05:00"

    def test_noon_and_midnight_are_not_off_by_twelve(self) -> None:
        # 12pm is 12:00 and 12am is 00:00; the naive "add 12 for pm" rule gets
        # both wrong and would have the Rock opening at midnight.
        (row,) = parse_cell(date(2026, 7, 26), "12pm – 7pm")
        assert row.opens.startswith("2026-07-26T12:00:00")
        (midnight,) = parse_cell(date(2026, 7, 26), "12am – 6am")
        assert midnight.opens.startswith("2026-07-26T00:00:00")

    def test_minutes_survive(self) -> None:
        # The recording really contains "8am – 12:30pm"; dropping :30 would
        # silently round the Gildor reading room's closing time.
        (row,) = parse_cell(date(2026, 8, 3), "8am – 12:30pm")
        assert row.closes == "2026-08-03T12:30:00-04:00"

    def test_overnight_close_lands_on_the_next_day(self) -> None:
        # Term-time SciLi is "8am – 2am". A close time at or before the open
        # time means tomorrow — otherwise the interval is negative and every
        # "open now?" check answers no all evening.
        (row,) = parse_cell(date(2026, 10, 5), "8am – 2am")
        assert row.opens == "2026-10-05T08:00:00-04:00"
        assert row.closes == "2026-10-06T02:00:00-04:00"

    def test_closed_is_a_row_not_an_absence(self) -> None:
        # An absent row is unanswerable; a null row with a note is an
        # answerable "no". That difference is the whole schema decision.
        (row,) = parse_cell(date(2026, 7, 26), "Closed")
        assert (row.opens, row.closes) == (None, None)
        assert row.note == "Closed"
        assert row.date == "2026-07-26"

    def test_undefined_day_produces_nothing(self) -> None:
        # LibCal renders a bare en-dash for a week nobody has scheduled yet.
        # Publishing that as closed would be fabricating a closure.
        assert parse_cell(date(2026, 9, 14), "–") == ()
        assert parse_cell(date(2026, 9, 14), "") == ()
        assert parse_cell(date(2027, 1, 4), "You have reached the end of the defined hours.") == ()

    def test_24_hours_spans_to_the_next_midnight(self) -> None:
        (row,) = parse_cell(date(2026, 7, 26), "24 Hours")
        assert row.opens == "2026-07-26T00:00:00-04:00"
        assert row.closes == "2026-07-27T00:00:00-04:00"
        assert row.note == "24 Hours"

    def test_non_clock_text_is_kept_verbatim_with_null_times(self) -> None:
        # "Swipe only" is the SciLi's actual summer state. Inventing an
        # interval for it would be a lie; dropping it would erase the day.
        (row,) = parse_cell(date(2026, 7, 26), "Swipe only")
        assert (row.opens, row.closes) == (None, None)
        assert row.note == "Swipe only"

    def test_split_day_becomes_two_intervals(self) -> None:
        # LibCal supports a lunchtime closure. One row spanning it would
        # report the library open while it is locked.
        rows = parse_cell(date(2026, 10, 5), "8am – 12pm, 1pm – 5pm")
        assert len(rows) == 2
        assert rows[0].closes.startswith("2026-10-05T12:00:00")
        assert rows[1].opens.startswith("2026-10-05T13:00:00")


class TestNormalization:
    def test_reads_the_whole_estate(self, libraries) -> None:
        assert len(libraries) == MIN_LIBRARIES
        assert {library.libcal_id for library in libraries} == set(LIBCAL_LOCATIONS)

    def test_every_library_binds_to_a_seeded_place(self, libraries, repo_root) -> None:
        # A library with no place id cannot be put on the map or reached from
        # a place page — it silently stops existing.
        seeded = {
            json.loads(line)["id"]
            for line in (repo_root / "db/seeds/places.ndjson").read_text().splitlines()
            if line.strip()
        }
        for library in libraries:
            assert library.place_id, library.libcal_id
            assert library.place_id in seeded, f"{library.id} → {library.place_id}"

    def test_champlin_is_not_the_dorm(self, libraries) -> None:
        # "Champlin Memorial Library" and "Champlin Hall" are different
        # buildings on opposite sides of campus. The medical library is at
        # 222 Richmond St, inside the Alpert Medical School.
        champlin = next(library for library in libraries if library.id == "champlin")
        assert champlin.place_id == "warren-alpert-medical-school"

    def test_sub_desks_share_their_buildings_place(self, libraries) -> None:
        # Three Rock rows, one Rock. Several entries pointing at one place is
        # correct — a building has more than one door with its own schedule.
        rock = {lib.id: lib.place_id for lib in libraries if lib.id.startswith("rock")}
        assert set(rock) == {"rock", "rock-services", "rock-swipe"}
        assert set(rock.values()) == {"john-d-rockefeller-jr-library"}

    def test_required_libraries_are_present(self, libraries) -> None:
        assert REQUIRED_LIBRARY_IDS <= {library.id for library in libraries}

    def test_hours_are_date_ordered(self, libraries) -> None:
        for library in libraries:
            keys = [(row.date, row.opens or "") for row in library.hours]
            assert keys == sorted(keys), library.id

    def test_every_published_timestamp_carries_an_offset(self, libraries) -> None:
        for library in libraries:
            for row in library.hours:
                for stamp in (row.opens, row.closes):
                    if stamp:
                        assert stamp.endswith(("-04:00", "-05:00")), (library.id, stamp)

    def test_a_space_closed_all_summer_still_publishes_days(self, libraries) -> None:
        # John Hay public access is shut for the whole recording. It must
        # still carry a row per day, or "is the Hay open today?" degrades from
        # answerable-no to unanswerable.
        hay = next(library for library in libraries if library.id == "hay")
        assert hay.open_days == 0
        assert len(hay.hours) > 40
        assert all(row.note == "Closed" for row in hay.hours)

    def test_undefined_days_are_omitted_and_reported(self, libraries, diagnostics) -> None:
        # The Rock's grid runs out before Champlin's blanket 24-hour rule
        # does. Those trailing days must be absent, not closed, and the gap
        # must be said out loud rather than inferred from a short array.
        rock = next(library for library in libraries if library.id == "rock")
        champlin = next(library for library in libraries if library.id == "champlin")
        assert len(rock.hours) < len(champlin.hours)
        assert any("no hours published upstream" in message for message in diagnostics)

    def test_the_chat_queue_is_excluded_on_the_record(self, libraries, diagnostics) -> None:
        # It is a LibAnswers queue, not a room. Excluded deliberately, and the
        # exclusion is stated so nobody re-adds it as a "missing library".
        assert "17103" not in {library.libcal_id for library in libraries}
        assert any("17103" in message for message in diagnostics)

    def test_an_unmapped_row_is_reported_not_dropped(self) -> None:
        # A new library appearing upstream must be a loud failure. Dropping it
        # is the outcome that goes unnoticed for a term.
        markup = """
        <table><tbody><tr class="s-lc-whw-loc">
          <th scope="row" id="s-lc-whw-loc-99999">Brand New Library</th>
          <td headers="s-lc-whw-loc-99999 s-lc-whw-date-20260726">9am – 5pm</td>
        </tr></tbody></table>
        """
        rows, messages = normalize([markup])
        assert len(rows) == 1
        assert rows[0].place_id is None
        assert any("99999" in message for message in messages)

    def test_overlapping_weeks_do_not_duplicate_days(self) -> None:
        # Re-capturing a week already recorded must not double every row it
        # covers; rows are keyed, not appended.
        grids = load_grids()
        once, _ = normalize(grids[:1])
        twice, _ = normalize(grids[:1] + grids[:1])
        assert [len(library.hours) for library in once] == [
            len(library.hours) for library in twice
        ]


class TestAgainstTheUserCsv:
    def test_the_live_grid_reproduces_the_user_snapshot_exactly(self, repo_root) -> None:
        # `brown_library_hours.csv` was captured by hand from the rendered
        # hours page for the week of 2026-07-26. It is an independent witness:
        # if the widget parser and the human snapshot disagree on any cell,
        # one of them is reading the grid wrong.
        csv_path = repo_root / "ingest/fixtures/user_provided/brown_library_hours.csv"
        with csv_path.open(encoding="utf-8-sig") as handle:
            expected = {
                (row["location"], row["date"]): " ".join(row["hours"].split())
                for row in csv.DictReader(handle)
            }

        grid_path = repo_root / "ingest/fixtures/recorded/libraries/hours-grid-2026-07-26.html"
        parsed = parse_grid(grid_path.read_text(encoding="utf-8"))

        checked = 0
        for name, days in parsed.values():
            for row in days:
                snapshot = expected[(name, row.date)]
                # Re-parse the CSV's own text and require the same structure.
                assert parse_cell(date.fromisoformat(row.date), snapshot) == (row,), (
                    name,
                    row.date,
                    snapshot,
                )
                checked += 1
        assert checked == len(expected) == 91


class TestJob:
    def test_publishes_when_the_gates_pass(self, tmp_path: Path) -> None:
        result = run_library_hours_job(
            seeds_dir=tmp_path,
            staging_root=tmp_path / "staging",
            generated_at="2026-07-29T20:00:00-04:00",
        )
        assert result.gate_failures == ()
        assert result.published_count and result.published_count >= MIN_DAY_ROWS

        document = json.loads((tmp_path / "library_hours.json").read_text())
        assert document["schema_version"] == 1
        assert document["generated_at"] == "2026-07-29T20:00:00-04:00"
        assert document["attribution"] == "Brown University Library"
        assert len(document["libraries"]) == MIN_LIBRARIES

        rock = next(lib for lib in document["libraries"] if lib["id"] == "rock")
        assert rock["placeId"] == "john-d-rockefeller-jr-library"
        assert set(rock["hours"][0]) == {"date", "open", "close", "note"}

    def test_is_published_compact(self, tmp_path: Path) -> None:
        # This ships to the browser; pretty-printing it is pure wire cost.
        run_library_hours_job(seeds_dir=tmp_path, staging_root=tmp_path / "staging")
        raw = (tmp_path / "library_hours.json").read_text()
        assert '", "' not in raw and raw.count("\n") == 1

    def test_a_thin_grid_fails_closed_and_leaves_the_artifact_alone(self, tmp_path: Path) -> None:
        # The rule that matters: a bad run must not replace yesterday's good
        # artifact with a worse one.
        destination = tmp_path / "library_hours.json"
        destination.write_text('{"schema_version":1,"libraries":["previous"]}')

        thin = tmp_path / "thin.html"
        thin.write_text(
            """<table><tbody><tr class="s-lc-whw-loc">
              <th scope="row" id="s-lc-whw-loc-14071">Rockefeller Library</th>
              <td headers="s-lc-whw-loc-14071 s-lc-whw-date-20260726">9am – 5pm</td>
            </tr></tbody></table>"""
        )
        result = run_library_hours_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", grid_paths=[thin]
        )
        assert result.gate_failures
        assert result.published_count is None
        assert json.loads(destination.read_text())["libraries"] == ["previous"]

    def test_a_new_library_fails_loudly(self, tmp_path: Path) -> None:
        source = tmp_path / "new.html"
        source.write_text(
            """<table><tbody><tr class="s-lc-whw-loc">
              <th scope="row" id="s-lc-whw-loc-99999">Brand New Library</th>
              <td headers="s-lc-whw-loc-99999 s-lc-whw-date-20260726">9am – 5pm</td>
            </tr></tbody></table>"""
        )
        result = run_library_hours_job(
            seeds_dir=tmp_path, staging_root=tmp_path / "staging", grid_paths=[source]
        )
        assert any("unmapped" in failure for failure in result.gate_failures)
        assert not (tmp_path / "library_hours.json").exists()

    def test_a_dangling_place_binding_fails(self, tmp_path: Path) -> None:
        # A placeId that resolves to nothing is worse than none: the UI links
        # to a 404 instead of omitting the link.
        (tmp_path / "places.ndjson").write_text('{"id":"somewhere-else","kind":"library"}\n')
        result = run_library_hours_job(seeds_dir=tmp_path, staging_root=tmp_path / "staging")
        assert any("places.ndjson" in failure for failure in result.gate_failures)
        assert not (tmp_path / "library_hours.json").exists()

    def test_a_seeded_library_with_no_libcal_row_is_a_diagnostic_not_a_failure(
        self, tmp_path: Path, repo_root
    ) -> None:
        # The John Carter Brown runs its own hours system and is legitimately
        # absent from LibCal. That must not block a publish.
        (tmp_path / "places.ndjson").write_text(
            (repo_root / "db/seeds/places.ndjson").read_text()
        )
        result = run_library_hours_job(seeds_dir=tmp_path, staging_root=tmp_path / "staging")
        assert result.gate_failures == ()
        assert any("john-carter-brown-library" in message for message in result.diagnostics)


class TestDocument:
    def test_closed_days_survive_into_the_artifact(self, libraries) -> None:
        # The end-to-end version of the schema decision: a shut library is a
        # row of nulls with a note, never a missing date.
        document = build_document(libraries, "2026-07-29T20:00:00-04:00")
        hay = next(lib for lib in document["libraries"] if lib["id"] == "hay")
        closed = [row for row in hay["hours"] if row["open"] is None]
        assert closed
        assert all(row["close"] is None and row["note"] for row in closed)

    def test_every_library_appears_even_when_never_open(self, libraries) -> None:
        document = build_document(libraries, "2026-07-29T20:00:00-04:00")
        ids = {library["id"] for library in document["libraries"]}
        assert ids == {published for published, _ in LIBCAL_LOCATIONS.values()}
        assert "17103" not in ids and NOT_A_PLACE
