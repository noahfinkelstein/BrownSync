"""LiveWhale ``event_types``/``group`` -> contract section 4 taxonomy.

DATA_CONTRACT §4 names ``ingest/mappings/categories.py`` as the home of
the LiveWhale mapping table. The table itself is a verbatim port of the
app lane's poller (``services/poller/src/livewhale/categories.ts``): the
seeds bootstrap the same rows the poller will refresh and upsert on
``(source, source_id)``, so the category decision must be IDENTICAL or
every live refresh flips categories back and forth.

Documented deviation from the task-7 raise-on-unknown ethos: the poller
never raises on an unknown event type — unknown values simply fail the
table match and fall through to the group fallback, then ``academic``.
Parity wins over the vocabulary gate here; drift is REPORTED by the job,
never guessed differently than the poller would.
"""

from __future__ import annotations

from brownsync_ingest.mappings.categories import (
    LIVEWHALE_EVENT_TYPE_CATEGORIES,
    LIVEWHALE_FALLBACK_CATEGORY,
    LIVEWHALE_GROUP_CATEGORIES,
    LIVEWHALE_IGNORED_EVENT_TYPES,
    categorize_livewhale,
    livewhale_group_key,
)


class TestTableParity:
    """The tables must be byte-for-byte the poller's (categories.ts)."""

    def test_topical_table_order_and_content(self) -> None:
        assert LIVEWHALE_EVENT_TYPE_CATEGORIES == (
            ("Free Food", "food"),
            ("Performances, Concerts and Exhibitions", "arts"),
            ("Social Event, Study Break", "social"),
            ("Awards, Receptions and Celebrations", "social"),
            ("Conferences and Colloquia", "academic"),
            ("Lectures, Seminars and Workshops", "academic"),
        )

    def test_audience_qualifiers_are_ignored(self) -> None:
        assert LIVEWHALE_IGNORED_EVENT_TYPES == frozenset(
            {"Open to the Public"}
        )

    def test_group_fallback_table(self) -> None:
        assert LIVEWHALE_GROUP_CATEGORIES == {
            "athletics": "athletics",
            "academic calendar": "admin",
            "human resources": "admin",
            "tisch career center": "career",
            "counseling and psychological services": "wellness",
            "office of the chaplains and religious life": "wellness",
            "student health & wellness": "wellness",
        }

    def test_fallback_is_academic(self) -> None:
        assert LIVEWHALE_FALLBACK_CATEGORY == "academic"


class TestGroupKey:
    def test_decodes_entities_trims_and_lowercases(self) -> None:
        assert livewhale_group_key("Alumni &amp; Friends ") == (
            "alumni & friends"
        )

    def test_plain_group_name(self) -> None:
        assert livewhale_group_key("Athletics") == "athletics"


class TestCategorize:
    def test_first_topical_table_hit_wins_in_priority_order(self) -> None:
        # food beats every co-present type — a lecture with Free Food is
        # surfaced as food (poller decision, from real-feed measurement)
        assert (
            categorize_livewhale(
                ["Lectures, Seminars and Workshops", "Free Food"], None
            )
            == "food"
        )
        assert (
            categorize_livewhale(
                ["Performances, Concerts and Exhibitions",
                 "Social Event, Study Break"],
                None,
            )
            == "arts"
        )

    def test_entries_are_trimmed_before_matching(self) -> None:
        # the real feed carries " Open to the Public" with stray leading
        # whitespace; trimmed entries must still match the tables
        assert (
            categorize_livewhale([" Free Food "], None) == "food"
        )

    def test_audience_qualifier_never_influences_the_category(self) -> None:
        assert (
            categorize_livewhale([" Open to the Public"], "Athletics")
            == "athletics"
        )

    def test_group_fallback_applies_only_without_topical_types(self) -> None:
        assert categorize_livewhale([], "Athletics") == "athletics"
        assert categorize_livewhale(None, "Academic Calendar") == "admin"
        assert (
            categorize_livewhale(
                ["Free Food"], "Athletics"
            )
            == "food"
        )

    def test_group_lookup_is_entity_decoded_and_case_folded(self) -> None:
        assert (
            categorize_livewhale([], "Student Health &amp; Wellness")
            == "wellness"
        )

    def test_unknown_type_falls_through_exactly_like_the_poller(self) -> None:
        # NOT an UnmappedSourceValueError: the poller falls through, so
        # the bootstrap must too (documented deviation, module docstring)
        assert (
            categorize_livewhale(["Entirely New Type"], "Athletics")
            == "athletics"
        )
        assert (
            categorize_livewhale(["Entirely New Type"], "Watson Institute")
            == "academic"
        )

    def test_no_types_no_group_is_academic(self) -> None:
        assert categorize_livewhale(None, None) == "academic"
        assert categorize_livewhale([], "") == "academic"
