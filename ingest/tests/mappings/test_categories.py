"""Source-native club vocabularies -> contract section 4 taxonomy.

The clubs directory export carries three categorical columns and NONE of
them is thematic: ``funding_category`` is a UFB funding tier / governance
status, ``tags`` is a recognition status, and ``group_type`` distinguishes
the undergraduate from the graduate directory. The mapping is therefore
exhaustive-and-explicit: every KNOWN value maps to ``category=None`` with a
machine-readable reason (never a guess from names or descriptions), and
every UNKNOWN value raises so the job fails closed instead of nulling
silently through source drift.
"""

from __future__ import annotations

import pytest

from brownsync_ingest.mappings.categories import (
    CategoryDecision,
    FUNDING_CATEGORY_REASONS,
    KIND_BY_GROUP_TYPE,
    TAG_REASONS,
    UnmappedSourceValueError,
    map_club_category,
    map_club_kind,
)
from brownsync_ingest.contract import OrganizationRow


class TestKindMapping:
    def test_both_directory_group_types_are_clubs(self) -> None:
        assert map_club_kind("Undergraduate student group") == "club"
        assert map_club_kind("Graduate student group") == "club"

    def test_the_vocabulary_is_exactly_the_two_measured_values(self) -> None:
        assert set(KIND_BY_GROUP_TYPE) == {
            "Undergraduate student group",
            "Graduate student group",
        }

    def test_unknown_group_type_raises_instead_of_guessing(self) -> None:
        with pytest.raises(UnmappedSourceValueError) as excinfo:
            map_club_kind("Faculty reading circle")
        assert "group_type" in str(excinfo.value)
        assert "Faculty reading circle" in str(excinfo.value)

    def test_mapped_kind_is_contract_valid(self) -> None:
        row = OrganizationRow(
            id="x", name="X", kind=map_club_kind("Graduate student group"), source="gsc"
        )
        assert row.kind == "club"


class TestCategoryMapping:
    def test_funding_vocabulary_is_exactly_the_measured_values(self) -> None:
        assert set(FUNDING_CATEGORY_REASONS) == {
            "Category 1",
            "Category 2",
            "Student Governance",
            "",
        }

    def test_tag_vocabulary_is_exactly_the_measured_values(self) -> None:
        assert set(TAG_REASONS) == {
            "UCS Recognized Undergrad Student Groups",
            "Graduate Student Council recognized group",
        }

    @pytest.mark.parametrize(
        ("funding", "tag"),
        [
            ("Category 1", "UCS Recognized Undergrad Student Groups"),
            ("Category 2", "UCS Recognized Undergrad Student Groups"),
            ("Student Governance", "UCS Recognized Undergrad Student Groups"),
            ("", "Graduate Student Council recognized group"),
        ],
    )
    def test_every_known_combination_maps_to_null_with_reasons(
        self, funding: str, tag: str
    ) -> None:
        decision = map_club_category(funding_category=funding, tags=tag)
        assert isinstance(decision, CategoryDecision)
        assert decision.category is None
        assert decision.reasons, "an unmapped category must say why"
        for reason in decision.reasons:
            assert isinstance(reason, str) and reason

    def test_funding_tiers_explain_they_are_not_thematic(self) -> None:
        decision = map_club_category(
            funding_category="Category 2", tags="UCS Recognized Undergrad Student Groups"
        )
        assert "funding-tier-not-thematic" in decision.reasons
        assert "recognition-tag-not-thematic" in decision.reasons

    def test_governance_is_not_guessed_into_admin(self) -> None:
        decision = map_club_category(
            funding_category="Student Governance",
            tags="UCS Recognized Undergrad Student Groups",
        )
        assert decision.category is None
        assert "governance-status-not-thematic" in decision.reasons

    def test_empty_funding_reports_absence(self) -> None:
        decision = map_club_category(
            funding_category="", tags="Graduate Student Council recognized group"
        )
        assert decision.category is None
        assert "no-source-category" in decision.reasons

    def test_unknown_funding_category_raises(self) -> None:
        with pytest.raises(UnmappedSourceValueError) as excinfo:
            map_club_category(
                funding_category="Category 3",
                tags="UCS Recognized Undergrad Student Groups",
            )
        assert "funding_category" in str(excinfo.value)
        assert "Category 3" in str(excinfo.value)

    def test_unknown_tag_raises(self) -> None:
        with pytest.raises(UnmappedSourceValueError) as excinfo:
            map_club_category(funding_category="Category 1", tags="Club Sports")
        assert "tags" in str(excinfo.value)
        assert "Club Sports" in str(excinfo.value)

    def test_null_category_is_contract_valid(self) -> None:
        decision = map_club_category(
            funding_category="Category 1",
            tags="UCS Recognized Undergrad Student Groups",
        )
        row = OrganizationRow(
            id="x", name="X", kind="club", category=decision.category, source="studentactivities"
        )
        assert row.category is None
