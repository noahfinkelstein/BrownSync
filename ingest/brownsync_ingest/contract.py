"""Pydantic representations of the BrownSync v1 database rows."""

from __future__ import annotations

from datetime import UTC, datetime, time
import math
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator


Category = Literal[
    "academic",
    "class",
    "club",
    "arts",
    "athletics",
    "food",
    "social",
    "career",
    "wellness",
    "admin",
]
PlaceKind = Literal[
    "academic",
    "residence",
    "dining",
    "athletic",
    "library",
    "admin",
    "outdoor",
    "other",
]
OrganizationKind = Literal["club", "department", "office", "athletics", "external"]
SourceRunStatus = Literal["ok", "error", "partial"]


def _validate_json_numbers(value: JsonValue | None) -> JsonValue | None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("raw JSON numbers must be finite")
    if isinstance(value, list):
        for item in value:
            _validate_json_numbers(item)
    elif isinstance(value, dict):
        for item in value.values():
            _validate_json_numbers(item)
    return value


class ContractRow(BaseModel):
    """Base for rows that may be written to a contract-shaped seed file."""

    model_config = ConfigDict(extra="forbid")


class PlaceRow(ContractRow):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    kind: PlaceKind
    lat: float
    lng: float
    polygon: str | None = None
    address: str | None = None
    osm_id: str | None = None
    source: str = "osm"


class OrganizationRow(ContractRow):
    id: str
    name: str
    kind: OrganizationKind
    category: Category | None = None
    description: str | None = None
    url: str | None = None
    instagram: str | None = None
    default_place_id: str | None = None
    source: str


class EventRow(ContractRow):
    id: UUID | None = None
    source: str
    source_id: str
    canonical_id: UUID | None = None
    title: str
    description: str | None = None
    start_ts: datetime
    end_ts: datetime | None = None
    is_all_day: bool = False
    rrule: str | None = None
    location_raw: str | None = None
    place_id: str | None = None
    lat: float | None = None
    lng: float | None = None
    org_id: str | None = None
    category: Category | None = None
    tags: list[str] = Field(default_factory=list)
    url: str | None = None
    cost: str | None = None
    confidence: float = 1.0
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    is_canceled: bool = False
    raw: JsonValue | None = None

    @field_validator("start_ts", "end_ts", "first_seen_at", "last_seen_at")
    @classmethod
    def normalize_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must be timezone-aware")
        return value.astimezone(UTC)

    @field_validator("raw")
    @classmethod
    def validate_raw_json_numbers(cls, value: JsonValue | None) -> JsonValue | None:
        return _validate_json_numbers(value)


class CourseMeetingRow(ContractRow):
    id: str
    srcdb: str
    crn: str
    course_code: str
    title: str
    instructor: str | None = None
    days: str
    start_time: time
    end_time: time
    location_raw: str | None = None
    place_id: str | None = None
    room: str | None = None
    enrollment: int | None = None
    raw: JsonValue | None = None

    @field_validator("days")
    @classmethod
    def validate_days(cls, value: str) -> str:
        tokens = ("M", "T", "W", "Th", "F", "S", "Su")
        longest_first = ("Th", "Su", "M", "T", "W", "F", "S")
        seen: set[str] = set()
        last_index = -1
        cursor = 0
        while cursor < len(value):
            token = next(
                (candidate for candidate in longest_first if value.startswith(candidate, cursor)),
                None,
            )
            if token is None:
                raise ValueError("days must use canonical weekday tokens")
            token_index = tokens.index(token)
            if token in seen or token_index <= last_index:
                raise ValueError("days must be non-empty, unique, and in canonical order")
            seen.add(token)
            last_index = token_index
            cursor += len(token)
        if not seen:
            raise ValueError("days must be non-empty, unique, and in canonical order")
        return value

    @field_validator("raw")
    @classmethod
    def validate_raw_json_numbers(cls, value: JsonValue | None) -> JsonValue | None:
        return _validate_json_numbers(value)


class SourceRunRow(ContractRow):
    id: int | None = None
    source: str
    started_at: datetime
    finished_at: datetime | None = None
    status: SourceRunStatus
    items_upserted: int | None = None
    error: str | None = None

    @field_validator("started_at", "finished_at")
    @classmethod
    def normalize_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must be timezone-aware")
        return value.astimezone(UTC)
