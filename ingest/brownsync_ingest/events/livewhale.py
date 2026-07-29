"""LiveWhale snapshot rows -> contract EventRows, poller-parity.

The app lane's TS poller (``services/poller/src/livewhale/``, read
read-only on ``main``) refreshes these seeds live post-deploy and upserts
on ``(source, source_id)``. Identity and every poller-owned field are
therefore derived IDENTICALLY to ``normalize.ts``:

- ``source_id = "{id}:{date_ts}"``; ``date_ts`` is exactly the Unix epoch
  of the feed's ``date_iso`` (verified 0 mismatches across the poller's
  1000-row recorded fixture), and the CSV's ``start_date_iso`` IS the
  feed's ``date_iso`` — so the epoch of ``start_date_iso`` reproduces the
  poller's ids byte-for-byte (pinned by the parity test).
- coordinates tolerate strings, treat 0 as the null-island sentinel, and
  null BOTH sides when either is missing;
- titles/locations/tags pass through the poller's ``decodeEntities`` +
  trim; ``rrule`` stays null (``repeats`` is prose, occurrences arrive
  pre-expanded); ``confidence`` is 1.0;
- category via the poller-ported tables in ``mappings/categories.py``;
- org attribution via the task-7 sidecar exactly as the poller's
  ``orgs.ts``: normalized group -> organization id, higher score wins,
  missing file -> empty map, malformed file -> loud failure.

Where the seed legitimately goes beyond the poller (non-identity fields):

- ``place_id`` is resolved through the task-5 gazetteer resolver when
  coordinates are ABSENT, location text exists, and the event is not
  ``online_type="Online only"`` (contract has no online column — the
  online fields ride along in ``raw``; an online-only event has no
  campus place, and resolving its blurb would be a guess);
- ``raw`` carries the CSV row (this bootstrap's actual source) minus the
  published-contact columns ``contact``/``contact_emails`` — the task-7
  precedent: no contract field consumes directory emails and publishing
  them into seeds is forbidden. The counts of dropped non-empty values
  are reported by the job.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Protocol

from brownsync_ingest.common.text import decode_entities
from brownsync_ingest.contract import EventRow
from brownsync_ingest.events.models import UpcomingEventRecord
from brownsync_ingest.gazetteer.resolver import Resolution
from brownsync_ingest.mappings.categories import (
    LIVEWHALE_EVENT_TYPE_CATEGORIES,
    LIVEWHALE_IGNORED_EVENT_TYPES,
    categorize_livewhale,
    livewhale_group_key,
)


# Every event_types value with an explicit mapping decision (topical or
# audience qualifier). Anything else is source drift, REPORTED by the job
# but categorized exactly as the poller would (fall-through — see
# mappings/categories.py for the documented deviation).
KNOWN_EVENT_TYPES: frozenset[str] = frozenset(
    event_type for event_type, _ in LIVEWHALE_EVENT_TYPE_CATEGORIES
) | LIVEWHALE_IGNORED_EVENT_TYPES


SOURCE = "livewhale"

ONLINE_ONLY = "Online only"
# The measured online_type vocabulary; place-resolution behavior depends
# on it, so an unknown value is collected by the job as a vocabulary gate
# failure (fail-closed) rather than guessed physical-or-virtual.
KNOWN_ONLINE_TYPES: frozenset[str] = frozenset({"", ONLINE_ONLY, "Hybrid"})

# Published directory contact data with no contract field: excluded from
# ``raw``, counted, reported — the task-7 precedent.
PUBLISHED_CONTACT_COLUMNS: tuple[str, ...] = ("contact", "contact_emails")

_LIST_SEPARATOR = " | "
_BOOLEANS = {"true": True, "false": False}


class UpcomingEventError(ValueError):
    """A snapshot row cannot be normalized without guessing."""


def _aware(value: str, *, field: str, event_id: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise UpcomingEventError(
            f"event {event_id}: unparseable {field} {value!r}"
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise UpcomingEventError(
            f"event {event_id}: {field} {value!r} has no UTC offset — the "
            "epoch (and therefore the poller-parity source_id) would depend "
            "on the local machine"
        )
    return parsed


def source_id_for(event_id: str, start_date_iso: str) -> str:
    """The poller's ``${id}:${date_ts}`` derived from the CSV columns."""
    start = _aware(start_date_iso, field="start_date_iso", event_id=event_id)
    return f"{event_id}:{int(start.timestamp())}"


def _boolean(value: str, *, field: str, event_id: str) -> bool:
    parsed = _BOOLEANS.get(value)
    if parsed is None:
        raise UpcomingEventError(
            f"event {event_id}: {field} must be true/false, got {value!r}"
        )
    return parsed


def _coordinate(value: str, low: float, high: float) -> float | None:
    """The poller's ``coord``: unparseable, out-of-range and the 0
    null-island sentinel all null (never raise — poller parity)."""
    text = value.strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if number != number or number == 0.0:  # NaN or sentinel
        return None
    return number if low <= number <= high else None


def _split_list(value: str) -> list[str]:
    return value.split(_LIST_SEPARATOR) if value else []


def _clean_optional(value: str) -> str | None:
    cleaned = decode_entities(value).strip()
    return cleaned or None


def load_org_livewhale_groups(path: Path | str) -> dict[str, str]:
    """The poller's ``loadOrgGroups``: sidecar -> normalized group lookup.

    Missing file -> empty map (org_id stays null, exactly like the
    poller before the sidecar lands); a present-but-malformed file
    raises so schema drift fails the run loudly instead of silently
    dropping attribution; when two mappings claim the same group the
    higher score wins.
    """
    path = Path(path)
    if not path.is_file():
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise UpcomingEventError(
            f"organization sidecar {path} is not schema v1"
        )
    mappings = document.get("mappings")
    if not isinstance(mappings, list):
        raise UpcomingEventError(
            f"organization sidecar {path} has no mappings array"
        )
    by_group: dict[str, str] = {}
    best_score: dict[str, float] = {}
    for entry in mappings:
        if not isinstance(entry, dict):
            raise UpcomingEventError(
                f"organization sidecar {path} has a non-object mapping"
            )
        try:
            organization_id = entry["organization_id"]
            livewhale_group = entry["livewhale_group"]
            score = float(entry["score"])
        except (KeyError, TypeError, ValueError) as exc:
            raise UpcomingEventError(
                f"organization sidecar {path} has a malformed mapping: {exc}"
            ) from exc
        key = livewhale_group_key(livewhale_group)
        current = best_score.get(key)
        if current is None or score > current:
            by_group[key] = organization_id
            best_score[key] = score
    return by_group


@dataclass(frozen=True)
class UpcomingDecision:
    """One normalized row plus everything the job reports about it."""

    row: EventRow
    resolution: Resolution | None  # None: coords present / online-only / blank
    org_attributed: bool
    unknown_event_types: tuple[str, ...]
    unknown_online_type: str | None
    dropped_contact_columns: tuple[str, ...]  # non-empty dropped columns


class SupportsResolve(Protocol):
    """Structural protocol: anything with ``resolve(str) -> Resolution``."""

    def resolve(self, value: str) -> Resolution: ...


def normalize_upcoming_event(
    record: UpcomingEventRecord,
    *,
    org_by_group: dict[str, str],
    resolver: SupportsResolve,
) -> UpcomingDecision:
    """One CSV row -> one contract EventRow plus its reported decisions."""
    event_id = record.event_id.strip()
    if not event_id:
        raise UpcomingEventError("a row has an empty event_id")

    start = _aware(
        record.start_date_iso, field="start_date_iso", event_id=event_id
    )
    end = (
        _aware(record.end_date_iso, field="end_date_iso", event_id=event_id)
        if record.end_date_iso.strip()
        else None
    )

    title = decode_entities(record.title).strip()
    if not title:
        raise UpcomingEventError(f"event {event_id}: empty title")

    lat = _coordinate(record.latitude, -90.0, 90.0)
    lng = _coordinate(record.longitude, -180.0, 180.0)
    if lat is None or lng is None:  # both-or-none, poller parity
        lat = None
        lng = None

    location_raw = _clean_optional(record.location)

    event_types = _split_list(record.event_types)
    unknown_event_types = tuple(
        sorted(
            {
                entry.strip()
                for entry in event_types
                if entry.strip() and entry.strip() not in KNOWN_EVENT_TYPES
            }
        )
    )

    unknown_online_type = (
        record.online_type
        if record.online_type not in KNOWN_ONLINE_TYPES
        else None
    )

    org_id = (
        org_by_group.get(livewhale_group_key(record.organizer))
        if record.organizer
        else None
    )

    resolution: Resolution | None = None
    place_id: str | None = None
    if (
        lat is None
        and location_raw is not None
        and record.online_type != ONLINE_ONLY
        and unknown_online_type is None
    ):
        resolution = resolver.resolve(location_raw)
        place_id = resolution.place_id

    tags = [
        cleaned
        for cleaned in (
            decode_entities(tag).strip() for tag in _split_list(record.tags)
        )
        if cleaned
    ]

    raw = {
        column: value
        for column, value in record.raw.items()
        if column not in PUBLISHED_CONTACT_COLUMNS
    }
    dropped = tuple(
        column
        for column in PUBLISHED_CONTACT_COLUMNS
        if record.raw.get(column, "").strip()
    )

    row = EventRow(
        source=SOURCE,
        source_id=f"{event_id}:{int(start.timestamp())}",
        title=title,
        description=None,  # the CSV carries no description column
        start_ts=start,
        end_ts=end,
        is_all_day=_boolean(record.all_day, field="all_day", event_id=event_id),
        rrule=None,  # feed `repeats` is prose; occurrences pre-expanded
        location_raw=location_raw,
        place_id=place_id,
        lat=lat,
        lng=lng,
        org_id=org_id,
        category=categorize_livewhale(event_types, record.organizer or None),
        tags=tags,
        url=record.source_url.strip() or None,
        cost=record.cost.strip() or None,
        confidence=1.0,
        is_canceled=_boolean(
            record.canceled, field="canceled", event_id=event_id
        ),
        raw=raw,
    )
    return UpcomingDecision(
        row=row,
        resolution=resolution,
        org_attributed=org_id is not None,
        unknown_event_types=unknown_event_types,
        unknown_online_type=unknown_online_type,
        dropped_contact_columns=dropped,
    )
