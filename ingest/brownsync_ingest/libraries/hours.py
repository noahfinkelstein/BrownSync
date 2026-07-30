"""Opening hours for Brown's libraries and study spaces, from LibCal.

**The CSV was not the shortest path — it was a photograph of one.**
``brown_library_hours.csv`` in the repo root is a single week (2026-07-26 →
2026-08-01, 91 rows) captured by hand from
``https://lib.brown.edu/using-library/visiting-library/locations-hours``. That
page renders no hours itself: it loads ``https://libcal.brown.edu/js/hours_grid.js``,
which issues one request::

    GET https://libcal.brown.edu/widget/hours/grid?iid=1403&lid=0&date=YYYY-MM-DD

The widget answers **200, unauthenticated**, and is the exact upstream the CSV
was copied out of. It beats the CSV on three counts:

* ``date`` accepts any week, so coverage is measured in weeks, not seven days;
* every row carries a stable LibCal location id (``14071`` is the Rock) —
  the CSV has only display names, and display names are the part that gets
  reworded ("John Hay Library Public Access" was just "John Hay Library");
* it is re-fetchable, which makes this a job instead of a one-time paste.

So the CSV is *not* used. It stays useful as an independent cross-check of the
week it covers, and the parser is verified against it in the tests.

**The documented REST API is not open.** ``/api/1.1/hours/0`` answers 403 and
``/api/1.1/hours/lid/0`` answers 404 — LibCal's 1.1 API is OAuth
client-credentials and Brown has published no key. Recorded as a gap; not
worked around.

**Wall-clock, not UTC.** Timestamps keep their ``-04:00``/``-05:00`` offset,
same rule as the dining job: "the Rock closes at 9pm" has to survive to the
client without a tz database, and the offset is the load-bearing part.

**An undefined day is not a closed day.** LibCal renders a bare en-dash for
weeks staff have not filled in yet, and literally ``Closed`` for a day the
building is shut. Those must not collapse into each other, so a closed day is
published as a row with null open/close plus a note, while an undefined day is
published *not at all*. A date missing from ``hours`` therefore means "not
scheduled yet"; a date present with nulls means "answerable: no, it's closed".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date, datetime, time, timedelta
import json
from pathlib import Path
import re
from typing import Any, Iterable, Sequence
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "recorded" / "libraries"

#: Providence. Hardcoded rather than read from the server clock because the
#: artifact must render the same offsets whoever runs the job.
CAMPUS_TZ = ZoneInfo("America/New_York")

#: LibCal institution id for Brown, read out of the hours page's widget call.
LIBCAL_IID = 1403

#: LibCal location id → (published id, seeded ``places.ndjson`` id).
#:
#: Keyed on the numeric LibCal id, not the display name: names get reworded
#: upstream ("John Hay Library" became "John Hay Library Public Access") and a
#: name-keyed table would silently drop the row the day that happens. The ids
#: have been stable across every week fetched.
#:
#: Sub-desks (Services, Swipe Access, reading rooms) are kept as their own
#: entries sharing their building's place id. They are the *most* useful rows —
#: "swipe access until 2am" is the question students actually ask — and folding
#: them into the parent would have to either discard them or invent a merge.
#: Several entries pointing at one place is simply true: a building has more
#: than one door with more than one schedule.
LIBCAL_LOCATIONS: dict[str, tuple[str, str]] = {
    "14071": ("rock", "john-d-rockefeller-jr-library"),
    "19026": ("rock-services", "john-d-rockefeller-jr-library"),
    "18976": ("rock-swipe", "john-d-rockefeller-jr-library"),
    "14369": ("hay", "john-hay-library"),
    "26232": ("hay-special-collections-temporary", "john-hay-library"),
    "14620": ("hay-gildor-reading-room", "john-hay-library"),
    "18993": ("hay-swipe", "john-hay-library"),
    "14370": ("scili", "sciences-library"),
    "17114": ("scili-swipe", "sciences-library"),
    # The music library is inside Orwig Music Hall, 1 Young Orchard Ave; there
    # is no separate seeded place for the library within it.
    "17104": ("orwig", "orwig-music-hall"),
    # Champlin Memorial Library is at 222 Richmond St — the Warren Alpert
    # Medical School building. NOT `champlin-hall`, which is a dorm on the
    # opposite side of campus and the trap this comment exists to spring.
    "18991": ("champlin", "warren-alpert-medical-school"),
    "17105": ("annmary-brown", "annmary-brown-memorial"),
}

#: Rows in the grid that are deliberately not published, with the reason.
#:
#: An explicit table rather than a filter, so the exclusion is a decision on
#: the record. Anything in neither this table nor :data:`LIBCAL_LOCATIONS`
#: fails a gate — a new library must not be able to appear and be ignored.
NOT_A_PLACE: dict[str, str] = {
    "17103": "'Live Chat with Us' is a LibAnswers chat queue, not a room anyone walks into",
}

#: The rows whose absence means the grid broke rather than the estate changed.
#: These three are what "is the library open?" almost always means.
REQUIRED_LIBRARY_IDS: frozenset[str] = frozenset({"rock", "scili", "hay"})

#: Cell texts that mean "staff have not scheduled this week", not "closed".
#: The bare en-dash is what an unfilled cell renders as; the sentence shows up
#: in the first week past the end of the published calendar.
UNDEFINED_MARKERS: frozenset[str] = frozenset(
    {"", "-", "–", "—", "you have reached the end of the defined hours."}
)

#: ``8am``, ``12:30pm``, ``9:05 AM``.
_TIME = re.compile(r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<meridiem>[ap])\.?m\.?", re.I)

#: The grid separates a range with an en-dash; accept the plain hyphen and the
#: word "to" as well so a cosmetic change upstream is not an outage.
_RANGE_SPLIT = re.compile(r"\s*(?:–|—|--|-|\bto\b)\s*", re.I)

#: ``<th id="s-lc-whw-loc-14071">`` / ``s-lc-whw-subloc-19026``.
_ROW_ID = re.compile(r"^s-lc-whw-(?:sub)?loc-(\d+)$")

#: ``headers="s-lc-whw-loc-14071 s-lc-whw-date-20260726"``.
_CELL_DATE = re.compile(r"s-lc-whw-date-(\d{8})")


@dataclass(frozen=True)
class DayHours:
    """One published interval on one calendar day.

    ``opens``/``closes`` are ISO-8601 **with offset**, or both ``None`` for a
    day the space is shut or the hours are not expressible as a clock range
    ("Swipe only"). ``note`` carries the source's own words in that case, so
    the artifact never has to guess what the library meant.
    """

    date: str
    opens: str | None
    closes: str | None
    note: str | None

    @property
    def is_open(self) -> bool:
        return self.opens is not None


@dataclass(frozen=True)
class Library:
    libcal_id: str
    id: str
    name: str
    place_id: str | None
    hours: tuple[DayHours, ...]

    @property
    def open_days(self) -> int:
        return sum(1 for row in self.hours if row.is_open)


# -- parsing -----------------------------------------------------------------


def load_grids(paths: Sequence[Path] | None = None) -> list[str]:
    """Read the recorded weekly grids, oldest week first.

    Filenames embed the week-start date, so a plain sort is a chronological
    sort; ordering matters only for reproducible diagnostics.
    """
    sources = sorted(paths) if paths is not None else sorted(FIXTURE_DIR.glob("*.html"))
    if not sources:
        raise FileNotFoundError(f"no LibCal hour grids under {FIXTURE_DIR}")
    return [path.read_text(encoding="utf-8") for path in sources]


def _clock(raw: str) -> time | None:
    match = _TIME.fullmatch(raw.strip())
    if match is None:
        return None
    hour = int(match.group("hour"))
    if not 1 <= hour <= 12:
        return None
    minute = int(match.group("minute") or 0)
    if minute > 59:
        return None
    # 12am is 00:00 and 12pm is 12:00 — the one case where the arithmetic
    # is not "add 12 for pm".
    if match.group("meridiem").lower() == "p":
        hour = hour if hour == 12 else hour + 12
    elif hour == 12:
        hour = 0
    return time(hour, minute)


def _stamp(day: Date, clock: time) -> str:
    return datetime.combine(day, clock, tzinfo=CAMPUS_TZ).isoformat()


def parse_cell(day: Date, text: str) -> tuple[DayHours, ...]:
    """One grid cell → zero or more intervals on ``day``.

    Zero means the cell is undefined (see the module docstring): the caller
    publishes nothing for that date rather than inventing a closure.
    """
    cleaned = " ".join(text.split())
    if cleaned.lower() in UNDEFINED_MARKERS:
        return ()

    lowered = cleaned.lower()
    if lowered.startswith("closed") or lowered == "closed":
        return (DayHours(date=day.isoformat(), opens=None, closes=None, note=cleaned),)

    if "24 hour" in lowered or "24/7" in lowered:
        # Modelled as midnight to midnight so interval arithmetic on the
        # client is uniform; the note keeps the source's own phrasing.
        return (
            DayHours(
                date=day.isoformat(),
                opens=_stamp(day, time(0, 0)),
                closes=_stamp(day + timedelta(days=1), time(0, 0)),
                note=cleaned,
            ),
        )

    rows: list[DayHours] = []
    # LibCal can put two intervals in one cell ("8am – 12pm, 1pm – 5pm"), which
    # this recording does not contain but the product supports. Splitting on
    # the comma first means a split day publishes as two rows rather than one
    # wrong one spanning the closure.
    for chunk in cleaned.split(","):
        halves = _RANGE_SPLIT.split(chunk.strip())
        if len(halves) != 2:
            continue
        opens, closes = _clock(halves[0]), _clock(halves[1])
        if opens is None or closes is None:
            continue
        close_day = day
        # "8am – 2am" is Brown's ordinary term-time SciLi schedule: a close
        # time at or before the open time is the next calendar day, never a
        # zero-length day.
        if closes <= opens:
            close_day = day + timedelta(days=1)
        rows.append(
            DayHours(
                date=day.isoformat(),
                opens=_stamp(day, opens),
                closes=_stamp(close_day, closes),
                note=None,
            )
        )

    if rows:
        return tuple(rows)

    # Something with words in it that is not a clock range — "Swipe only",
    # "By appointment". Publishing it verbatim with null times is honest;
    # guessing an interval would not be.
    return (DayHours(date=day.isoformat(), opens=None, closes=None, note=cleaned),)


def parse_grid(markup: str) -> dict[str, tuple[str, tuple[DayHours, ...]]]:
    """One weekly grid → ``{libcal_id: (display name, day rows)}``."""
    soup = BeautifulSoup(markup, "html.parser")
    out: dict[str, tuple[str, tuple[DayHours, ...]]] = {}

    for row in soup.select("tr"):
        header = row.find("th", id=_ROW_ID)
        if header is None:
            continue
        libcal_id = _ROW_ID.match(header["id"]).group(1)
        name = " ".join(header.get_text(" ", strip=True).split())
        if not name:
            continue

        days: list[DayHours] = []
        for cell in row.find_all("td"):
            # bs4 treats `headers` as a space-separated multi-valued attribute
            # and hands back a list; older parses hand back the raw string.
            headers = cell.get("headers", "")
            if not isinstance(headers, str):
                headers = " ".join(headers)
            match = _CELL_DATE.search(headers)
            if match is None:
                continue
            day = datetime.strptime(match.group(1), "%Y%m%d").date()
            days.extend(parse_cell(day, cell.get_text(" ", strip=True)))
        out[libcal_id] = (name, tuple(days))

    return out


def normalize(grids: Iterable[str]) -> tuple[list[Library], list[str]]:
    """Weekly grids → one merged, date-sorted record per LibCal location."""
    diagnostics: list[str] = []
    names: dict[str, str] = {}
    collected: dict[str, dict[tuple[str, str | None, str | None, str | None], DayHours]] = {}
    undefined: dict[str, int] = {}
    seen_dates: set[str] = set()

    for week, markup in enumerate(grids):
        parsed = parse_grid(markup)
        if not parsed:
            diagnostics.append(f"grid #{week} contained no location rows")
            continue
        for libcal_id, (name, days) in parsed.items():
            names[libcal_id] = name
            bucket = collected.setdefault(libcal_id, {})
            for row in days:
                # Keyed rather than appended so a re-captured overlapping week
                # does not double every day it covers.
                bucket[(row.date, row.opens, row.closes, row.note)] = row
                seen_dates.add(row.date)

    libraries: list[Library] = []
    for libcal_id, name in sorted(names.items()):
        if libcal_id in NOT_A_PLACE:
            diagnostics.append(f"excluded {libcal_id} ({name}): {NOT_A_PLACE[libcal_id]}")
            continue
        mapping = LIBCAL_LOCATIONS.get(libcal_id)
        if mapping is None:
            # Kept, with a null place id, so the gate below can name it. The
            # dining module's rule: a new row is a loud failure, not a silent
            # omission.
            diagnostics.append(f"{libcal_id} ({name}) has no seeded place mapping")
            published_id, place_id = f"libcal-{libcal_id}", None
        else:
            published_id, place_id = mapping

        rows = sorted(collected.get(libcal_id, {}).values(), key=lambda r: (r.date, r.opens or ""))
        libraries.append(
            Library(
                libcal_id=libcal_id,
                id=published_id,
                name=name,
                place_id=place_id,
                hours=tuple(rows),
            )
        )

    for library in libraries:
        missing = len(seen_dates) - len({row.date for row in library.hours})
        if missing > 0:
            undefined[library.id] = missing
    if undefined:
        summary = ", ".join(f"{key}: {value}" for key, value in sorted(undefined.items()))
        diagnostics.append(
            "day(s) with no hours published upstream, omitted rather than "
            f"reported as closed — {summary}"
        )

    return sorted(libraries, key=lambda library: library.id), diagnostics


def build_document(libraries: Sequence[Library], generated_at: str) -> dict[str, Any]:
    """The published artifact. Schema v1."""
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "attribution": "Brown University Library",
        "libraries": [
            {
                "id": library.id,
                "name": library.name,
                "placeId": library.place_id,
                "hours": [
                    {
                        "date": row.date,
                        "open": row.opens,
                        "close": row.closes,
                        "note": row.note,
                    }
                    for row in library.hours
                ],
            }
            for library in libraries
        ],
    }


# -- job ---------------------------------------------------------------------

#: Twelve physical rows across three buildings plus Orwig, Champlin and the
#: Annmary Brown. Fewer means the grid changed shape, not that a library shut.
MIN_LIBRARIES = 12

#: Floor on total published day rows. The recording carries 548 across seven
#: weeks; this sits below one week's worth (12 rows × 7 days = 84) so a
#: single-week capture still publishes, but a grid that parsed to almost
#: nothing cannot.
MIN_DAY_ROWS = 60

#: At least this many rows must be a real interval. An estate reporting only
#: closures and notes is a dead parser, not a holiday.
MIN_OPEN_DAY_ROWS = 20


@dataclass(frozen=True)
class LibraryHoursJobResult:
    libraries: tuple[Library, ...]
    document: dict[str, Any]
    gate_failures: tuple[str, ...]
    published_count: int | None
    diagnostics: tuple[str, ...]


def run_library_hours_job(
    *,
    seeds_dir: Path | str,
    staging_root: Path | str,
    grid_paths: Sequence[Path] | None = None,
    generated_at: str | None = None,
) -> LibraryHoursJobResult:
    """Build and publish ``library_hours.json`` when every gate passes."""
    from brownsync_ingest.output import publish_json_document

    seeds_dir = Path(seeds_dir)
    libraries, diagnostics = normalize(load_grids(grid_paths))

    # GATES FIRST, and they fail closed: on any failure nothing is written, so
    # the previous artifact survives intact rather than being replaced by a
    # thinner one.
    gate_failures: list[str] = []

    if len(libraries) < MIN_LIBRARIES:
        gate_failures.append(f"libraries: {len(libraries)} < required {MIN_LIBRARIES}")

    unmapped = [f"{lib.libcal_id} ({lib.name})" for lib in libraries if lib.place_id is None]
    if unmapped:
        gate_failures.append(
            f"unmapped library row(s): {', '.join(unmapped)} — add them to LIBCAL_LOCATIONS "
            "(or NOT_A_PLACE, with a reason) rather than letting one drop off the map"
        )

    missing_required = sorted(REQUIRED_LIBRARY_IDS - {library.id for library in libraries})
    if missing_required:
        gate_failures.append(
            f"missing required librar(ies): {', '.join(missing_required)} — "
            "the grid no longer carries the rows the app is built around"
        )

    day_rows = sum(len(library.hours) for library in libraries)
    if day_rows < MIN_DAY_ROWS:
        gate_failures.append(f"day rows: {day_rows} < required {MIN_DAY_ROWS}")

    open_rows = sum(library.open_days for library in libraries)
    if open_rows < MIN_OPEN_DAY_ROWS:
        gate_failures.append(
            f"open day rows: {open_rows} < required {MIN_OPEN_DAY_ROWS} "
            "— every space reports closed or a bare note, which is a broken parse, not a holiday"
        )

    places_path = seeds_dir / "places.ndjson"
    if places_path.exists():
        seeded = {
            json.loads(line)["id"]
            for line in places_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        }
        dangling = sorted(
            {
                library.place_id
                for library in libraries
                if library.place_id is not None and library.place_id not in seeded
            }
        )
        if dangling:
            gate_failures.append(
                f"place id(s) not in places.ndjson: {', '.join(dangling)} — "
                "a binding that resolves to nothing is worse than no binding"
            )
        # Not a failure: the JCB runs its own hours system and is legitimately
        # absent from LibCal. Worth saying out loud so nobody re-derives it.
        bound = {library.place_id for library in libraries}
        for line in places_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            place = json.loads(line)
            if place.get("kind") == "library" and place["id"] not in bound:
                diagnostics.append(
                    f"seeded library place {place['id']} has no LibCal row — it publishes "
                    "hours elsewhere"
                )

    document: dict[str, Any] = {}
    published_count: int | None = None
    if not gate_failures:
        stamp = generated_at or datetime.now(CAMPUS_TZ).isoformat()
        document = build_document(libraries, stamp)
        publish_json_document(
            document, seeds_dir / "library_hours.json", Path(staging_root), compact=True
        )
        published_count = day_rows

    return LibraryHoursJobResult(
        libraries=tuple(libraries),
        document=document,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
        diagnostics=tuple(diagnostics),
    )
