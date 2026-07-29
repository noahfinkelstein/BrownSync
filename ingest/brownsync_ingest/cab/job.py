"""The CAB Fall 2026 job: CSV records -> contract rows behind fail-closed gates.

Publication policy (plan Task 6, adapted to the user-provided export): the
seeds file is replaced only when every gate passes —

1. ``subjects``: >= 50 distinct course-code prefixes among emitted rows;
2. ``meeting-rows``: >= 1,500 emitted contract-valid meeting rows.
   Task 6B recalibration, recorded verbatim in task-6b-brief.md: "Original
   2,000-row gate was calibrated for a live CAB scrape whose volume includes
   sections this authoritative user-provided export lists as arranged/TBA
   (3,328 of 5,275 records). Export maximum is 1,828 physically-scheduled
   rows. Revised threshold 1,500 approved by the orchestrating agent
   (Claude, owner of both lanes) 2026-07-29 per the plan's
   explicit-revised-threshold mechanism; automatic overrides remain
   forbidden.";
3. ``section-resolution``: >= 90% of sections with a published physical
   location resolve to a gazetteer place (the Task 5 report gate; an
   unevaluable gate — no published sections — fails closed). UNCHANGED by
   Task 6B.

A failing run renders the place-resolution report and leaves existing seeds
untouched: reports always, seeds only on full success.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pydantic import JsonValue

from brownsync_ingest.cab.csv_source import load_cab_csv
from brownsync_ingest.cab.meeting_parser import parse_meeting_schedule
from brownsync_ingest.cab.models import (
    CabCsvRecord,
    CabGates,
    GateCheck,
    MeetingPattern,
    SkippedSection,
)
from brownsync_ingest.contract import CourseMeetingRow
from brownsync_ingest.gazetteer.report import (
    PlaceResolutionReport,
    ResolutionSample,
    build_report,
    render_markdown,
)
from brownsync_ingest.gazetteer.resolver import PlaceResolver, Resolution
from brownsync_ingest.output import publish_ndjson


MIN_SUBJECTS = 50
MIN_MEETING_ROWS = 1500  # Task 6B signed-off revision; see module docstring
RESOLUTION_GATE = 0.90  # unchanged by Task 6B

SOURCE = "cab"
EMBEDDED_SOURCE = "cab-embedded"
STATUS_PUBLISHED = "Physical location published"

# Task 10 review: contract §3 pins /api/meetings as meetings "in session"
# and the contract table has no cancellation column, so a cancelled section
# must never publish rows — it becomes a structured skip instead.
SKIP_CANCELLED = "cancelled-section"

# The export's location cell joins one location per meeting pattern with the
# same separator the meeting_schedule cell uses (proven row-by-row by the
# cab_schedule_and_location column, e.g. crn 15392 "MW 10am-10:50am in
# Sayles Hall 104 TTh 10:30am-11:50am in Page-Robinson Hall 201").
_LOCATION_SEPARATOR = " | "

_INSTRUCTOR_SEPARATOR = "/"
_INSTRUCTOR_JOIN = "; "


def format_instructor(value: str) -> str | None:
    """Split ``/``-joined surnames verbatim, dedupe in source order, join."""
    if not value.strip():
        return None
    seen: list[str] = []
    for surname in value.split(_INSTRUCTOR_SEPARATOR):
        if surname and surname not in seen:
            seen.append(surname)
    return _INSTRUCTOR_JOIN.join(seen)


@dataclass(frozen=True)
class CabJobResult:
    """Everything one run measured, produced, and decided."""

    rows: tuple[CourseMeetingRow, ...]
    skips: tuple[SkippedSection, ...]
    duplicates_dropped: int
    subjects: tuple[str, ...]
    report: PlaceResolutionReport
    report_markdown: str
    gates: CabGates
    published_count: int | None  # None: gates failed, seeds untouched


def _subject(course_code: str) -> str:
    return course_code.split(maxsplit=1)[0]


def _section_locations(
    record: CabCsvRecord,
    patterns: tuple[MeetingPattern, ...],
    resolver: PlaceResolver,
    samples: list[ResolutionSample],
) -> tuple[tuple[str, Resolution], ...]:
    """(location_raw, resolution) per pattern for a published section.

    A ``' | '``-piped location cell aligned 1:1 with the patterns resolves
    location by location — every part is sampled under the section's crn, so
    the section-resolution gate ANDs them. Any other cell (single location,
    or a pipe count that does not match the pattern count, where the
    alignment is unproven) resolves once as a whole and is shared by every
    pattern — never guessed apart.
    """
    parts = record.location.split(_LOCATION_SEPARATOR)
    if len(parts) > 1 and len(parts) == len(patterns):
        aligned: list[tuple[str, Resolution]] = []
        for part in parts:
            resolution = resolver.resolve(part)
            samples.append(
                ResolutionSample(
                    source=SOURCE, resolution=resolution, section_id=record.crn
                )
            )
            aligned.append((part, resolution))
        return tuple(aligned)
    resolution = resolver.resolve(record.location)
    samples.append(
        ResolutionSample(source=SOURCE, resolution=resolution, section_id=record.crn)
    )
    return tuple((record.location, resolution) for _ in patterns)


def _pattern_location(
    record: CabCsvRecord,
    pattern: MeetingPattern,
    index: int,
    section_locations: tuple[tuple[str, Resolution], ...] | None,
    resolver: PlaceResolver,
    samples: list[ResolutionSample],
) -> tuple[str | None, str | None, str | None]:
    """(location_raw, place_id, room) for one emitted pattern."""
    if section_locations is not None:
        location_raw, resolution = section_locations[index]
        return (location_raw, resolution.place_id, resolution.room)
    if pattern.embedded_location is not None:
        resolution = resolver.resolve(pattern.embedded_location)
        samples.append(
            ResolutionSample(
                source=EMBEDDED_SOURCE, resolution=resolution, section_id=record.crn
            )
        )
        return (pattern.embedded_location, resolution.place_id, resolution.room)
    return (record.location or None, None, None)


def _meeting_row(
    record: CabCsvRecord,
    pattern: MeetingPattern,
    index: int,
    location_raw: str | None,
    place_id: str | None,
    room: str | None,
) -> CourseMeetingRow:
    raw: dict[str, JsonValue] = {
        "csv": dict(record.raw),
        "pattern": pattern.text,
        "pattern_index": index,
        "cancelled": record.cancelled,
    }
    if pattern.date_bounds is not None:
        raw["date_bounds"] = list(pattern.date_bounds)
    return CourseMeetingRow(
        id=f"{record.term_code}-{record.crn}-{index}",
        srcdb=record.term_code,
        crn=record.crn,
        course_code=record.course_code,
        title=record.course_title.strip(),
        instructor=format_instructor(record.instructor),
        days=pattern.days,
        start_time=pattern.start_time,
        end_time=pattern.end_time,
        location_raw=location_raw,
        place_id=place_id,
        room=room,
        enrollment=None,
        raw=raw,
    )


def _gates(
    rows: list[CourseMeetingRow],
    subjects: tuple[str, ...],
    report: PlaceResolutionReport,
    min_subjects: int,
    min_meeting_rows: int,
    resolution_gate: float,
) -> CabGates:
    section_rate = report.cab_section_rate
    return CabGates(
        checks=(
            GateCheck(
                name="subjects",
                required=float(min_subjects),
                actual=float(len(subjects)),
                passed=len(subjects) >= min_subjects,
            ),
            GateCheck(
                name="meeting-rows",
                required=float(min_meeting_rows),
                actual=float(len(rows)),
                passed=len(rows) >= min_meeting_rows,
            ),
            GateCheck(
                name="section-resolution",
                required=resolution_gate,
                actual=0.0 if section_rate is None else section_rate,
                # an unevaluable gate (no published sections) fails closed
                passed=section_rate is not None and section_rate >= resolution_gate,
            ),
        )
    )


def run_cab_csv_job(
    csv_path: Path | str,
    *,
    resolver: PlaceResolver,
    seeds_path: Path | str,
    report_path: Path | str,
    staging_root: Path | str,
    min_subjects: int = MIN_SUBJECTS,
    min_meeting_rows: int = MIN_MEETING_ROWS,
    resolution_gate: float = RESOLUTION_GATE,
    generated_at: str | None = None,
) -> CabJobResult:
    """Run the whole pipeline; publish seeds only when every gate passes."""
    records, duplicates_dropped = load_cab_csv(csv_path)

    rows: list[CourseMeetingRow] = []
    skips: list[SkippedSection] = []
    samples: list[ResolutionSample] = []
    for record in records:
        if record.cancelled:
            # a cancelled section is never "in session": no rows, and its
            # location stays out of the resolution denominator
            skips.append(
                SkippedSection(
                    term_code=record.term_code,
                    crn=record.crn,
                    course_code=record.course_code,
                    reason=SKIP_CANCELLED,
                    location_status=record.location_status,
                    meeting_schedule=record.meeting_schedule,
                )
            )
            continue
        published = record.location_status == STATUS_PUBLISHED
        parsed = parse_meeting_schedule(record.meeting_schedule, record.location_status)
        if parsed.skip_reason is not None:
            if published:
                # every published section enters the gate denominator,
                # whether or not its schedule yields meeting rows
                samples.append(
                    ResolutionSample(
                        source=SOURCE,
                        resolution=resolver.resolve(record.location),
                        section_id=record.crn,
                    )
                )
            skips.append(
                SkippedSection(
                    term_code=record.term_code,
                    crn=record.crn,
                    course_code=record.course_code,
                    reason=parsed.skip_reason,
                    location_status=record.location_status,
                    meeting_schedule=record.meeting_schedule,
                )
            )
            continue
        section_locations = (
            _section_locations(record, parsed.patterns, resolver, samples)
            if published
            else None
        )
        for index, pattern in enumerate(parsed.patterns):
            location_raw, place_id, room = _pattern_location(
                record, pattern, index, section_locations, resolver, samples
            )
            rows.append(
                _meeting_row(record, pattern, index, location_raw, place_id, room)
            )

    subjects = tuple(sorted({_subject(row.course_code) for row in rows}))
    report = build_report(samples, gate_threshold=resolution_gate)
    report_markdown = render_markdown(report, generated_at=generated_at)
    gates = _gates(rows, subjects, report, min_subjects, min_meeting_rows, resolution_gate)

    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_markdown, encoding="utf-8")

    published_count: int | None = None
    if gates.passed:
        published_count = publish_ndjson(
            rows, CourseMeetingRow, Path(seeds_path), Path(staging_root)
        )

    return CabJobResult(
        rows=tuple(rows),
        skips=tuple(skips),
        duplicates_dropped=duplicates_dropped,
        subjects=subjects,
        report=report,
        report_markdown=report_markdown,
        gates=gates,
        published_count=published_count,
    )
