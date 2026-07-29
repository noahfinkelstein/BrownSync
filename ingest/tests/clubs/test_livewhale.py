"""Organization -> LiveWhale group linkage and the schema-v1 sidecar.

Acceptance per the plan: exact normalized match first, then RapidFuzz
``token_set_ratio >= 92`` with runner-up margin ``>= 5``; ambiguous -> no
link, reported. One fail-closed guard is added on top (Task 7 brief):
``token_set_ratio`` scores a strict token-subset at 100, so without it
"College Hill Irish Music Ensemble" would link to the Music DEPARTMENT.
A candidate whose significant tokens (filler dropped) are a strict subset
either way is rejected with reason ``degenerate-subset`` — the guard can
only reject, never accept, relative to the plan rule.
"""

from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path

import pytest

from brownsync_ingest.clubs.livewhale import (
    FILLER_TOKENS,
    RUNNER_UP_MARGIN,
    TOKEN_SET_THRESHOLD,
    LivewhaleGroupsError,
    build_organization_sidecar,
    link_club,
    load_livewhale_groups,
    significant_tokens,
)
from brownsync_ingest.clubs.models import LinkDecision

INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_GROUPS = INGEST_ROOT / "fixtures" / "recorded" / "livewhale" / "groups.json"


def groups_file(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "groups.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def group(identifier: int, title: str) -> dict[str, object]:
    return {
        "id": identifier,
        "title": title,
        "fullname": title,
        "web_address": f"https://events.brown.edu/{identifier}/",
        "timezone": "America/New_York",
    }


class TestLoading:
    def test_titles_are_html_unescaped(self, tmp_path: Path) -> None:
        groups = load_livewhale_groups(
            groups_file(tmp_path, [group(186, "Alumni &amp; Friends")])
        )
        assert groups[0].title == "Alumni & Friends"
        assert groups[0].id == 186

    def test_missing_required_field_is_refused(self, tmp_path: Path) -> None:
        payload = [{"id": 1, "title": "X"}]
        with pytest.raises(LivewhaleGroupsError):
            load_livewhale_groups(groups_file(tmp_path, payload))

    def test_non_list_document_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(LivewhaleGroupsError):
            load_livewhale_groups(groups_file(tmp_path, {"data": []}))

    def test_the_recorded_fixture_loads_all_218_groups(self) -> None:
        groups = load_livewhale_groups(REAL_GROUPS)
        assert len(groups) == 218
        titles = {entry.title for entry in groups}
        assert "Alumni & Friends" in titles  # &amp; unescaped
        assert "Academic Calendar" in titles


class TestSignificantTokens:
    def test_filler_tokens_are_dropped(self) -> None:
        assert significant_tokens("Brown Outing Club") == frozenset({"outing", "club"})
        assert "brown" in FILLER_TOKENS and "university" in FILLER_TOKENS

    def test_normalization_matches_alias_rules(self) -> None:
        assert significant_tokens("Alumni &amp; Friends".replace("&amp;", "&")) == frozenset(
            {"alumni", "friends"}
        )


def decide(name: str, titles: list[str]) -> LinkDecision:
    return link_club("org-slug", name, tuple(titles))


class TestLinkage:
    def test_exact_normalized_match_wins_first(self) -> None:
        decision = decide("Outing Club, Brown!", ["outing club brown", "Outing Club"])
        assert decision.method == "exact"
        assert decision.livewhale_group == "outing club brown"
        assert decision.score == 100.0
        assert decision.reason is None

    def test_fuzzy_accepts_reordered_full_match_with_filler(self) -> None:
        decision = decide("Brown Outing Club", ["Outing Club", "Sailing Team"])
        assert decision.method == "fuzzy"
        assert decision.livewhale_group == "Outing Club"
        assert decision.score is not None and decision.score >= TOKEN_SET_THRESHOLD

    def test_below_threshold_is_no_link(self) -> None:
        decision = decide("Chess Club", ["Physics", "History"])
        assert decision.method is None
        assert decision.reason == "below-threshold"
        assert decision.livewhale_group is None

    def test_margin_ambiguity_is_no_link_and_reports_both(self) -> None:
        # the real SIAM case: both containments score 100
        decision = decide(
            "Society for Industrial and Applied Mathematics Student Chapter (SIAM)",
            ["Mathematics", "Applied Mathematics"],
        )
        assert decision.method is None
        assert decision.reason == "ambiguous-margin"
        assert decision.best_score == 100.0
        assert decision.runner_up_score == 100.0
        assert RUNNER_UP_MARGIN == 5.0

    @pytest.mark.parametrize(
        ("club", "trap"),
        [
            ("College Hill Irish Music Ensemble", "Music"),
            ("Association for Women in Mathematics", "Mathematics"),
            ("Journal of Philosophy, Politics & Economics, Brown", "Economics"),
            ("Visual Art Appreciation", "Visual Art"),
        ],
    )
    def test_strict_subset_traps_are_rejected_not_linked(self, club: str, trap: str) -> None:
        decision = decide(club, [trap, "Completely Unrelated Office"])
        assert decision.method is None
        assert decision.reason == "degenerate-subset"
        assert decision.best_group == trap  # reported for human review
        assert decision.best_score == 100.0

    def test_reverse_subset_is_rejected_too(self) -> None:
        decision = decide("Sailing", ["Sailing Team Office", "History"])
        if decision.method is not None:  # only guard-rejection is acceptable
            pytest.fail("club tokens strictly inside group tokens must not link")
        assert decision.reason in {"degenerate-subset", "below-threshold"}

    def test_equal_significant_sets_are_not_degenerate(self) -> None:
        # filler differs on BOTH sides; significant sets are equal -> accepted
        decision = decide(
            "Brown Outing Club", ["The Outing Club of Brown University", "History"]
        )
        assert decision.method == "fuzzy"
        assert decision.livewhale_group == "The Outing Club of Brown University"

    def test_single_candidate_universe_has_no_runner_up(self) -> None:
        decision = decide("Brown Outing Club", ["Outing Club"])
        assert decision.method == "fuzzy"
        assert decision.runner_up_group is None


class TestRealGroupsRegression:
    """The measured Task 7 outcome against the 218 recorded groups."""

    @pytest.fixture(scope="class")
    def titles(self) -> tuple[str, ...]:
        return tuple(entry.title for entry in load_livewhale_groups(REAL_GROUPS))

    def test_no_student_group_is_a_livewhale_publisher(self, titles: tuple[str, ...]) -> None:
        from brownsync_ingest.clubs.csv_source import load_clubs_csv

        records, _ = load_clubs_csv(
            INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"
        )
        outcomes: dict[str | None, int] = {}
        reasons: dict[str, int] = {}
        for record in records:
            decision = link_club("x", record.name, titles)
            outcomes[decision.method] = outcomes.get(decision.method, 0) + 1
            if decision.reason is not None:
                reasons[decision.reason] = reasons.get(decision.reason, 0) + 1
        assert outcomes == {None: 457}
        assert reasons == {
            "below-threshold": 445,
            "ambiguous-margin": 1,
            "degenerate-subset": 11,
        }


class TestSidecar:
    def test_schema_v1_shape_and_sorting(self) -> None:
        decisions = (
            LinkDecision(
                organization_id="zeta", club_name="Zeta", method="fuzzy",
                livewhale_group="Zeta Office", score=95.0, reason=None,
                best_group="Zeta Office", best_score=95.0,
                runner_up_group=None, runner_up_score=None,
            ),
            LinkDecision(
                organization_id="alpha", club_name="Alpha", method="exact",
                livewhale_group="Alpha", score=100.0, reason=None,
                best_group="Alpha", best_score=100.0,
                runner_up_group=None, runner_up_score=None,
            ),
            LinkDecision(
                organization_id="omitted", club_name="Omitted", method=None,
                livewhale_group=None, score=None, reason="below-threshold",
                best_group="Whatever", best_score=10.0,
                runner_up_group=None, runner_up_score=None,
            ),
        )
        moment = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
        document = build_organization_sidecar(decisions, generated_at=moment)
        assert set(document) == {"schema_version", "generated_at", "mappings"}
        assert document["schema_version"] == 1
        assert document["generated_at"] == "2026-07-29T12:00:00Z"
        assert document["mappings"] == [
            {
                "organization_id": "alpha",
                "livewhale_group": "Alpha",
                "match_method": "exact",
                "score": 100.0,
            },
            {
                "organization_id": "zeta",
                "livewhale_group": "Zeta Office",
                "match_method": "fuzzy",
                "score": 95.0,
            },
        ]

    def test_empty_mappings_document_is_valid_and_explicit(self) -> None:
        document = build_organization_sidecar((), generated_at=datetime.now(UTC))
        assert document["schema_version"] == 1
        assert document["mappings"] == []

    def test_naive_generated_at_is_refused(self) -> None:
        with pytest.raises(ValueError):
            build_organization_sidecar((), generated_at=datetime(2026, 7, 29))

    def test_scores_stay_in_the_contract_bounds(self) -> None:
        decision = LinkDecision(
            organization_id="a", club_name="A", method="fuzzy",
            livewhale_group="A Office", score=92.5, reason=None,
            best_group="A Office", best_score=92.5,
            runner_up_group=None, runner_up_score=None,
        )
        document = build_organization_sidecar((decision,), generated_at=datetime.now(UTC))
        (mapping,) = document["mappings"]
        assert 0 <= mapping["score"] <= 100
        assert mapping["match_method"] in {"exact", "fuzzy"}
