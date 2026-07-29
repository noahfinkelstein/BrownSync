"""Default venue evidence: organizer x location observations, gated hard.

Plan rule: ``default_place_id`` requires at least three RESOLVED venue
observations for the organization and the winning venue must hold at least
75% of them. Observations come from the user-provided LiveWhale events
snapshot (``brown_upcoming_events.csv``) and attach to an organization only
through its accepted LiveWhale group link.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from brownsync_ingest.clubs.default_place import (
    MIN_OBSERVATIONS,
    MIN_SHARE,
    EventsCsvError,
    compute_default_places,
    load_event_observations,
)
from brownsync_ingest.clubs.models import EventObservation, LinkDecision
from brownsync_ingest.gazetteer.resolver import Resolution

INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_EVENTS = INGEST_ROOT / "fixtures" / "user_provided" / "brown_upcoming_events.csv"

HEADER = "event_id,title,organizer,location,online"


def events_file(tmp_path: Path, *rows: str, header: str = HEADER) -> Path:
    path = tmp_path / "events.csv"
    path.write_text("﻿" + header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


class StubResolver:
    """Duck-typed resolver: known strings resolve, everything else does not."""

    def __init__(self, known: dict[str, str]) -> None:
        self.known = known
        self.calls: list[str] = []

    def resolve(self, value: str) -> Resolution:
        self.calls.append(value)
        place_id = self.known.get(value)
        return Resolution(
            query=value,
            place_id=place_id,
            room=None,
            method="exact" if place_id else "unresolved",
            reason=None if place_id else "below-threshold",
            score=None,
            candidates=(),
        )


def linked(org_id: str, group: str) -> LinkDecision:
    return LinkDecision(
        organization_id=org_id, club_name=org_id, method="exact",
        livewhale_group=group, score=100.0, reason=None,
        best_group=group, best_score=100.0,
        runner_up_group=None, runner_up_score=None,
    )


def unlinked(org_id: str) -> LinkDecision:
    return LinkDecision(
        organization_id=org_id, club_name=org_id, method=None,
        livewhale_group=None, score=None, reason="below-threshold",
        best_group=None, best_score=None,
        runner_up_group=None, runner_up_score=None,
    )


class TestLoading:
    def test_online_and_locationless_events_are_skipped_with_counts(
        self, tmp_path: Path
    ) -> None:
        observations, skipped = load_event_observations(
            events_file(
                tmp_path,
                "1,A,Group,Sayles Hall,false",
                "2,B,Group,,false",
                "3,C,Group,Anywhere,true",
                "4,D,Group,Sayles Hall,false",
            )
        )
        assert observations == (
            EventObservation(organizer="Group", location="Sayles Hall"),
            EventObservation(organizer="Group", location="Sayles Hall"),
        )
        assert skipped == {"online": 1, "no-location": 1}

    def test_organizers_are_html_unescaped(self, tmp_path: Path) -> None:
        observations, _ = load_event_observations(
            events_file(tmp_path, "1,A,Alumni &amp; Friends,Sayles Hall,false")
        )
        assert observations[0].organizer == "Alumni & Friends"

    def test_missing_required_column_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(EventsCsvError) as excinfo:
            load_event_observations(
                events_file(tmp_path, "1,A,Group,false", header="event_id,title,organizer,online")
            )
        assert "location" in str(excinfo.value)

    def test_the_real_snapshot_loads_with_the_measured_counts(self) -> None:
        observations, skipped = load_event_observations(REAL_EVENTS)
        assert skipped == {"online": 179, "no-location": 108}
        assert len(observations) == 1000 - 179 - 108
        assert len({o.organizer for o in observations}) <= 68


class TestDefaultPlaces:
    def test_thresholds_are_the_plan_values(self) -> None:
        assert MIN_OBSERVATIONS == 3
        assert MIN_SHARE == 0.75

    def test_observations_attach_only_through_the_linked_group(self) -> None:
        resolver = StubResolver({"Sayles Hall": "sayles-hall"})
        observations = tuple(
            EventObservation(organizer="Alpha Office", location="Sayles Hall")
            for _ in range(3)
        ) + (EventObservation(organizer="Beta Office", location="Sayles Hall"),)
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"), unlinked("gamma")),
            observations,
            resolver,
        )
        assert set(evidence) == {"alpha"}
        alpha = evidence["alpha"]
        assert alpha.observations == 3
        assert alpha.winner_place_id == "sayles-hall"
        assert alpha.awarded is True

    def test_organizer_matching_is_normalized(self) -> None:
        resolver = StubResolver({"Sayles Hall": "sayles-hall"})
        observations = tuple(
            EventObservation(organizer="ALPHA office!", location="Sayles Hall")
            for _ in range(3)
        )
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"),), observations, resolver
        )
        assert evidence["alpha"].awarded is True

    def test_two_observations_are_not_enough(self) -> None:
        resolver = StubResolver({"Sayles Hall": "sayles-hall"})
        observations = tuple(
            EventObservation(organizer="Alpha Office", location="Sayles Hall")
            for _ in range(2)
        )
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"),), observations, resolver
        )
        alpha = evidence["alpha"]
        assert alpha.observations == 2
        assert alpha.awarded is False

    def test_unresolved_locations_are_not_observations(self) -> None:
        resolver = StubResolver({"Sayles Hall": "sayles-hall"})
        observations = (
            EventObservation(organizer="Alpha Office", location="Sayles Hall"),
            EventObservation(organizer="Alpha Office", location="Narnia"),
            EventObservation(organizer="Alpha Office", location="Narnia"),
        )
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"),), observations, resolver
        )
        assert evidence["alpha"].observations == 1
        assert evidence["alpha"].awarded is False

    def test_exact_75_percent_share_is_awarded(self) -> None:
        resolver = StubResolver(
            {"Sayles Hall": "sayles-hall", "Salomon Center": "salomon-center"}
        )
        observations = tuple(
            EventObservation(organizer="Alpha Office", location="Sayles Hall")
            for _ in range(3)
        ) + (EventObservation(organizer="Alpha Office", location="Salomon Center"),)
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"),), observations, resolver
        )
        alpha = evidence["alpha"]
        assert alpha.observations == 4
        assert alpha.winner_count == 3
        assert alpha.share == pytest.approx(0.75)
        assert alpha.awarded is True

    def test_below_75_percent_share_is_refused(self) -> None:
        resolver = StubResolver(
            {"Sayles Hall": "sayles-hall", "Salomon Center": "salomon-center"}
        )
        observations = tuple(
            EventObservation(organizer="Alpha Office", location="Sayles Hall")
            for _ in range(3)
        ) + tuple(
            EventObservation(organizer="Alpha Office", location="Salomon Center")
            for _ in range(2)
        )
        evidence = compute_default_places(
            (linked("alpha", "Alpha Office"),), observations, resolver
        )
        alpha = evidence["alpha"]
        assert alpha.observations == 5
        assert alpha.share == pytest.approx(0.6)
        assert alpha.awarded is False

    def test_each_distinct_location_resolves_once(self) -> None:
        resolver = StubResolver({"Sayles Hall": "sayles-hall"})
        observations = tuple(
            EventObservation(organizer="Alpha Office", location="Sayles Hall")
            for _ in range(5)
        )
        compute_default_places((linked("alpha", "Alpha Office"),), observations, resolver)
        assert resolver.calls == ["Sayles Hall"]
