"""Curated catalog loading and alias normalization for the gazetteer."""

from __future__ import annotations

from pathlib import Path
import re
import unicodedata

import yaml

from brownsync_ingest.common.identifiers import slugify
from brownsync_ingest.gazetteer.models import CuratedCatalog, CuratedPlace
from brownsync_ingest.policy import validate_coordinates, validate_slug


DEFAULT_ALIASES_PATH = Path(__file__).resolve().parent / "aliases.yaml"

_VALID_KINDS = frozenset(
    {"academic", "residence", "dining", "athletic", "library", "admin", "outdoor", "other"}
)
_ALLOWED_PLACE_KEYS = frozenset({"id", "name", "kind", "aliases", "osm", "lat", "lng"})
_ALLOWED_TOP_KEYS = frozenset({"schema_version", "attribution", "places"})
_APOSTROPHES = frozenset("'’ʼ")
_SPACE_RUN = re.compile(r" {2,}")


def normalize_alias(text: str) -> str:
    """Case/punctuation/accent-insensitive key for alias comparison.

    Case-folds, strips accents, drops apostrophes, converts every other
    non-alphanumeric character to a space, and collapses whitespace.
    """
    folded = unicodedata.normalize("NFKD", str(text).casefold())
    characters: list[str] = []
    for character in folded:
        if character in _APOSTROPHES or unicodedata.combining(character):
            continue
        if character.isascii() and character.isalnum():
            characters.append(character)
        else:
            characters.append(" ")
    normalized = _SPACE_RUN.sub(" ", "".join(characters)).strip()
    if not normalized:
        raise ValueError(f"alias {text!r} normalizes to nothing")
    return normalized


def _parse_place(entry: object, index: int) -> CuratedPlace:
    if not isinstance(entry, dict):
        raise ValueError(f"place #{index} must be a mapping")
    unknown = set(entry) - _ALLOWED_PLACE_KEYS
    if unknown:
        raise ValueError(f"place #{index} has unknown keys: {sorted(unknown)}")
    name = entry.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"place #{index} needs a non-empty name")
    kind = entry.get("kind")
    if kind not in _VALID_KINDS:
        raise ValueError(f"place {name!r} has invalid kind {kind!r}")
    raw_aliases = entry.get("aliases")
    if not isinstance(raw_aliases, list) or not all(
        isinstance(alias, str) and alias.strip() for alias in raw_aliases
    ):
        raise ValueError(f"place {name!r} needs a list of non-empty aliases")
    place_id = entry.get("id", slugify(name))
    if not isinstance(place_id, str):
        raise ValueError(f"place {name!r} id must be a string")
    validate_slug(place_id)
    normalized_aliases = [normalize_alias(alias) for alias in raw_aliases]
    if len(set(normalized_aliases)) != len(normalized_aliases):
        raise ValueError(f"place {name!r} lists duplicate aliases after normalization")
    if normalize_alias(name) not in normalized_aliases:
        raise ValueError(f"place {name!r}: the name must itself be listed in aliases")
    osm_name = entry.get("osm", name)
    if not isinstance(osm_name, str) or not osm_name.strip():
        raise ValueError(f"place {name!r} osm must be a non-empty string when given")
    lat = entry.get("lat")
    lng = entry.get("lng")
    if (lat is None) != (lng is None):
        raise ValueError(f"place {name!r} must give lat and lng together or not at all")
    if lat is not None:
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            raise ValueError(f"place {name!r} lat/lng must be numbers")
        validate_coordinates(float(lat), float(lng))
    return CuratedPlace(
        id=place_id,
        name=name,
        kind=kind,
        aliases=tuple(raw_aliases),
        osm_name=osm_name,
        lat=None if lat is None else float(lat),
        lng=None if lng is None else float(lng),
    )


def load_curated_catalog(path: Path = DEFAULT_ALIASES_PATH) -> CuratedCatalog:
    """Load and validate aliases.yaml (schema v1) into a CuratedCatalog."""
    document = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("aliases catalog must be a YAML mapping")
    unknown = set(document) - _ALLOWED_TOP_KEYS
    if unknown:
        raise ValueError(f"aliases catalog has unknown keys: {sorted(unknown)}")
    if document.get("schema_version") != 1:
        raise ValueError("aliases catalog schema_version must be 1")
    attribution = document.get("attribution")
    if (
        not isinstance(attribution, str)
        or "openstreetmap" not in attribution.casefold()
        or "odbl" not in attribution.casefold()
    ):
        raise ValueError("attribution must credit OpenStreetMap contributors and ODbL")
    entries = document.get("places")
    if not isinstance(entries, list) or not entries:
        raise ValueError("aliases catalog needs a non-empty places list")
    places = [_parse_place(entry, index) for index, entry in enumerate(entries)]
    ids: dict[str, str] = {}
    for place in places:
        if place.id in ids:
            raise ValueError(f"duplicate place id {place.id!r}")
        ids[place.id] = place.name
    alias_owner: dict[str, str] = {}
    for place in places:
        for alias in place.aliases:
            key = normalize_alias(alias)
            owner = alias_owner.get(key)
            if owner is not None and owner != place.id:
                raise ValueError(
                    f"normalized alias {key!r} of place {place.id!r} collides with place {owner!r}"
                )
            alias_owner[key] = place.id
    return CuratedCatalog(places=tuple(places), attribution=attribution)
