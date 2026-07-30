"""Source-native vocabularies -> DATA_CONTRACT.md section 4 taxonomy.

DATA_CONTRACT.md names ``ingest/mappings/categories.py`` as the home of
source-native -> taxonomy mapping tables; on this branch that module lives
inside the installed package (``brownsync_ingest/mappings/categories.py``)
for the same reason Task 6 placed ``cab/`` there — an out-of-package module
would not be importable from the installed CLI entry point. Two vocabularies
live here: the clubs-directory tables (task 7) and the LiveWhale
``event_types``/``group`` tables (events bootstrap).

The LiveWhale tables are a verbatim port of the app lane's poller
(``services/poller/src/livewhale/categories.ts``, read read-only on
``main``): the poller refreshes the bootstrap seeds live and upserts on
``(source, source_id)``, so the category decision must be IDENTICAL or
every refresh flips categories. That forces one documented deviation from
this module's raise-on-unknown ethos: the poller never raises on an
unknown event type — unknown values fail the table match and fall through
to the group fallback, then ``academic``. ``categorize_livewhale``
therefore falls through too; the events job REPORTS unknown types instead
of failing on them.

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
from typing import Iterable

from brownsync_ingest.common.text import decode_entities
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


# --- LiveWhale events -> taxonomy (poller parity) -----------------------
#
# Every table below is field-for-field the poller's categories.ts. The
# priority rationale is the poller's, from real-feed measurement: the
# rarer, more student-actionable signal wins (food > arts > social >
# academic); "Open to the Public" is an audience qualifier, not a topic;
# 625/1000 fixture rows carry no topical type, so unambiguous publisher
# groups map directly; the final fallback is academic (sampled remainder
# is talk/lecture-shaped), never admin or social.

LIVEWHALE_EVENT_TYPE_CATEGORIES: tuple[tuple[str, Category], ...] = (
    ("Free Food", "food"),
    ("Performances, Concerts and Exhibitions", "arts"),
    ("Social Event, Study Break", "social"),
    ("Awards, Receptions and Celebrations", "social"),
    ("Conferences and Colloquia", "academic"),
    ("Lectures, Seminars and Workshops", "academic"),
)

# Audience qualifiers, not topics — never influence the category.
LIVEWHALE_IGNORED_EVENT_TYPES: frozenset[str] = frozenset(
    {"Open to the Public"}
)

# Publisher-group fallback for rows with no topical type (keys are
# entity-decoded, trimmed, lowercased — see livewhale_group_key).
LIVEWHALE_GROUP_CATEGORIES: dict[str, Category] = {
    "athletics": "athletics",
    "academic calendar": "admin",
    "human resources": "admin",
    "tisch career center": "career",
    "counseling and psychological services": "wellness",
    "office of the chaplains and religious life": "wellness",
    "student health & wellness": "wellness",
}

LIVEWHALE_FALLBACK_CATEGORY: Category = "academic"


def livewhale_group_key(name: str) -> str:
    """The poller's ``groupKey``: LiveWhale group names arrive
    HTML-encoded ("Alumni &amp; Friends") — decode, trim, lowercase."""
    return decode_entities(name).strip().lower()


def categorize_livewhale(
    event_types: Iterable[str] | None, group: str | None
) -> Category:
    """The poller's ``categorize``, ported verbatim.

    Unknown event types fall through (they are counted by the caller,
    never raised here — module docstring documents the deviation).
    """
    present = {
        trimmed
        for trimmed in (entry.strip() for entry in event_types or ())
        if trimmed not in LIVEWHALE_IGNORED_EVENT_TYPES
    }
    for event_type, category in LIVEWHALE_EVENT_TYPE_CATEGORIES:
        if event_type in present:
            return category
    if group:
        fallback = LIVEWHALE_GROUP_CATEGORIES.get(livewhale_group_key(group))
        if fallback is not None:
            return fallback
    return LIVEWHALE_FALLBACK_CATEGORY


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
