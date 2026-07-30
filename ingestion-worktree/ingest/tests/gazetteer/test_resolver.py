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


class TestTask6BAliasGrowthVectors:
    """Every Task 6B alias/place decision, pinned against the real catalog.

    Each vector is a verbatim unresolved location string from the Fall 2026
    export (task-6 resolution report); the expected place is the one the
    Overpass fixture (or, for the two curated entries, OSM-derived curated
    coordinates) grounds. Growth is evidence-only: strings nothing grounds
    stay unresolved and are pinned as such below.
    """

    @pytest.mark.parametrize(
        ("query", "place_id", "room"),
        [
            # aliases onto existing places
            ("S. Frank Hall for Life Science 218", "sidney-frank-hall", "218"),
            ("155 George Street 106", "modern-culture-and-media", "106"),
            ("Grant Recital 105", "orwig-music-hall", "105"),
            ("Grant Recital 115", "orwig-music-hall", "115"),
            ("111 Thayer St-Watson Institute 138", "watson-institute-for-international-studies", "138"),
            ("190 Hope Street 102", "german-department", "102"),
            ("Geo-Chemistry Building 039", "geochem-building", "039"),
            ("68 Waterman Mencoff Hall 205", "mencoff-hall", "205"),
            ("79 Brown St-Peter Green Hse 106", "peter-green-house", "106"),
            ("84 Prospect St-Rochambeau Hse 107", "rochambeau-house", "107"),
            ("163 George Street 103", "hirschfeld-house", "103"),
            ("159 George St-Meiklejohn House 102", "meiklejohn-house", "102"),
            ("50 John Street 120", "theatre-arts-building", "120"),
            ("1 Euclid Ave, Nelson Ctr Entr 201", "nelson-center-for-entrepreneurship", "201"),
            ("47 George St-Horace Mann 103", "horace-mann-house", "103"),
            ("45 Prospect St-CorlissBrackett 106", "corliss-brackett-house", "106"),
            # new places grounded by fixture footprints
            ("67 George Street 104", "67-george-street", "104"),
            ("135 Thayer Street 101", "135-thayer-street", "101"),
            ("2 Stimson Avenue 111", "2-stimson-avenue", "111"),
            ("59 Charlesfield Street 101", "59-charlesfield-street", "101"),
            ("8 Fones Alley 016", "8-fones-alley", "016"),
            ("271 Thayer Street 2NDFLOOR", "271-thayer-street", "2NDFLOOR"),
            ("Steinert Hall 105", "steinert-hall", "105"),
            ("130 Hope St (Feinstein Bldg.) 104", "feinstein-building", "104"),
            ("Gerard House 101", "gerard-house", "101"),
            ("59 George St- S. Miller House 101", "shirley-miller-house", "101"),
            ("80 Waterman St - Walter Hall 102", "walter-hall", "102"),
            ("Nicholson House 101", "nicholson-house", "101"),
            # new places grounded by OSM-derived curated coordinates
            ("101 Thayer Street (VGQ 1st fl) 116E", "vartan-gregorian-quad", "116E"),
            ("101 Thayer Street (VGQ 1st fl) 116B", "vartan-gregorian-quad", "116B"),
            ("222 Richmond (Alpert Med) 280", "warren-alpert-medical-school", "280"),
        ],
    )
    def test_export_evidence_string_resolves_exactly_with_room(
        self, resolver: PlaceResolver, query: str, place_id: str, room: str
    ) -> None:
        resolution = resolver.resolve(query)
        assert resolution.place_id == place_id
        assert resolution.room == room
        assert resolution.method == "exact-room"

    def test_the_marc_room_resolves_to_sidney_frank_hall_by_trigram(
        self, resolver: PlaceResolver
    ) -> None:
        # "MARC" carries no digit, so the room stages cannot split it; the
        # grown alias still lifts the string over the trigram threshold.
        resolution = resolver.resolve("S. Frank Hall for Life Science MARC")
        assert resolution.place_id == "sidney-frank-hall"
        assert resolution.method == "trigram"

    def test_barus_building_and_barus_holley_stay_distinct(
        self, resolver: PlaceResolver
    ) -> None:
        assert resolver.resolve("Barus Building 141").place_id == "barus-building"
        assert resolver.resolve("Barus & Holley 166").place_id == "barus-holley"

    @pytest.mark.parametrize(
        "query",
        [
            "SMN121 801",  # opaque code, nothing grounds it
            "National Press Building DC 975 968",  # Washington DC, off-campus
            "300 Richmond Street 298",  # Jewelry District, outside the fixture bbox
        ],
    )
    def test_ungroundable_strings_stay_unresolved(
        self, resolver: PlaceResolver, query: str
    ) -> None:
        assert resolver.resolve(query).place_id is None


class TestTask10AddressAliasTraps:
    """Task 10 review: address strings the trigram stage silently mis-bound.

    Each vector is a verbatim published location from the Fall 2026 export
    that used to resolve to the WRONG building at >= 0.55 trigram similarity
    against a curated address alias of a nearby place:

    - ``70 Brown Street NNN`` (26 rows) landed on Page-Robinson Hall via its
      ``69 Brown Street`` alias (0.684), although 70 Brown Street is its own
      OSM university building (way/1073442221) in the recorded fixture;
    - ``94 Waterman Street- CSSJ NNN`` landed on 85 Waterman Street (0.727)
      with the corrupted room ``CSSJ NNN``, although the CSSJ itself is
      catalogued at 94 Waterman Street;
    - ``155 South Main Street - Packet NNN`` landed on 121 South Main Street
      (0.75, a different building ~150m away), although 155 South Main is
      The Packet Building (OSM way/141567737) in the recorded fixture.

    Curation makes each resolve exactly (with a clean room) to the building
    the Overpass fixture grounds.
    """

    @pytest.mark.parametrize(
        ("query", "place_id", "room"),
        [
            ("70 Brown Street 315", "70-brown-street", "315"),
            ("70 Brown Street 130", "70-brown-street", "130"),
            ("94 Waterman Street- CSSJ 110", "center-for-the-study-of-slavery-and-justice", "110"),
            ("155 South Main Street - Packet 151", "packet-building", "151"),
            ("155 South Main Street - Packet 003", "packet-building", "003"),
        ],
    )
    def test_trap_string_resolves_exactly_to_the_fixture_grounded_building(
        self, resolver: PlaceResolver, query: str, place_id: str, room: str
    ) -> None:
        resolution = resolver.resolve(query)
        assert resolution.place_id == place_id
        assert resolution.room == room
        assert resolution.method == "exact-room"

    def test_the_sixty_nine_brown_street_alias_still_binds_page_robinson(
        self, resolver: PlaceResolver
    ) -> None:
        resolution = resolver.resolve("69 Brown Street 315")
        assert resolution.place_id == "page-robinson-hall"
        assert resolution.room == "315"
