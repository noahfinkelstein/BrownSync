"""Default venue evidence for organizations (plan Task 7).

``organizations.default_place_id`` is awarded ONLY when an organization has
at least :data:`MIN_OBSERVATIONS` resolved venue observations and the
winning venue holds at least :data:`MIN_SHARE` of them. Observations are
(organizer x location) pairs from the user-provided LiveWhale events
snapshot; online events and events without a location are skipped with
counts, locations resolve through the Task 5 resolver exactly as shipped,
and an observation attaches to an organization only through its ACCEPTED
LiveWhale group link — an unlinked organization can never accrue evidence.
"""

from __future__ import annotations

import csv
import html
from collections import Counter
from pathlib import Path
from typing import Mapping, Protocol

from brownsync_ingest.clubs.models import (
    DefaultPlaceEvidence,
    EventObservation,
    LinkDecision,
)
from brownsync_ingest.gazetteer.aliases import normalize_alias
from brownsync_ingest.gazetteer.resolver import Resolution


MIN_OBSERVATIONS = 3
MIN_SHARE = 0.75

_REQUIRED_COLUMNS = ("organizer", "location", "online")

SKIP_ONLINE = "online"
SKIP_NO_LOCATION = "no-location"


class EventsCsvError(ValueError):
    """The events snapshot does not have the expected structure."""


class SupportsResolve(Protocol):
    def resolve(self, value: str) -> Resolution: ...


def load_event_observations(
    path: Path | str,
) -> tuple[tuple[EventObservation, ...], dict[str, int]]:
    """Physical (organizer x location) observations plus skip counts."""
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames or []
        missing = [column for column in _REQUIRED_COLUMNS if column not in header]
        if missing:
            raise EventsCsvError(
                f"events snapshot is missing required column(s): {', '.join(missing)}"
            )
        observations: list[EventObservation] = []
        skipped: Counter[str] = Counter()
        for row in reader:
            if (row.get("online") or "").strip() == "true":
                skipped[SKIP_ONLINE] += 1
                continue
            location = (row.get("location") or "").strip()
            if not location:
                skipped[SKIP_NO_LOCATION] += 1
                continue
            observations.append(
                EventObservation(
                    organizer=html.unescape((row.get("organizer") or "").strip()),
                    location=location,
                )
            )
    return tuple(observations), dict(skipped)


def compute_default_places(
    decisions: tuple[LinkDecision, ...],
    observations: tuple[EventObservation, ...],
    resolver: SupportsResolve,
    *,
    min_observations: int = MIN_OBSERVATIONS,
    min_share: float = MIN_SHARE,
) -> Mapping[str, DefaultPlaceEvidence]:
    """Per-linked-organization venue evidence; award only past both gates."""
    linked = [decision for decision in decisions if decision.method is not None]
    organization_by_group: dict[str, str] = {}
    for decision in linked:
        assert decision.livewhale_group is not None  # LinkDecision invariant
        organization_by_group[normalize_alias(decision.livewhale_group)] = (
            decision.organization_id
        )

    resolved_cache: dict[str, Resolution] = {}
    place_counts: dict[str, Counter[str]] = {
        decision.organization_id: Counter() for decision in linked
    }
    for observation in observations:
        try:
            organizer_key = normalize_alias(observation.organizer)
        except ValueError:
            continue  # an organizer that normalizes to nothing matches no group
        organization_id = organization_by_group.get(organizer_key)
        if organization_id is None:
            continue
        if observation.location not in resolved_cache:
            resolved_cache[observation.location] = resolver.resolve(observation.location)
        resolution = resolved_cache[observation.location]
        if resolution.place_id is None:
            continue  # unresolved locations are never observations
        place_counts[organization_id][resolution.place_id] += 1

    evidence: dict[str, DefaultPlaceEvidence] = {}
    for decision in linked:
        counts = place_counts[decision.organization_id]
        total = sum(counts.values())
        if counts:
            winner_place_id, winner_count = counts.most_common(1)[0]
            share = winner_count / total
        else:
            winner_place_id, winner_count, share = None, 0, None
        awarded = (
            total >= min_observations and share is not None and share >= min_share
        )
        evidence[decision.organization_id] = DefaultPlaceEvidence(
            organization_id=decision.organization_id,
            observations=total,
            winner_place_id=winner_place_id if awarded or counts else None,
            winner_count=winner_count,
            share=share,
            awarded=awarded,
        )
    return evidence
