"""Club-directory vocabularies -> DATA_CONTRACT.md section 4 taxonomy.

DATA_CONTRACT.md names ``ingest/mappings/categories.py`` as the home of
source-native -> taxonomy mapping tables; on this branch that module lives
inside the installed package (``brownsync_ingest/mappings/categories.py``)
for the same reason Task 6 placed ``cab/`` there — an out-of-package module
would not be importable from the installed CLI entry point. LiveWhale
``event_types`` tables land here when an ingestion-lane consumer exists.

The 2026-07-29 clubs export (``brown_all_student_groups.csv``) carries
three categorical columns, and the measured vocabularies show NONE of them
is thematic:

- ``funding_category``: UFB funding tiers (``Category 1``/``Category 2``),
  ``Student Governance`` status, or empty (all graduate rows);
- ``tags``: directory recognition status only;
- ``group_type``: which directory (undergraduate/graduate) listed the org.

Mapping policy (plan Task 7, "never guess"): every KNOWN value maps
explicitly — ``group_type`` to organization ``kind="club"``, and the
non-thematic vocabularies to ``category=None`` with machine-readable
reasons. Nothing is inferred from names or descriptions. An UNKNOWN value
raises :class:`UnmappedSourceValueError` so source drift fails the job's
``vocabulary`` gate loudly instead of nulling silently.
"""

from __future__ import annotations

from dataclasses import dataclass

from brownsync_ingest.contract import Category, OrganizationKind


class UnmappedSourceValueError(ValueError):
    """A source vocabulary value with no explicit mapping decision."""

    def __init__(self, column: str, value: str) -> None:
        super().__init__(
            f"unmapped {column} value {value!r}: extend the explicit vocabulary "
            "in brownsync_ingest/mappings/categories.py — guessing is forbidden"
        )
        self.column = column
        self.value = value


# Both student-group directories list clubs; departments/offices/athletics
# come from other sources.
KIND_BY_GROUP_TYPE: dict[str, OrganizationKind] = {
    "Undergraduate student group": "club",
    "Graduate student group": "club",
}

# Known funding_category values -> the reason they map to category=None.
FUNDING_CATEGORY_REASONS: dict[str, str] = {
    "Category 1": "funding-tier-not-thematic",
    "Category 2": "funding-tier-not-thematic",
    "Student Governance": "governance-status-not-thematic",
    "": "no-source-category",
}

# Known tags values -> the reason they map to category=None.
TAG_REASONS: dict[str, str] = {
    "UCS Recognized Undergrad Student Groups": "recognition-tag-not-thematic",
    "Graduate Student Council recognized group": "recognition-tag-not-thematic",
}


@dataclass(frozen=True)
class CategoryDecision:
    """A contract category (or None) plus the reasons no category applies."""

    category: Category | None
    reasons: tuple[str, ...]


def map_club_kind(group_type: str) -> OrganizationKind:
    """The contract organization kind for a directory ``group_type``."""
    kind = KIND_BY_GROUP_TYPE.get(group_type)
    if kind is None:
        raise UnmappedSourceValueError("group_type", group_type)
    return kind


def map_club_category(*, funding_category: str, tags: str) -> CategoryDecision:
    """The section 4 category decision for one club record.

    Every currently-known vocabulary value is non-thematic, so the decision
    is always ``category=None`` with explicit reasons; a future thematic
    source value would add an entry mapping to a real category.
    """
    reasons: list[str] = []
    funding_reason = FUNDING_CATEGORY_REASONS.get(funding_category)
    if funding_reason is None:
        raise UnmappedSourceValueError("funding_category", funding_category)
    reasons.append(funding_reason)
    tag_reason = TAG_REASONS.get(tags)
    if tag_reason is None:
        raise UnmappedSourceValueError("tags", tags)
    if tag_reason not in reasons:
        reasons.append(tag_reason)
    return CategoryDecision(category=None, reasons=tuple(reasons))
