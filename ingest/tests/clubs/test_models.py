"""LinkDecision carries exactly one of (link, reason) — enforced invariants."""

from __future__ import annotations

import pytest

from brownsync_ingest.clubs.models import LinkDecision


def build(**overrides: object) -> LinkDecision:
    payload: dict[str, object] = dict(
        organization_id="org", club_name="Org", method="exact",
        livewhale_group="Org", score=100.0, reason=None,
        best_group="Org", best_score=100.0,
        runner_up_group=None, runner_up_score=None,
    )
    payload.update(overrides)
    return LinkDecision(**payload)  # type: ignore[arg-type]


def test_a_linked_decision_must_carry_group_and_score_and_no_reason() -> None:
    with pytest.raises(ValueError):
        build(livewhale_group=None)
    with pytest.raises(ValueError):
        build(score=None)
    with pytest.raises(ValueError):
        build(reason="below-threshold")


def test_an_unlinked_decision_must_carry_a_reason_and_nothing_else() -> None:
    with pytest.raises(ValueError):
        build(method=None, livewhale_group=None, score=None, reason=None)
    with pytest.raises(ValueError):
        build(method=None, score=None, reason="below-threshold")  # group left set
    with pytest.raises(ValueError):
        build(method=None, livewhale_group=None, reason="below-threshold")  # score set
    decision = build(method=None, livewhale_group=None, score=None, reason="below-threshold")
    assert decision.reason == "below-threshold"
