from __future__ import annotations

from datetime import time

import pytest

from brownsync_ingest.contract import CourseMeetingRow, EventRow, PlaceRow
from brownsync_ingest.policy import (
    validate_cab_temporal_plausibility,
    validate_confidence,
    validate_coordinates,
    validate_multipolygon_wkt,
    validate_slug,
)


def test_schema_accepts_values_reserved_for_ingestion_policy() -> None:
    place = PlaceRow(
        id="Not a database slug",
        name="Unverified Place",
        kind="other",
        lat=91,
        lng=181,
    )
    event = EventRow(
        source="manual",
        source_id="unverified",
        title="Unverified",
        start_ts="2026-09-01T09:00:00Z",
        confidence=1.1,
    )
    meeting = CourseMeetingRow(
        id="meeting",
        srcdb="202610",
        crn="1",
        course_code="TEST 1",
        title="Test",
        days="M",
        start_time=time(12),
        end_time=time(11),
    )

    assert place.id == "Not a database slug"
    assert event.confidence == 1.1
    assert meeting.start_time >= meeting.end_time


@pytest.mark.parametrize("slug", ["barus-holley", "85-waterman", "a1-b2"])
def test_slug_policy_accepts_lower_kebab_identifiers(slug: str) -> None:
    assert validate_slug(slug) == slug


@pytest.mark.parametrize("slug", ["", "Barus-Holley", "barus_holley", "barus--holley", "-barus", "barus-"])
def test_slug_policy_rejects_non_lower_kebab_identifiers(slug: str) -> None:
    with pytest.raises(ValueError, match="slug"):
        validate_slug(slug)


@pytest.mark.parametrize(("lat", "lng"), [(-90, -180), (0, 0), (90, 180)])
def test_coordinate_policy_accepts_geographic_boundaries(lat: float, lng: float) -> None:
    assert validate_coordinates(lat, lng) == (lat, lng)


@pytest.mark.parametrize(("lat", "lng"), [(-90.001, 0), (90.001, 0), (0, -180.001), (0, 180.001)])
def test_coordinate_policy_rejects_values_outside_geographic_ranges(lat: float, lng: float) -> None:
    with pytest.raises(ValueError, match="latitude|longitude"):
        validate_coordinates(lat, lng)


@pytest.mark.parametrize("confidence", [0.0, 0.5, 1.0])
def test_confidence_policy_accepts_closed_unit_interval(confidence: float) -> None:
    assert validate_confidence(confidence) == confidence


@pytest.mark.parametrize("confidence", [-0.01, 1.01])
def test_confidence_policy_rejects_values_outside_closed_unit_interval(confidence: float) -> None:
    with pytest.raises(ValueError, match="confidence"):
        validate_confidence(confidence)


def test_cab_temporal_policy_accepts_a_normal_same_day_meeting() -> None:
    assert validate_cab_temporal_plausibility("TTh", time(10), time(11, 20)) is None


@pytest.mark.parametrize(
    ("days", "start_time", "end_time"),
    [("", time(10), time(11)), ("M", time(11), time(11)), ("M", time(12), time(11))],
)
def test_cab_temporal_policy_rejects_missing_days_or_non_increasing_times(
    days: str, start_time: time, end_time: time
) -> None:
    with pytest.raises(ValueError, match="days|start_time"):
        validate_cab_temporal_plausibility(days, start_time, end_time)


def test_polygon_policy_accepts_plain_multipolygon_and_null() -> None:
    polygon = (
        "MULTIPOLYGON(((-71.405 41.826, -71.404 41.826, "
        "-71.404 41.827, -71.405 41.826)))"
    )

    assert validate_multipolygon_wkt(polygon) == polygon
    assert validate_multipolygon_wkt(None) is None


@pytest.mark.parametrize("polygon", ["POLYGON((0 0, 1 1, 0 0))", "SRID=4326;MULTIPOLYGON(((0 0, 1 1, 0 0)))"])
def test_polygon_policy_rejects_non_plain_multipolygon_wkt(polygon: str) -> None:
    with pytest.raises(ValueError, match="MULTIPOLYGON"):
        validate_multipolygon_wkt(polygon)


@pytest.mark.parametrize(
    "polygon",
    [
        "MULTIPOLYGON((not-wkt))",
        "MULTIPOLYGON(((0 0, 1 1, 0 0)))",
        "MULTIPOLYGON(((0 0, 1 1, 1 0, 2 2)))",
    ],
)
def test_polygon_policy_rejects_malformed_content_inside_wrapper(polygon: str) -> None:
    with pytest.raises(ValueError, match="MULTIPOLYGON"):
        validate_multipolygon_wkt(polygon)
