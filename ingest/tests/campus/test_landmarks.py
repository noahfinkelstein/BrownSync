"""Greens, quads and fields — and binding them to the curated `outdoor` places.

The six `outdoor` places in `db/seeds/places.ndjson` carry NO polygon, so this
module is the only source of geometry for the Main Green, the Quiet Green,
Wriston Quad, the Ruth J. Simmons Quadrangle and Pembroke Green.
"""

from __future__ import annotations

import pytest

from brownsync_ingest.campus.conflate import SeedPlace, load_seed_places
from brownsync_ingest.campus.landmarks import (
    LANDMARK_MIN_ZOOM,
    NAME_ONLY_THRESHOLD,
    Landmark,
    _name_similarity,
    bind_outdoor_places,
    build_landmarks_document,
    load_landmarks,
)


SEEDS = "db/seeds/places.ndjson"


@pytest.fixture(scope="module")
def landmarks() -> tuple[Landmark, ...]:
    return load_landmarks()


@pytest.fixture(scope="module")
def places(repo_root) -> tuple[SeedPlace, ...]:
    return load_seed_places(repo_root / SEEDS)


class TestLoad:
    def test_reads_both_recorded_layers(self, landmarks) -> None:
        kinds = {landmark.kind for landmark in landmarks}
        assert kinds == {"green", "field"}
        assert len(landmarks) > 400

    def test_most_polygons_are_unnamed_ground(self, landmarks) -> None:
        # 516 of 552 are lawn and planting beds. They exist so campus reads as
        # green space; they carry no label and no interaction.
        named = [landmark for landmark in landmarks if landmark.name]
        assert 20 < len(named) < len(landmarks) / 2

    def test_drops_placeholder_names(self, landmarks) -> None:
        # The source contains " ", "Lower" and "Upper" as GreenSpaceName values
        # — fragments of split polygons, not names.
        for landmark in landmarks:
            assert landmark.name is None or landmark.name.strip()
            assert landmark.name not in {"Lower", "Upper"}

    def test_centroids_land_on_campus(self, landmarks) -> None:
        for landmark in landmarks:
            assert 41.75 < landmark.lat < 41.87, landmark.id
            assert -71.45 < landmark.lng < -71.37, landmark.id

    def test_output_is_deterministic(self, landmarks) -> None:
        assert [landmark.id for landmark in landmarks] == sorted(
            landmark.id for landmark in landmarks
        )


class TestNameSimilarity:
    def test_distinguishes_a_field_from_a_green_of_the_same_name(self) -> None:
        # THE regression this threshold exists for. An earlier version dropped
        # "field"/"green" as noise words, leaving only "pembroke", and bound
        # Pembroke Field (an athletic field) to Pembroke Green.
        assert _name_similarity("Pembroke Field", "Pembroke Green") < NAME_ONLY_THRESHOLD

    def test_matches_across_a_parenthetical_alias(self) -> None:
        assert (
            _name_similarity("College Green (Main Green)", "The College Green")
            >= NAME_ONLY_THRESHOLD
        )

    def test_ignores_only_contentless_words(self) -> None:
        assert _name_similarity("The Quiet Green", "Quiet Green") == 1.0


class TestBinding:
    def test_binds_five_of_the_six_curated_greens(self, landmarks, places) -> None:
        bound, _, unbound = bind_outdoor_places(landmarks, places)
        by_place = {
            landmark.place_id: landmark for landmark in bound if landmark.place_id
        }
        assert set(by_place) == {
            "the-college-green",
            "the-quiet-green",
            "pembroke-green",
            "wriston-quadrangle",
            "ruth-j-simmons-quadrangle",
        }
        # A gate is not an open space and there is no gate layer — correctly
        # unbound rather than snapped to whatever is nearest.
        assert unbound == ("van-wickle-gates",)

    def test_every_bound_landmark_carries_a_label(self, landmarks, places) -> None:
        # Wriston Quad and the Ruth J. Simmons Quadrangle sit inside UNNAMED
        # polygons and inherit the curated place name; without that they would
        # render as anonymous grass.
        bound, _, _ = bind_outdoor_places(landmarks, places)
        for landmark in bound:
            if landmark.place_id:
                assert landmark.name, landmark.id

    def test_binds_each_place_to_at_most_one_polygon(self, landmarks, places) -> None:
        bound, _, _ = bind_outdoor_places(landmarks, places)
        ids = [landmark.place_id for landmark in bound if landmark.place_id]
        assert len(ids) == len(set(ids))

    def test_prefers_a_named_polygon_over_an_unnamed_one(self, places) -> None:
        # Iterating landmarks rather than places bound whichever polygon came
        # first in file order — in practice an unnamed lawn patch beat the
        # polygon literally called "Simmons Quadrangle (Lower Green)".
        target = next(p for p in places if p.id == "the-college-green")
        square = {
            "type": "Polygon",
            "coordinates": [
                [
                    [target.lng - 0.001, target.lat - 0.001],
                    [target.lng + 0.001, target.lat - 0.001],
                    [target.lng + 0.001, target.lat + 0.001],
                    [target.lng - 0.001, target.lat + 0.001],
                    [target.lng - 0.001, target.lat - 0.001],
                ]
            ],
        }
        unnamed = Landmark("green:1", "green", None, square, target.lat, target.lng)
        named = Landmark(
            "green:2", "green", "College Green (Main Green)", square, target.lat, target.lng
        )
        bound, _, _ = bind_outdoor_places((unnamed, named), [target])
        winner = next(landmark for landmark in bound if landmark.place_id)
        assert winner.id == "green:2"

    def test_reports_a_name_only_binding_as_a_diagnostic(self, landmarks, places) -> None:
        _, diagnostics, _ = bind_outdoor_places(landmarks, places)
        assert any("by name only" in message for message in diagnostics)


class TestDocument:
    def test_only_named_features_carry_label_metadata(self, landmarks, places) -> None:
        bound, _, _ = bind_outdoor_places(landmarks, places)
        document = build_landmarks_document(bound, "attribution")
        for feature in document["features"]:
            properties = feature["properties"]
            assert "kind" in properties
            if "label" in properties:
                # 0, not 14.5: MapLibre evaluates ["zoom"] inside a FILTER at
                # the integer tile zoom, so a fractional threshold fires a whole
                # level late. The layer's own minzoom does the real gating.
                assert properties["labelMinZoom"] == LANDMARK_MIN_ZOOM == 0
                assert properties["rank"] == 0
            else:
                assert "labelMinZoom" not in properties

    def test_carries_attribution(self, landmarks) -> None:
        document = build_landmarks_document(landmarks, "Brown University Facilities")
        assert "Brown University Facilities" in document["attribution"]
