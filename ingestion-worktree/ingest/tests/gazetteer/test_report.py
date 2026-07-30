from __future__ import annotations

import pytest

from brownsync_ingest.gazetteer.report import (
    ResolutionSample,
    build_report,
    render_markdown,
)
from brownsync_ingest.gazetteer.resolver import Resolution


def res(
    query: str,
    place_id: str | None = None,
    *,
    method: str | None = None,
    reason: str | None = None,
    room: str | None = None,
    score: float | None = None,
) -> Resolution:
    resolved = place_id is not None
    if method is None:
        method = "exact" if resolved else "unresolved"
    if not resolved and reason is None:
        reason = "below-threshold"
    return Resolution(
        query=query,
        place_id=place_id,
        room=room,
        method=method,
        reason=None if resolved else reason,
        score=score,
        candidates=(),
    )


def cab(query: str, place_id: str | None, section_id: str, **kwargs) -> ResolutionSample:
    return ResolutionSample(
        source="cab", resolution=res(query, place_id, **kwargs), section_id=section_id
    )


class TestBuildReport:
    def test_hit_rate_by_source(self) -> None:
        report = build_report(
            [
                cab("Salomon 101", "salomon-center-for-teaching", "202710-10001"),
                cab("Sayles Hall", "sayles-hall", "202710-10002"),
                cab("TBD", None, "202710-10003"),
                ResolutionSample(source="clubs", resolution=res("Ratty", "sharpe-refectory")),
            ]
        )
        assert report.by_source["cab"].total == 3
        assert report.by_source["cab"].resolved == 2
        assert report.by_source["cab"].hit_rate == pytest.approx(2 / 3)
        assert report.by_source["clubs"].total == 1
        assert report.by_source["clubs"].resolved == 1
        assert report.by_source["clubs"].hit_rate == pytest.approx(1.0)

    def test_method_and_reason_counts(self) -> None:
        report = build_report(
            [
                cab("Sayles Hall", "sayles-hall", "s1", method="exact"),
                cab("Salomon 101", "salomon-center-for-teaching", "s2", method="exact-room"),
                cab("MacMillan 117", "macmillan-hall", "s3", method="trigram"),
                cab("TBD", None, "s4", reason="below-threshold"),
                cab("Quincy Annex", None, "s5", reason="ambiguous"),
            ]
        )
        assert report.method_counts == {
            "exact": 1,
            "exact-room": 1,
            "trigram": 1,
            "unresolved": 2,
        }
        assert report.reason_counts == {"below-threshold": 1, "ambiguous": 1}

    def test_top_unresolved_orders_by_count_then_value_and_respects_the_limit(
        self,
    ) -> None:
        samples = (
            [cab("TBD", None, f"a{i}") for i in range(3)]
            + [cab("Arranged", None, f"b{i}") for i in range(2)]
            + [cab("Basement", None, f"c{i}") for i in range(2)]
            + [cab("Zzz", None, "d0")]
            + [cab("Sayles Hall", "sayles-hall", "e0")]
        )
        report = build_report(samples)
        assert report.top_unresolved == (
            ("TBD", 3),
            ("Arranged", 2),
            ("Basement", 2),
            ("Zzz", 1),
        )
        limited = build_report(samples, top_unresolved_limit=2)
        assert limited.top_unresolved == (("TBD", 3), ("Arranged", 2))

    def test_a_cab_section_counts_as_resolved_only_when_every_sample_resolved(
        self,
    ) -> None:
        report = build_report(
            [
                cab("Salomon 101", "salomon-center-for-teaching", "202710-1"),
                cab("TBD", None, "202710-1"),
                cab("Sayles Hall", "sayles-hall", "202710-2"),
                cab("Sayles Hall", "sayles-hall", "202710-2"),
            ]
        )
        assert report.cab_sections_total == 2
        assert report.cab_sections_resolved == 1
        assert report.cab_section_rate == pytest.approx(0.5)

    def test_cab_pattern_rate_uses_distinct_raw_values(self) -> None:
        report = build_report(
            [
                cab("Salomon 101", "salomon-center-for-teaching", "s1"),
                cab("Salomon 101", "salomon-center-for-teaching", "s2"),
                cab("TBD", None, "s3"),
            ]
        )
        assert report.cab_patterns_total == 2
        assert report.cab_patterns_resolved == 1
        assert report.cab_pattern_rate == pytest.approx(0.5)

    def test_gate_passes_at_exactly_the_threshold(self) -> None:
        resolved = [cab(f"Hall {i}", "sayles-hall", f"s{i}") for i in range(9)]
        report = build_report(resolved + [cab("TBD", None, "s9")])
        assert report.cab_section_rate == pytest.approx(0.9)
        assert report.gate_threshold == pytest.approx(0.9)
        assert report.gate_passed is True

    def test_gate_fails_just_below_the_threshold(self) -> None:
        resolved = [cab(f"Hall {i}", "sayles-hall", f"s{i}") for i in range(8)]
        report = build_report(resolved + [cab("TBD", None, "s8")])
        assert report.cab_section_rate == pytest.approx(8 / 9)
        assert report.gate_passed is False

    def test_cab_sample_without_a_section_id_is_an_error(self) -> None:
        with pytest.raises(ValueError, match="section_id"):
            build_report(
                [ResolutionSample(source="cab", resolution=res("Sayles Hall", "sayles-hall"))]
            )

    def test_empty_source_is_an_error(self) -> None:
        with pytest.raises(ValueError, match="source"):
            build_report([ResolutionSample(source="", resolution=res("x", "sayles-hall"))])

    def test_without_cab_samples_the_gate_is_not_evaluated(self) -> None:
        report = build_report(
            [ResolutionSample(source="clubs", resolution=res("Ratty", "sharpe-refectory"))]
        )
        assert report.cab_sections_total == 0
        assert report.cab_section_rate is None
        assert report.cab_pattern_rate is None
        assert report.gate_passed is None

    def test_no_samples_at_all_builds_an_empty_report(self) -> None:
        report = build_report([])
        assert report.by_source == {}
        assert report.top_unresolved == ()
        assert report.gate_passed is None


class TestRenderMarkdown:
    def test_pass_gate_is_rendered_explicitly(self) -> None:
        resolved = [cab(f"Hall {i}", "sayles-hall", f"s{i}") for i in range(9)]
        report = build_report(resolved + [cab("TBD", None, "s9")])
        document = render_markdown(report)
        assert "Gate (CAB section resolution >= 90.0%): PASS" in document
        assert "90.0% (9/10 sections)" in document
        assert "| cab | 9 | 10 | 90.0% |" in document

    def test_fail_gate_is_rendered_explicitly(self) -> None:
        resolved = [cab(f"Hall {i}", "sayles-hall", f"s{i}") for i in range(8)]
        report = build_report(resolved + [cab("TBD", None, "s8")])
        document = render_markdown(report)
        assert "Gate (CAB section resolution >= 90.0%): FAIL" in document
        assert "88.9% (8/9 sections)" in document

    def test_missing_cab_data_is_never_an_implicit_pass(self) -> None:
        document = render_markdown(build_report([]))
        assert "NOT EVALUATED" in document
        assert "PASS" not in document.replace("NOT EVALUATED", "")

    def test_unresolved_values_and_pipes_are_escaped(self) -> None:
        report = build_report(
            [
                cab("Weird | Value", None, "s1"),
                cab("Weird | Value", None, "s2"),
            ]
        )
        document = render_markdown(report)
        assert "Weird \\| Value" in document
        assert "| 2 |" in document

    def test_render_is_deterministic_and_includes_generated_at_only_when_given(
        self,
    ) -> None:
        report = build_report(
            [
                cab("Salomon 101", "salomon-center-for-teaching", "s1"),
                ResolutionSample(source="clubs", resolution=res("Ratty", "sharpe-refectory")),
                ResolutionSample(source="athletics", resolution=res("Nowhere", None)),
            ]
        )
        first = render_markdown(report)
        second = render_markdown(report)
        assert first == second
        assert "Generated:" not in first
        stamped = render_markdown(report, generated_at="2026-07-28T12:00:00Z")
        assert "Generated: 2026-07-28T12:00:00Z" in stamped

    def test_all_sections_appear_with_sources_sorted(self) -> None:
        report = build_report(
            [
                ResolutionSample(source="clubs", resolution=res("Ratty", "sharpe-refectory")),
                ResolutionSample(source="athletics", resolution=res("Nowhere", None)),
            ]
        )
        document = render_markdown(report)
        assert "# Place resolution report" in document
        assert "## Hit rate by source" in document
        assert "## Resolution methods" in document
        assert "## Unresolved reasons" in document
        assert "## Top unresolved values" in document
        assert "## CAB resolution" in document
        assert document.index("| athletics |") < document.index("| clubs |")
