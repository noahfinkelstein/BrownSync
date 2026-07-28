"""Ingestion-only quality gates kept separate from contract row construction."""

from __future__ import annotations

from datetime import time
import math
import re


_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
_NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
_COORDINATE = rf"{_NUMBER}[ \t]+{_NUMBER}"
_RING = rf"\([ \t]*{_COORDINATE}(?:[ \t]*,[ \t]*{_COORDINATE}){{3,}}[ \t]*\)"
_POLYGON = rf"\([ \t]*{_RING}(?:[ \t]*,[ \t]*{_RING})*[ \t]*\)"
_MULTIPOLYGON = re.compile(
    rf"MULTIPOLYGON[ \t]*\([ \t]*{_POLYGON}(?:[ \t]*,[ \t]*{_POLYGON})*[ \t]*\)\Z"
)
_RING_CONTENT = re.compile(r"\(([^()]*)\)")


def validate_slug(value: str) -> str:
    """Require a lower-kebab identifier for ingestion-owned primary keys."""
    if not _SLUG.fullmatch(value):
        raise ValueError("slug must be a lower-kebab identifier")
    return value


def validate_coordinates(lat: float, lng: float) -> tuple[float, float]:
    """Require finite WGS84 geographic coordinates."""
    if not math.isfinite(lat) or not -90 <= lat <= 90:
        raise ValueError("latitude must be finite and within -90..90")
    if not math.isfinite(lng) or not -180 <= lng <= 180:
        raise ValueError("longitude must be finite and within -180..180")
    return lat, lng


def validate_confidence(value: float) -> float:
    """Require source confidence in the inclusive unit interval."""
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("confidence must be finite and within 0..1")
    return value


def validate_cab_temporal_plausibility(days: str, start_time: time, end_time: time) -> None:
    """Reject CAB meetings without days or without a positive same-day duration."""
    if not days:
        raise ValueError("days must be present for a CAB meeting")
    if start_time >= end_time:
        raise ValueError("start_time must be before end_time for a CAB meeting")


def validate_multipolygon_wkt(value: str | None) -> str | None:
    """Allow only the plain MultiPolygon WKT representation used in NDJSON."""
    if value is None:
        return None
    if not _MULTIPOLYGON.fullmatch(value):
        raise ValueError("polygon must be plain MULTIPOLYGON(...) WKT")
    for ring in _RING_CONTENT.findall(value):
        coordinates = [
            tuple(float(component) for component in coordinate.split())
            for coordinate in ring.split(",")
        ]
        if coordinates[0] != coordinates[-1] or any(
            not math.isfinite(component) for coordinate in coordinates for component in coordinate
        ):
            raise ValueError("polygon must be plain MULTIPOLYGON(...) WKT")
    return value
