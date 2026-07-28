from __future__ import annotations

from datetime import UTC, datetime, time, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from brownsync_ingest.contract import (
    CourseMeetingRow,
    EventRow,
    OrganizationRow,
    PlaceRow,
    SourceRunRow,
)


def place_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": "barus-holley",
        "name": "Barus & Holley",
        "kind": "academic",
        "lat": 41.826,
        "lng": -71.405,
    }
    payload.update(overrides)
    return payload


def organization_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": "brown-outing-club",
        "name": "Brown Outing Club",
        "kind": "club",
        "source": "clubs",
    }
    payload.update(overrides)
    return payload


def event_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "source": "livewhale",
        "source_id": "event-42",
        "title": "Colloquium",
        "start_ts": datetime(2026, 9, 1, 15, tzinfo=timezone(timedelta(hours=-4))),
    }
    payload.update(overrides)
    return payload


def course_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": "202610-12345-0",
        "srcdb": "202610",
        "crn": "12345",
        "course_code": "CSCI 0150",
        "title": "Introduction to Object-Oriented Programming",
        "days": "TTh",
        "start_time": time(10, 0),
        "end_time": time(11, 20),
    }
    payload.update(overrides)
    return payload


def source_run_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "source": "cab",
        "started_at": datetime(2026, 9, 1, 9, tzinfo=UTC),
        "status": "ok",
    }
    payload.update(overrides)
    return payload


def test_place_row_mirrors_contract_fields_and_defaults() -> None:
    place = PlaceRow(**place_payload())

    assert place.model_dump() == {
        "id": "barus-holley",
        "name": "Barus & Holley",
        "aliases": [],
        "kind": "academic",
        "lat": 41.826,
        "lng": -71.405,
        "polygon": None,
        "address": None,
        "osm_id": None,
        "source": "osm",
    }
    assert PlaceRow(**place_payload()).aliases is not place.aliases


def test_organization_row_mirrors_contract_fields_and_has_no_raw_field() -> None:
    organization = OrganizationRow(**organization_payload())

    assert organization.model_dump() == {
        "id": "brown-outing-club",
        "name": "Brown Outing Club",
        "kind": "club",
        "category": None,
        "description": None,
        "url": None,
        "instagram": None,
        "default_place_id": None,
        "source": "clubs",
    }
    with pytest.raises(ValidationError, match="raw"):
        OrganizationRow(**organization_payload(raw={"unexpected": True}))


def test_event_row_mirrors_contract_defaults_and_omits_database_defaults() -> None:
    event = EventRow(**event_payload())

    assert event.id is None
    assert event.first_seen_at is None
    assert event.last_seen_at is None
    assert event.model_dump(exclude_none=True) == {
        "source": "livewhale",
        "source_id": "event-42",
        "title": "Colloquium",
        "start_ts": datetime(2026, 9, 1, 19, tzinfo=UTC),
        "is_all_day": False,
        "tags": [],
        "confidence": 1.0,
        "is_canceled": False,
    }
    assert EventRow(**event_payload()).tags is not event.tags


def test_event_row_preserves_optional_contract_fields_and_json_safe_raw_values() -> None:
    event_id = uuid4()
    canonical_id = uuid4()
    event = EventRow(
        **event_payload(
            id=event_id,
            canonical_id=canonical_id,
            description="Talk",
            end_ts=datetime(2026, 9, 1, 16, tzinfo=UTC),
            is_all_day=True,
            rrule="FREQ=WEEKLY",
            location_raw="Salomon Center",
            place_id="salomon-center",
            lat=41.827,
            lng=-71.403,
            org_id="cs-department",
            category="academic",
            tags=["cs"],
            url="https://events.brown.edu/e/42",
            cost="Free",
            confidence=0.7,
            first_seen_at=datetime(2026, 9, 1, 18, tzinfo=UTC),
            last_seen_at=datetime(2026, 9, 1, 19, tzinfo=UTC),
            is_canceled=True,
            raw={"nested": [True, {"value": 1.5}]},
        )
    )

    dumped = event.model_dump(mode="json")
    assert dumped["id"] == str(event_id)
    assert dumped["canonical_id"] == str(canonical_id)
    assert dumped["start_ts"] == "2026-09-01T19:00:00Z"
    assert dumped["raw"] == {"nested": [True, {"value": 1.5}]}
    with pytest.raises(ValidationError, match="raw"):
        EventRow(**event_payload(raw={"not_json": b"bytes"}))


@pytest.mark.parametrize("non_finite", [float("nan"), float("inf"), float("-inf")])
def test_raw_json_rejects_non_finite_numbers_recursively(non_finite: float) -> None:
    with pytest.raises(ValidationError, match="finite"):
        EventRow(**event_payload(raw={"nested": [non_finite]}))
    with pytest.raises(ValidationError, match="finite"):
        CourseMeetingRow(**course_payload(raw={"nested": [non_finite]}))


def test_event_and_source_run_normalize_aware_datetimes_and_reject_naive_values() -> None:
    event = EventRow(**event_payload())
    run = SourceRunRow(
        **source_run_payload(
            started_at=datetime(2026, 9, 1, 5, tzinfo=timezone(timedelta(hours=-4))),
            finished_at=datetime(2026, 9, 1, 6, tzinfo=timezone(timedelta(hours=-4))),
        )
    )

    assert event.start_ts.tzinfo is UTC
    assert run.started_at == datetime(2026, 9, 1, 9, tzinfo=UTC)
    assert run.finished_at == datetime(2026, 9, 1, 10, tzinfo=UTC)
    with pytest.raises(ValidationError, match="timezone-aware"):
        EventRow(**event_payload(start_ts=datetime(2026, 9, 1, 9)))
    with pytest.raises(ValidationError, match="timezone-aware"):
        SourceRunRow(**source_run_payload(started_at=datetime(2026, 9, 1, 9)))


def test_course_meeting_row_mirrors_contract_fields_defaults_and_json_serialization() -> None:
    row = CourseMeetingRow(
        **course_payload(
            instructor="Ada Lovelace",
            location_raw="Salomon Center 101",
            place_id="salomon-center",
            room="101",
            enrollment=120,
            raw={"meeting_html": "<span>...</span>"},
        )
    )

    assert row.model_dump(mode="json")["start_time"] == "10:00:00"
    assert row.model_dump()["instructor"] == "Ada Lovelace"
    assert CourseMeetingRow(**course_payload()).model_dump() == {
        "id": "202610-12345-0",
        "srcdb": "202610",
        "crn": "12345",
        "course_code": "CSCI 0150",
        "title": "Introduction to Object-Oriented Programming",
        "instructor": None,
        "days": "TTh",
        "start_time": time(10, 0),
        "end_time": time(11, 20),
        "location_raw": None,
        "place_id": None,
        "room": None,
        "enrollment": None,
        "raw": None,
    }


@pytest.mark.parametrize("days", ["", "MM", "TM", "MThT", "ThT", "MTSuTh"])
def test_course_meeting_rejects_empty_duplicate_or_out_of_order_days(days: str) -> None:
    with pytest.raises(ValidationError, match="days"):
        CourseMeetingRow(**course_payload(days=days))


@pytest.mark.parametrize("days", ["M", "MWF", "TTh", "MTTh", "Su", "MTWThFSu"])
def test_course_meeting_accepts_canonical_day_tokens(days: str) -> None:
    assert CourseMeetingRow(**course_payload(days=days)).days == days


def test_source_run_row_mirrors_contract_fields_defaults_and_status_literals() -> None:
    row = SourceRunRow(**source_run_payload())

    assert row.model_dump() == {
        "id": None,
        "source": "cab",
        "started_at": datetime(2026, 9, 1, 9, tzinfo=UTC),
        "finished_at": None,
        "status": "ok",
        "items_upserted": None,
        "error": None,
    }
    for status in ("ok", "error", "partial"):
        assert SourceRunRow(**source_run_payload(status=status)).status == status
    with pytest.raises(ValidationError):
        SourceRunRow(**source_run_payload(status="pending"))


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (PlaceRow, place_payload(extra="nope")),
        (OrganizationRow, organization_payload(extra="nope")),
        (EventRow, event_payload(extra="nope")),
        (CourseMeetingRow, course_payload(extra="nope")),
        (SourceRunRow, source_run_payload(extra="nope")),
    ],
)
def test_every_contract_row_forbids_unknown_fields(
    model: type[PlaceRow | OrganizationRow | EventRow | CourseMeetingRow | SourceRunRow],
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError, match="extra"):
        model(**payload)


@pytest.mark.parametrize(
    ("model", "payload", "field"),
    [
        (PlaceRow, place_payload(kind="campus"), "kind"),
        (OrganizationRow, organization_payload(kind="society"), "kind"),
        (EventRow, event_payload(category="campus"), "category"),
    ],
)
def test_fixed_contract_literals_are_enforced(
    model: type[PlaceRow | OrganizationRow | EventRow],
    payload: dict[str, object],
    field: str,
) -> None:
    with pytest.raises(ValidationError, match=field):
        model(**payload)
