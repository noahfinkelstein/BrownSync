"""Place-resolution reporting: hit rates, unresolved evidence, and the CAB gate.

Consumes ``ResolutionSample`` records produced by jobs that call the shared
``PlaceResolver`` and aggregates them into a deterministic report. The CAB
section-level gate (>= 90% by default) is computed on the exact fraction and
rendered explicitly as PASS/FAIL — or NOT EVALUATED when no CAB sections were
observed, which is never an implicit pass.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Mapping

from brownsync_ingest.gazetteer.resolver import Resolution


CAB_SOURCE = "cab"
DEFAULT_GATE_THRESHOLD = 0.90
DEFAULT_TOP_UNRESOLVED_LIMIT = 20


@dataclass(frozen=True)
class ResolutionSample:
    """One observed resolution, tagged with its source (and CAB section)."""

    source: str
    resolution: Resolution
    section_id: str | None = None  # required when source == "cab"


@dataclass(frozen=True)
class SourceStats:
    """Per-source resolution tallies."""

    total: int
    resolved: int

    @property
    def hit_rate(self) -> float:
        return self.resolved / self.total


@dataclass(frozen=True)
class PlaceResolutionReport:
    """The aggregated place-resolution picture for one run."""

    by_source: Mapping[str, SourceStats] = field(default_factory=dict)
    method_counts: Mapping[str, int] = field(default_factory=dict)
    reason_counts: Mapping[str, int] = field(default_factory=dict)
    top_unresolved: tuple[tuple[str, int], ...] = ()
    cab_sections_total: int = 0
    cab_sections_resolved: int = 0
    cab_section_rate: float | None = None
    cab_patterns_total: int = 0
    cab_patterns_resolved: int = 0
    cab_pattern_rate: float | None = None
    gate_threshold: float = DEFAULT_GATE_THRESHOLD
    gate_passed: bool | None = None  # None: no CAB sections were observed


def build_report(
    samples: Iterable[ResolutionSample],
    *,
    gate_threshold: float = DEFAULT_GATE_THRESHOLD,
    top_unresolved_limit: int = DEFAULT_TOP_UNRESOLVED_LIMIT,
) -> PlaceResolutionReport:
    """Aggregate samples into a deterministic place-resolution report."""
    totals: Counter[str] = Counter()
    resolved_counts: Counter[str] = Counter()
    method_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    unresolved_values: Counter[str] = Counter()
    sections: dict[str, bool] = {}
    patterns: dict[str, bool] = {}

    for sample in samples:
        if not sample.source:
            raise ValueError("every sample needs a non-empty source")
        resolution = sample.resolution
        resolved = resolution.place_id is not None
        totals[sample.source] += 1
        if resolved:
            resolved_counts[sample.source] += 1
        else:
            unresolved_values[resolution.query] += 1
            if resolution.reason is not None:
                reason_counts[resolution.reason] += 1
        method_counts[resolution.method] += 1
        if sample.source == CAB_SOURCE:
            if sample.section_id is None:
                raise ValueError(
                    "cab samples need a section_id for the section-level gate"
                )
            sections[sample.section_id] = sections.get(sample.section_id, True) and resolved
            patterns[resolution.query] = patterns.get(resolution.query, True) and resolved

    sections_total = len(sections)
    sections_resolved = sum(1 for ok in sections.values() if ok)
    patterns_total = len(patterns)
    patterns_resolved = sum(1 for ok in patterns.values() if ok)
    section_rate = sections_resolved / sections_total if sections_total else None
    pattern_rate = patterns_resolved / patterns_total if patterns_total else None

    top_unresolved = tuple(
        sorted(unresolved_values.items(), key=lambda item: (-item[1], item[0]))[
            :top_unresolved_limit
        ]
    )

    return PlaceResolutionReport(
        by_source={
            source: SourceStats(total=totals[source], resolved=resolved_counts[source])
            for source in sorted(totals)
        },
        method_counts=dict(sorted(method_counts.items())),
        reason_counts=dict(sorted(reason_counts.items())),
        top_unresolved=top_unresolved,
        cab_sections_total=sections_total,
        cab_sections_resolved=sections_resolved,
        cab_section_rate=section_rate,
        cab_patterns_total=patterns_total,
        cab_patterns_resolved=patterns_resolved,
        cab_pattern_rate=pattern_rate,
        gate_threshold=gate_threshold,
        gate_passed=None if section_rate is None else section_rate >= gate_threshold,
    )


def _percent(fraction: float) -> str:
    return f"{fraction * 100:.1f}%"


def _cell(value: str) -> str:
    return value.replace("|", "\\|")


def _count_table(title: str, counts: Mapping[str, int], head: str) -> list[str]:
    lines = [f"## {title}", ""]
    if not counts:
        lines.extend(["None.", ""])
        return lines
    lines.extend([f"| {head} | Count |", "| --- | ---: |"])
    for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"| {_cell(name)} | {count} |")
    lines.append("")
    return lines


def render_markdown(
    report: PlaceResolutionReport, *, generated_at: str | None = None
) -> str:
    """Render the report as deterministic Markdown."""
    lines: list[str] = ["# Place resolution report", ""]
    if generated_at is not None:
        lines.extend([f"Generated: {generated_at}", ""])

    lines.extend(["## Hit rate by source", ""])
    if report.by_source:
        lines.extend(
            ["| Source | Resolved | Total | Rate |", "| --- | ---: | ---: | ---: |"]
        )
        for source, stats in report.by_source.items():
            lines.append(
                f"| {_cell(source)} | {stats.resolved} | {stats.total} "
                f"| {_percent(stats.hit_rate)} |"
            )
    else:
        lines.append("No samples.")
    lines.append("")

    lines.extend(_count_table("Resolution methods", report.method_counts, "Method"))
    lines.extend(_count_table("Unresolved reasons", report.reason_counts, "Reason"))

    lines.extend(["## Top unresolved values", ""])
    if report.top_unresolved:
        lines.extend(["| Value | Count |", "| --- | ---: |"])
        for value, count in report.top_unresolved:
            lines.append(f"| {_cell(value)} | {count} |")
    else:
        lines.append("None.")
    lines.append("")

    lines.extend(["## CAB resolution", ""])
    if report.cab_sections_total:
        assert report.cab_section_rate is not None
        lines.append(
            f"- Sections resolved: {report.cab_sections_resolved}"
            f"/{report.cab_sections_total} ({_percent(report.cab_section_rate)})"
        )
        if report.cab_pattern_rate is not None:
            lines.append(
                f"- Patterns resolved: {report.cab_patterns_resolved}"
                f"/{report.cab_patterns_total} ({_percent(report.cab_pattern_rate)})"
            )
        lines.append("")
        verdict = "PASS" if report.gate_passed else "FAIL"
        lines.append(
            f"**Gate (CAB section resolution >= {_percent(report.gate_threshold)}): "
            f"{verdict}** — {_percent(report.cab_section_rate)} "
            f"({report.cab_sections_resolved}/{report.cab_sections_total} sections)"
        )
    else:
        lines.append("No CAB samples were observed.")
        lines.append("")
        lines.append(
            f"**Gate (CAB section resolution >= {_percent(report.gate_threshold)}): "
            "NOT EVALUATED** — no CAB sections observed."
        )
    lines.append("")
    return "\n".join(lines)
