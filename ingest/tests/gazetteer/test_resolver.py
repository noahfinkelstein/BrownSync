from __future__ import annotations

import pytest

from brownsync_ingest.common.identifiers import slugify
from brownsync_ingest.gazetteer.models import CuratedCatalog, CuratedPlace
from brownsync_ingest.gazetteer.resolver import (
    TRIGRAM_THRESHOLD,
    PlaceResolver,
    trigram_similarity,
    trigrams,
)


def place(name: str, *extra_aliases: str, id: str | None = None, kind: str = "academic") -> CuratedPlace:
    return CuratedPlace(
        id=id or slugify(name),
        name=name,
        kind=kind,
        aliases=(name, *extra_aliases),
        osm_name=name,
        lat=None,
        lng=None,
    )


def make_catalog(*places: CuratedPlace) -> CuratedCatalog:
    return CuratedCatalog(
        places=places,
        attribution="(c) OpenStreetMap contributors, ODbL 1.0",
    )


@pytest.fixture(scope="module")
def resolver() -> PlaceResolver:
    """The real curated catalog, loaded once via the default path."""
    return PlaceResolver.from_files()


class TestTrigrams:
    def test_pads_each_word_with_two_leading_and_one_trailing_space(self) -> None:
        assert trigrams("sayles") == frozenset(
            {"  s", " sa", "say", "ayl", "yle", "les", "es "}
        )

    def test_words_split_on_non_alphanumerics_including_underscore(self) -> None:
        assert trigrams("barus_holley") == trigrams("barus holley")
        assert trigrams("Barus & Holley") == trigrams("barus holley")
        assert trigrams("B&H") == trigrams("b h")

    def test_duplicate_trigrams_collapse_into_a_set(self) -> None:
        assert trigrams("aaaaaa") == frozenset({"  a", " aa", "aaa", "aa "})
        assert trigrams("aaa") == trigrams("aaaaaa")

    def test_single_character_word_has_two_trigrams(self) -> None:
        assert trigrams("a") == frozenset({"  a", " a "})

    def test_no_alphanumerics_gives_the_empty_set(self) -> None:
        assert trigrams("") == frozenset()
        assert trigrams(" -&- ") == frozenset()


class TestTrigramSimilarity:
    def test_matches_the_golden_parity_vector(self, parity_vector) -> None:
        a, b, expected = parity_vector
        assert trigram_similarity(a, b) == pytest.approx(expected, abs=1e-12)
        assert trigram_similarity(b, a) == pytest.approx(expected, abs=1e-12)

    def test_the_exact_boundary_pair_clears_the_float_threshold(self) -> None:
        assert trigram_similarity("Backgammon", "Backgammon Terminal") >= TRIGRAM_THRESHOLD
        assert trigram_similarity("Backgammon", "Backgammon Terminals") < TRIGRAM_THRESHOLD


class TestExactResolution:
    def test_exact_name_match(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Sayles Hall")
        assert resolution.place_id == "sayles-hall"
        assert resolution.method == "exact"
        assert resolution.room is None
        assert resolution.reason is None
        assert resolution.score is None
        assert resolution.candidates == ()

    def test_exact_alias_match_is_case_and_punctuation_insensitive(
        self, resolver: PlaceResolver
    ) -> None:
        assert resolver.resolve("the ratty").place_id == "sharpe-refectory"
        assert resolver.resolve("SMITH-BUONANNO  HALL").place_id == "smith-buonanno-hall"
        assert resolver.resolve("smith buonanno hall").method == "exact"

    def test_raw_query_value_is_preserved_exactly(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("  The  Ratty  ")
        assert resolution.query == "  The  Ratty  "
        assert resolution.place_id == "sharpe-refectory"

    def test_barus_building_and_barus_holley_stay_distinct(
        self, resolver: PlaceResolver
    ) -> None:
        assert resolver.resolve("Barus Building").place_id == "barus-building"
        assert resolver.resolve("Barus & Holley").place_id == "barus-holley"
        assert resolver.resolve("B&H").place_id == "barus-holley"

    def test_address_aliases_never_lose_their_leading_number(
        self, resolver: PlaceResolver
    ) -> None:
        street = resolver.resolve("85 Waterman Street")
        assert (street.place_id, street.room, street.method) == (
            "85-waterman-street",
            None,
            "exact",
        )
        short = resolver.resolve("85 Waterman")
        assert (short.place_id, short.room, short.method) == (
            "85-waterman-street",
            None,
            "exact",
        )


class TestRoomExtraction:
    def test_alias_prefix_plus_room_number(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Salomon 101")
        assert resolution.place_id == "salomon-center-for-teaching"
        assert resolution.room == "101"
        assert resolution.method == "exact-room"
        assert resolution.score is None

    def test_longest_alias_wins_the_split(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Salomon Center 101")
        assert resolution.place_id == "salomon-center-for-teaching"
        assert resolution.room == "101"  # never "Center 101" via the shorter alias

    def test_hyphenated_building_with_room(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Smith-Buonanno Hall 106")
        assert resolution.place_id == "smith-buonanno-hall"
        assert resolution.room == "106"
        assert resolution.method == "exact-room"

    def test_room_keeps_its_raw_capitalization(self, resolver: PlaceResolver) -> None:
        assert resolver.resolve("Salomon B101").room == "B101"

    def test_barus_rooms_bind_to_the_right_building(self, resolver: PlaceResolver) -> None:
        building = resolver.resolve("Barus Building 108")
        assert (building.place_id, building.room) == ("barus-building", "108")
        holley = resolver.resolve("Barus and Holley 168")
        assert (holley.place_id, holley.room) == ("barus-holley", "168")

    def test_two_token_room_is_extracted(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Salomon 001 A")
        assert resolution.place_id == "salomon-center-for-teaching"
        assert resolution.room == "001 A"
        assert resolution.method == "exact-room"

    def test_digitless_remainder_is_not_a_room(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Sayles Hall Auditorium")
        assert resolution.method == "unresolved"
        assert resolution.reason == "below-threshold"
        assert resolution.room is None
        assert resolution.score == pytest.approx(12 / 23)


class TestFuzzyResolution:
    def test_trigram_acceptance_with_room_on_the_real_catalog(
        self, resolver: PlaceResolver
    ) -> None:
        resolution = resolver.resolve("MacMillan 117")
        assert resolution.place_id == "macmillan-hall"
        assert resolution.method == "trigram"
        assert resolution.room == "117"
        assert resolution.score == pytest.approx(10 / 15)

    def test_typo_resolves_by_trigram(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("Smith Buonano Hall")
        assert resolution.place_id == "smith-buonanno-hall"
        assert resolution.method == "trigram"
        assert resolution.room is None
        assert resolution.score == pytest.approx(6 / 7)

    def test_garbage_stays_unresolved(self, resolver: PlaceResolver) -> None:
        resolution = resolver.resolve("zzzz qqqq xyxyx")
        assert resolution.place_id is None
        assert resolution.method == "unresolved"
        assert resolution.reason == "below-threshold"

    def test_empty_and_separator_only_values(self, resolver: PlaceResolver) -> None:
        for value in ("", "   ", " & "):
            resolution = resolver.resolve(value)
            assert resolution.query == value
            assert resolution.place_id is None
            assert resolution.method == "unresolved"
            assert resolution.reason == "empty-after-normalization"
            assert resolution.score is None
            assert resolution.candidates == ()


class TestFuzzySynthetic:
    def test_similarity_of_exactly_055_is_accepted(self) -> None:
        resolver = PlaceResolver(make_catalog(place("Backgammon Terminal")))
        resolution = resolver.resolve("Backgammon")
        assert resolution.place_id == "backgammon-terminal"
        assert resolution.method == "trigram"
        assert resolution.score == pytest.approx(11 / 20)
        assert resolution.score >= TRIGRAM_THRESHOLD

    def test_similarity_just_below_055_is_rejected(self) -> None:
        resolver = PlaceResolver(make_catalog(place("Backgammon Terminals")))
        resolution = resolver.resolve("Backgammon")
        assert resolution.place_id is None
        assert resolution.reason == "below-threshold"
        assert resolution.score == pytest.approx(11 / 21)
        # the best candidate is still reported for alias growth
        assert resolution.candidates[0].place_id == "backgammon-terminals"

    def test_rapidfuzz_ranks_but_never_vetoes_the_trigram_winner(self) -> None:
        resolver = PlaceResolver(
            make_catalog(place("Granite Hall Anex"), place("Granite Hall"))
        )
        resolution = resolver.resolve("Granite Hall Annex")
        # Both candidates clear the threshold; the higher trigram score wins
        # even though RapidFuzz ranks the other candidate first.
        assert resolution.place_id == "granite-hall-anex"
        assert resolution.method == "trigram"
        assert resolution.score == pytest.approx(17 / 20)
        ranked = resolution.candidates
        assert ranked[0].place_id == "granite-hall"
        assert ranked[0].token_set_ratio == pytest.approx(100.0)
        assert ranked[0].trigram == pytest.approx(13 / 19)
        assert ranked[1].place_id == "granite-hall-anex"
        assert ranked[1].trigram == pytest.approx(17 / 20)
        assert ranked[1].token_set_ratio < 100.0

    def test_equal_trigram_scores_are_ambiguous_and_fail_closed(self) -> None:
        resolver = PlaceResolver(
            make_catalog(place("Quincy Annex North"), place("Quincy Annex South"))
        )
        resolution = resolver.resolve("Quincy Annex")
        assert resolution.place_id is None
        assert resolution.method == "unresolved"
        assert resolution.reason == "ambiguous"
        assert resolution.score == pytest.approx(13 / 19)
        assert {candidate.place_id for candidate in resolution.candidates} == {
            "quincy-annex-north",
            "quincy-annex-south",
        }

    def test_trigram_match_can_strip_a_trailing_room(self) -> None:
        resolver = PlaceResolver(make_catalog(place("Backgammon Terminal")))
        resolution = resolver.resolve("Bakgammon Terminal 12")
        assert resolution.place_id == "backgammon-terminal"
        assert resolution.method == "trigram"
        assert resolution.room == "12"
        assert resolution.score == pytest.approx(17 / 22)

    def test_a_room_split_never_lands_mid_raw_token(self) -> None:
        resolver = PlaceResolver(make_catalog(place("Wilson")))
        resolution = resolver.resolve("Wilson-Annex 3")
        # "Annex" sits inside the raw token "Wilson-Annex", so neither the
        # alias-prefix stage nor the fuzzy strip may treat "Annex 3" as a
        # room; only the aligned "3" may be stripped, and that variant stays
        # below threshold.
        assert resolution.place_id is None
        assert resolution.method == "unresolved"
        assert resolution.reason == "below-threshold"
        assert resolution.room is None
        assert resolution.score == pytest.approx(7 / 13)

    def test_candidates_are_capped_at_five(self) -> None:
        resolver = PlaceResolver(
            make_catalog(
                place("Hall Ax"),
                place("Hall Bx"),
                place("Hall Cx"),
                place("Hall Dx"),
                place("Hall Ex"),
                place("Hall Fx"),
            )
        )
        resolution = resolver.resolve("Hall")
        assert resolution.reason == "ambiguous"
        assert len(resolution.candidates) == 5

    def test_colliding_normalized_aliases_are_rejected_at_construction(self) -> None:
        with pytest.raises(ValueError, match="collides"):
            PlaceResolver(
                make_catalog(
                    place("North House"),
                    place("North-House", id="other-north"),
                )
            )
