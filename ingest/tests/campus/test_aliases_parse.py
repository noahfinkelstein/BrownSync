"""Alias parsing and label resolution — the map's building labels come from here.

Cases are drawn from the recorded ArcGIS fixture, not invented: every literal in
this file appears verbatim in
``ingest/fixtures/recorded/arcgis/active-buildings.geojson``.
"""

from __future__ import annotations

import pytest

from brownsync_ingest.campus.aliases_parse import (
    LABEL_OVERRIDES,
    AliasParse,
    is_address_shaped,
    parse_aliases,
    resolve_label,
    split_complex,
)


def resolve(**overrides: object):
    payload: dict[str, object] = {
        "property_code": "100000",
        "property_name": None,
        "official_name": None,
        "address_line_1": None,
        "property_abbr": None,
        "parsed": AliasParse(pairs=()),
    }
    payload.update(overrides)
    return resolve_label(**payload)  # type: ignore[arg-type]


class TestParseAliases:
    def test_parses_key_value_segments(self) -> None:
        parsed = parse_aliases("ALTADDRS: 235 Hope St; DISPNAME: Nelson Fitness Ctr")
        assert parsed.pairs == (
            ("ALTADDRS", "235 Hope St"),
            ("DISPNAME", "Nelson Fitness Ctr"),
        )
        assert parsed.diagnostics == ()

    def test_keeps_repeated_keys(self) -> None:
        # Real row 100093. A dict parse would silently drop "Physical Plant".
        parsed = parse_aliases(
            "DISPNAME: Cental Heat Plant; NICKNAME: Chp; NICKNAME: Physical Plant"
        )
        assert parsed.values("NICKNAME") == ("Chp", "Physical Plant")

    def test_folds_the_display_name_spelling_variant(self) -> None:
        # Exactly one row in the fixture uses "DISPLAY NAME" with a space.
        assert parse_aliases("DISPLAY NAME: Sayles Hall").values("DISPNAME") == ("Sayles Hall",)

    def test_reports_unknown_keys_but_keeps_the_value(self) -> None:
        parsed = parse_aliases("WHATSIT: Some Building")
        assert any("unknown alias key" in d for d in parsed.diagnostics)
        # Still searchable — an unknown key must not lose data silently.
        assert parsed.values("<UNTAGGED>") == ("Some Building",)

    def test_reports_untagged_segments(self) -> None:
        parsed = parse_aliases("Sternlicht Commons and Brown University Health & Wellness Center")
        assert any("untagged" in d for d in parsed.diagnostics)
        assert parsed.values("<UNTAGGED>")

    @pytest.mark.parametrize("raw", [None, "", "   ", ";", " ; ; "])
    def test_empty_inputs_are_not_errors(self, raw: str | None) -> None:
        assert parse_aliases(raw).pairs == ()

    def test_only_the_first_colon_splits(self) -> None:
        parsed = parse_aliases("DISPNAME: Champlin: Pembroke Quad")
        assert parsed.values("DISPNAME") == ("Champlin: Pembroke Quad",)


class TestIsAddressShaped:
    @pytest.mark.parametrize(
        "name",
        ["Hope St 170", "Waterman St 118-120", "Elmgrove Ave 346", "Cushing St 084-086"],
    )
    def test_street_type_plus_number_is_an_address(self, name: str) -> None:
        assert is_address_shaped(name)

    @pytest.mark.parametrize(
        "name",
        [
            # A trailing number alone is NOT enough — these are all real names.
            "New Pembroke No. 3",
            "Olney-Margolies Athletic Center",
            "Metcalf Hall",
            "Pizzitola",
            None,
            "",
        ],
    )
    def test_names_are_not_addresses(self, name: str | None) -> None:
        assert not is_address_shaped(name)

    def test_the_discriminator_is_the_street_type_not_the_digit(self) -> None:
        # Same shape, different classification — this is the whole point of the
        # STREET_TYPES allowlist over a bare `\s\d+$` regex.
        assert is_address_shaped("Brook St 456")
        assert not is_address_shaped("Brown Stadium Dugout 1")


class TestSplitComplex:
    def test_splits_the_pembroke_quad_suffix(self) -> None:
        assert split_complex("Champlin: Pembroke Quad") == ("Champlin", "Pembroke Quad")

    def test_leaves_plain_names_alone(self) -> None:
        assert split_complex("Metcalf Hall") == ("Metcalf Hall", None)

    def test_refuses_to_produce_an_empty_side(self) -> None:
        assert split_complex(": Pembroke Quad") == (": Pembroke Quad", None)


class TestResolveLabel:
    def test_dispname_wins(self) -> None:
        # Facilities' own display name is friendlier than the address-style
        # Property_Name: "Hope St 170" -> "170 Hope".
        result = resolve(
            property_name="Hope St 170",
            parsed=parse_aliases("DISPNAME: 170 Hope; NICKNAME: Applied Math Building"),
        )
        assert result.label == "170 Hope"
        assert result.rule == "dispname"

    def test_property_name_when_no_dispname_and_not_an_address(self) -> None:
        result = resolve(property_name="The Lindemann Performing Arts Center")
        assert result.label == "The Lindemann Performing Arts Center"
        assert result.rule == "property-name"

    def test_nickname_before_address(self) -> None:
        result = resolve(
            property_name="Thayer St 315",
            address_line_1="315 Thayer St",
            parsed=parse_aliases("NICKNAME: Pitz"),
        )
        assert result.label == "Pitz"

    def test_address_when_nothing_else_names_it(self) -> None:
        result = resolve(property_name="Cushing St 172", address_line_1="172 Cushing St")
        assert result.label == "172 Cushing St"
        assert result.rung == 4

    def test_official_name_is_never_the_label(self) -> None:
        # 22/263 coverage and visibly truncated at ~100 chars in the source.
        official = (
            "The Jonathan M. Nelson Fitness Center & The Katherine Moran Coleman "
            "Aquatics Center & The David J. Z"
        )
        result = resolve(property_name="Nelson Fitness Center", official_name=official)
        assert result.label == "Nelson Fitness Center"
        assert official in result.aliases

    def test_every_name_becomes_a_searchable_alias(self) -> None:
        result = resolve(
            property_name="Central Heat Plant",
            address_line_1="1 Brook St",
            property_abbr="CHP",
            parsed=parse_aliases("NICKNAME: Chp; NICKNAME: Physical Plant; LEGACY: Power House"),
        )
        for expected in ("Chp", "Physical Plant", "Power House", "1 Brook St", "CHP"):
            assert expected in result.aliases
        assert result.label not in result.aliases  # no self-duplication

    def test_complex_suffix_is_split_off_but_recorded(self) -> None:
        result = resolve(property_name="Morriss Hall: Pembroke Quad")
        assert result.label == "Morriss Hall"
        assert result.complex_name == "Pembroke Quad"

    def test_flags_likely_typos_between_dispname_and_property_name(self) -> None:
        result = resolve(
            property_name="Central Heat Plant",
            parsed=parse_aliases("DISPNAME: Cental Heat Plant"),
        )
        assert any("possible typo" in d for d in result.diagnostics)


class TestLabelOverrides:
    def test_override_applies_when_the_expected_name_matches(self) -> None:
        result = resolve(
            property_code="100093",
            property_name="Central Heat Plant",
            parsed=parse_aliases("DISPNAME: Cental Heat Plant"),
        )
        assert result.label == "Central Heat Plant"
        assert result.rule == "curated-override"

    def test_override_is_refused_when_it_targets_a_different_building(self) -> None:
        # Regression guard. The first draft of LABEL_OVERRIDES guessed 100255
        # for the Central Heat Plant; 100255 is actually "Waterman St 131", so
        # the override silently relabelled an unrelated building.
        result = resolve(
            property_code="100093",
            property_name="Waterman St 131",
            parsed=parse_aliases("DISPNAME: 131 Waterman"),
        )
        assert result.label == "131 Waterman"
        assert result.rule == "dispname"
        assert any("override IGNORED" in d for d in result.diagnostics)

    def test_every_override_declares_the_name_it_expects(self) -> None:
        for code, entry in LABEL_OVERRIDES.items():
            assert isinstance(entry, tuple) and len(entry) == 2, code
            assert entry[0] and entry[1], code
