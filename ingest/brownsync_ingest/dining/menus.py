"""Dining halls, hours and menus from Brown OIT's service bus.

**Dining was never actually blocked.** The recorded gap said
``dining.brown.edu`` answers a Pantheon-edge 403 to a declared UA — true, but
that is the marketing CMS, not the data. The menus live at::

    https://esb-level1.brown.edu/services/oit/sys/brown-dining/v1/menus

which answers 200, unauthenticated, ~520 KB of JSON: 7 locations, each with a
``meals`` map keyed by ISO date, each day a list of named services carrying
hours, stations, items, allergens and dietary icons.

**Why this is a daily job and not a proxy.** The endpoint sends *no*
``Access-Control-Allow-Origin`` header, which is the tell that an internal
enterprise bus is merely publicly reachable rather than published for browser
use. So it is fetched once a day, server-side, with a declared user agent, and
the result ships as a static artifact. Gate G4 in ``BROWNSYNC_V2_PLAN.md``
(OIT acknowledgment) is still open; ``enabled=false`` is the answer if they
object.

**Summer is not an outage.** Four of the seven locations legitimately carry
zero meals out of term. Gates therefore floor the number of locations and the
number of *open* locations, never require a specific hall to be serving.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

FIXTURE = (
    Path(__file__).resolve().parents[2] / "fixtures" / "recorded" / "dining" / "menus.json"
)

#: ESB `locationId` → seeded `places.ndjson` id.
#:
#: Explicit rather than fuzzy-matched: there are seven rows, they change about
#: never, and a wrong guess here puts the Ratty's menu on the Blue Room. Any
#: id NOT in this table fails a gate rather than being dropped, so a new hall
#: is a loud failure instead of a silent omission.
LOCATION_PLACES: dict[str, str] = {
    "AC": "andrews-commons",
    "BR": "blue-room",
    "IVY": "ivy-room",
    "JOS": "josiahs",
    "SHRP": "sharpe-refectory",
    "VW": "verney-woolley-dining-hall",
    # The ESB calls it "School of Engineering"; the café is inside the
    # Engineering Research Center at 184 Hope St.
    "SOE": "engineering-research-center",
}

#: Dietary icon codes the source emits, expanded for display.
ICON_LABELS: dict[str, str] = {
    "VGN": "Vegan",
    "VGTN": "Vegetarian",
    "HL": "Halal",
    "SO": "Sustainable",
}

#: Allergen vocabulary observed in the recording. An unknown allergen is kept
#: verbatim (never dropped) — silently swallowing one is a safety problem.
KNOWN_ALLERGENS: frozenset[str] = frozenset(
    {
        "ALCOHOL",
        "COCONUT",
        "DAIRY",
        "EGG",
        "FISH",
        "SESAME",
        "SHELLFISH",
        "SOY",
        "TREE NUTS",
        "WHEAT/GLUTEN",
    }
)


@dataclass(frozen=True)
class MenuItem:
    name: str
    allergens: tuple[str, ...]
    icons: tuple[str, ...]
    description: str | None


@dataclass(frozen=True)
class Station:
    name: str
    items: tuple[MenuItem, ...]


@dataclass(frozen=True)
class Service:
    """One named service period on one day — "Lunch", "All Day"."""

    meal: str
    name: str
    date: str
    #: ISO-8601 WITH offset, exactly as the source gives it. Not normalized to
    #: UTC: these are wall-clock campus hours and the offset is the useful part.
    start: str | None
    end: str | None
    stations: tuple[Station, ...]

    @property
    def item_count(self) -> int:
        return sum(len(station.items) for station in self.stations)


@dataclass(frozen=True)
class Location:
    location_id: str
    name: str
    address: str | None
    place_id: str | None
    services: tuple[Service, ...]

    @property
    def is_open_somewhere(self) -> bool:
        return bool(self.services)


def load_menus(path: Path | None = None) -> list[dict[str, Any]]:
    source = path or FIXTURE
    with source.open(encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, list):
        raise ValueError(f"{source}: expected a list of locations, got {type(document).__name__}")
    return document


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _items(raw: Iterable[Mapping[str, Any]]) -> tuple[MenuItem, ...]:
    out: list[MenuItem] = []
    for entry in raw:
        name = _text(entry.get("item"))
        if name is None:
            continue
        allergens = tuple(
            sorted({str(a).strip().upper() for a in (entry.get("allergens") or []) if _text(a)})
        )
        icons = tuple(
            sorted({str(i).strip().upper() for i in (entry.get("icons") or []) if _text(i)})
        )
        out.append(
            MenuItem(
                name=name,
                allergens=allergens,
                icons=icons,
                description=_text(entry.get("description")),
            )
        )
    return tuple(out)


def _stations(raw: Iterable[Mapping[str, Any]]) -> tuple[Station, ...]:
    out: list[Station] = []
    for entry in raw:
        name = _text(entry.get("name"))
        items = _items(entry.get("items") or [])
        # A station with no items is a heading for something not served today.
        if name is None or not items:
            continue
        out.append(Station(name=name, items=items))
    return tuple(out)


def normalize(document: Sequence[Mapping[str, Any]]) -> tuple[list[Location], list[str]]:
    """ESB payload → locations with flattened, date-sorted services."""
    diagnostics: list[str] = []
    locations: list[Location] = []

    for entry in document:
        location_id = _text(entry.get("locationId"))
        name = _text(entry.get("name"))
        if location_id is None or name is None:
            diagnostics.append(f"skipped a location with no id/name: {entry!r:.80}")
            continue

        services: list[Service] = []
        for date, day_services in sorted((entry.get("meals") or {}).items()):
            for service in day_services or []:
                menu = service.get("menu") or {}
                hours = menu.get("hours") or {}
                stations = _stations(menu.get("stations") or [])
                if not stations:
                    continue
                services.append(
                    Service(
                        meal=_text(service.get("meal")) or "All Day",
                        name=_text(service.get("name")) or name,
                        # The service's own date is authoritative; the outer
                        # key is the index into the map, and they can differ
                        # across a midnight-spanning service.
                        date=_text(menu.get("date")) or date,
                        start=_text(hours.get("start")),
                        end=_text(hours.get("end")),
                        stations=stations,
                    )
                )

        place_id = LOCATION_PLACES.get(location_id)
        if place_id is None:
            diagnostics.append(f"{location_id} ({name}) has no seeded place mapping")
        locations.append(
            Location(
                location_id=location_id,
                name=name,
                address=_text(entry.get("locationAddress")),
                place_id=place_id,
                services=tuple(sorted(services, key=lambda s: (s.date, s.start or "", s.meal))),
            )
        )

    return sorted(locations, key=lambda loc: loc.location_id), diagnostics


def unknown_allergens(locations: Iterable[Location]) -> set[str]:
    found: set[str] = set()
    for location in locations:
        for service in location.services:
            for station in service.stations:
                for item in station.items:
                    found.update(item.allergens)
    return found - KNOWN_ALLERGENS


def build_document(locations: Sequence[Location], generated_at: str) -> dict[str, Any]:
    """The published artifact. Schema v1."""
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "attribution": "Brown University Dining Services via Brown OIT",
        "icon_labels": dict(sorted(ICON_LABELS.items())),
        "locations": [
            {
                "locationId": location.location_id,
                "name": location.name,
                "address": location.address,
                "placeId": location.place_id,
                "services": [
                    {
                        "date": service.date,
                        "meal": service.meal,
                        "name": service.name,
                        "start": service.start,
                        "end": service.end,
                        "stations": [
                            {
                                "name": station.name,
                                "items": [
                                    {
                                        "name": item.name,
                                        **(
                                            {"allergens": list(item.allergens)}
                                            if item.allergens
                                            else {}
                                        ),
                                        **({"icons": list(item.icons)} if item.icons else {}),
                                        **(
                                            {"description": item.description}
                                            if item.description
                                            else {}
                                        ),
                                    }
                                    for item in station.items
                                ],
                            }
                            for station in service.stations
                        ],
                    }
                    for service in location.services
                ],
            }
            for location in locations
        ],
    }


# -- job ---------------------------------------------------------------------

#: Seven locations is the whole estate. Fewer means the payload changed shape.
MIN_LOCATIONS = 7

#: At least one hall must actually be serving. Four are legitimately closed all
#: summer, so this cannot be "all seven" — but zero means the feed is dead.
MIN_OPEN_LOCATIONS = 1

#: Below this the payload is a husk: hours present, menus gone.
MIN_ITEMS = 200


@dataclass(frozen=True)
class DiningJobResult:
    locations: tuple[Location, ...]
    document: dict[str, Any]
    gate_failures: tuple[str, ...]
    published_count: int | None
    diagnostics: tuple[str, ...]


def run_dining_job(
    *,
    seeds_dir: Path | str,
    staging_root: Path | str,
    menus_path: Path | None = None,
    generated_at: str | None = None,
) -> DiningJobResult:
    """Build and publish ``dining_menus.json`` when every gate passes."""
    from brownsync_ingest.output import publish_json_document

    seeds_dir = Path(seeds_dir)
    locations, diagnostics = normalize(load_menus(menus_path))

    # GATES FIRST — same rule as the campus jobs.
    gate_failures: list[str] = []
    if len(locations) < MIN_LOCATIONS:
        gate_failures.append(f"locations: {len(locations)} < required {MIN_LOCATIONS}")

    open_count = sum(1 for location in locations if location.is_open_somewhere)
    if open_count < MIN_OPEN_LOCATIONS:
        gate_failures.append(
            f"open locations: {open_count} < required {MIN_OPEN_LOCATIONS} "
            "— every hall reports zero services, which is a dead feed, not a holiday"
        )

    items = sum(service.item_count for loc in locations for service in loc.services)
    if items < MIN_ITEMS:
        gate_failures.append(f"menu items: {items} < required {MIN_ITEMS}")

    unmapped = [loc.location_id for loc in locations if loc.place_id is None]
    if unmapped:
        gate_failures.append(
            f"unmapped location(s): {', '.join(unmapped)} — add them to LOCATION_PLACES "
            "rather than letting a hall drop off the map"
        )

    novel = unknown_allergens(locations)
    if novel:
        # Not a failure: an unrecognised allergen is still PUBLISHED verbatim.
        # Swallowing one would be the dangerous outcome; this just says so.
        diagnostics.append(f"allergen(s) outside the known vocabulary: {', '.join(sorted(novel))}")

    document: dict[str, Any] = {}
    published_count: int | None = None
    if not gate_failures:
        stamp = generated_at or datetime.now().astimezone().isoformat()
        document = build_document(locations, stamp)
        publish_json_document(
            document, seeds_dir / "dining_menus.json", Path(staging_root), compact=True
        )
        published_count = items

    return DiningJobResult(
        locations=tuple(locations),
        document=document,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
        diagnostics=tuple(diagnostics),
    )
