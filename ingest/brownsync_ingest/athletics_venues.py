"""Athletics home-venue mapping from the SIDEARM composite ICS (Task 8).

The recorded feed (``fixtures/recorded/athletics/calendar.ics``) shows that a
``Providence, R.I.`` LOCATION prefix does NOT imply a Brown home game:
Providence College's soccer venue "Chapey Field at Anderson Stadium" carries
the same prefix and appears only in ``... at Providence`` away games. A
location is therefore a **home-venue observation** only when all three
signals agree:

1. the LOCATION city prefix normalizes to ``Providence, R.I.``;
2. a venue segment follows the city; and
3. the SUMMARY is a SIDEARM home-style game (``... vs Opponent``, never
   ``... at Opponent``);

with an explicit blocklist of known non-Brown Providence venues so even a
hypothetical PC-hosted neutral "vs" game cannot leak in. Every excluded
location keeps a machine-readable reason — away games are excluded by rule,
never silently dropped.

The venue mapping sidecar (``db/seeds/athletics_venues.json``) follows plan
schema v1 exactly::

    {"schema_version": 1,
     "generated_at": "<UTC ISO>",
     "mappings": [{"source_name": "<SIDEARM venue>", "place_id": "<slug>"}]}

Its consumption by the TS poller is a declared cross-workstream dependency
(``reports/app_side_dependencies.md``); ingestion never claims the app side
reads it until a consumer test exists in the app lane.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import tempfile

from brownsync_ingest.gazetteer.aliases import (
    DEFAULT_ALIASES_PATH,
    load_curated_catalog,
    normalize_alias,
)


HOME_CITY_NORMALIZED = normalize_alias("Providence, R.I.")

# Venues observed in the recorded feed with a Providence prefix that belong
# to other institutions. "Chapey Field at Anderson Stadium" is Providence
# College's soccer stadium (the feed shows only "at Providence" games there).
NON_BROWN_PROVIDENCE_VENUES = frozenset({"Chapey Field at Anderson Stadium"})

# SIDEARM venue string -> canonical gazetteer place id. Covers every
# home-venue variant observed in the recorded feed plus the variants
# DATA_CONTRACT.md section 5 mandates (Brown Stadium, Meehan Auditorium,
# Pizzitola, OMAC, Stevenson-Pincince) so winter-season venues resolve the
# moment they appear.
VENUE_MAPPINGS: dict[str, str] = {
    "Brown Stadium": "brown-stadium",
    "Richard Gouse Field at Brown Stadium": "brown-stadium",
    "Meehan Auditorium": "meehan-auditorium",
    "Pizzitola": "pizzitola-sports-center",
    "Pizzitola Sports Center": "pizzitola-sports-center",
    "OMAC": "olney-margolies-athletic-center",
    "Olney-Margolies Athletic Center": "olney-margolies-athletic-center",
    "Stevenson-Pincince": "stevenson-pincince-field",
    "Stevenson-Pincince Field": "stevenson-pincince-field",
    "Goldberger Family Field": "goldberger-family-field",
    "Katherine Moran Coleman Aquatics Center": "coleman-aquatics-center",
}


def unfold_ics_lines(text: str) -> list[str]:
    """RFC 5545 unfolding: a line starting with space/tab continues the prior."""
    unfolded: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line[:1] in (" ", "\t") and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return unfolded


def unescape_ics_text(value: str) -> str:
    """RFC 5545 TEXT unescaping: ``\\,`` ``\\;`` ``\\n``/``\\N`` ``\\\\``."""
    out: list[str] = []
    index = 0
    while index < len(value):
        character = value[index]
        if character == "\\" and index + 1 < len(value):
            follower = value[index + 1]
            if follower in ",;\\":
                out.append(follower)
                index += 2
                continue
            if follower in "nN":
                out.append("\n")
                index += 2
                continue
        out.append(character)
        index += 1
    return "".join(out)


@dataclass(frozen=True)
class LocationObservation:
    """One event's LOCATION, classified by the home-venue rule."""

    summary: str
    location_raw: str  # unescaped LOCATION, byte-for-byte otherwise
    city: str | None  # "<City>, <State>" prefix when present
    venue: str | None  # venue segment after the city when present
    classification: str  # "home-venue" | "away-city" | "away-game" |
    #                      "non-brown-venue" | "city-only" | "tba" |
    #                      "no-location" | "unrecognized"


def _split_city_and_venue(location: str) -> tuple[str | None, str | None]:
    """Split ``City, St., Venue...`` into city prefix and venue remainder."""
    pieces = location.split(", ")
    if len(pieces) < 2:
        return None, None
    city = ", ".join(pieces[:2])
    venue = ", ".join(pieces[2:]) if len(pieces) > 2 else None
    return city, venue or None


def _is_home_summary(summary: str) -> bool:
    """SIDEARM convention: home games read ``vs``, away games read ``at``.

    The earliest marker wins so "Brown University Men's Soccer at Providence"
    is away even though an opponent name could contain "vs" later.
    """
    vs_index = summary.find(" vs ")
    at_index = summary.find(" at ")
    if vs_index == -1:
        return False
    return at_index == -1 or vs_index < at_index


def classify_location(summary: str, location: str) -> LocationObservation:
    stripped = location.strip()
    city, venue = _split_city_and_venue(stripped)

    def observation(classification: str) -> LocationObservation:
        return LocationObservation(
            summary=summary,
            location_raw=location,
            city=city,
            venue=venue,
            classification=classification,
        )

    if not stripped:
        return observation("no-location")
    if stripped.upper() == "TBA":
        return observation("tba")
    if city is None:
        return observation("unrecognized")
    if normalize_alias(city) != HOME_CITY_NORMALIZED:
        return observation("away-city")
    if venue is None:
        return observation("city-only")
    if venue in NON_BROWN_PROVIDENCE_VENUES:
        if _is_home_summary(summary):
            return observation("non-brown-venue")
        return observation("away-game")
    if not _is_home_summary(summary):
        return observation("away-game")
    return observation("home-venue")


def parse_location_observations(ics_text: str) -> list[LocationObservation]:
    """One classified observation per VEVENT in document order."""
    observations: list[LocationObservation] = []
    in_event = False
    summary = ""
    location = ""
    for line in unfold_ics_lines(ics_text):
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            in_event, summary, location = True, "", ""
        elif stripped == "END:VEVENT":
            if in_event:
                observations.append(classify_location(summary, location))
            in_event = False
        elif in_event and ":" in line:
            name, _, value = line.partition(":")
            name = name.split(";", 1)[0].upper()
            if name == "SUMMARY":
                summary = unescape_ics_text(value)
            elif name == "LOCATION":
                location = unescape_ics_text(value)
    return observations


def build_sidecar(*, generated_at: datetime | None = None) -> dict[str, object]:
    """The athletics sidecar document, plan schema v1, sorted by source_name."""
    moment = generated_at or datetime.now(UTC)
    if moment.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    timestamp = moment.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": 1,
        "generated_at": timestamp,
        "mappings": [
            {"source_name": source_name, "place_id": place_id}
            for source_name, place_id in sorted(VENUE_MAPPINGS.items())
        ],
    }


@dataclass(frozen=True)
class AthleticsVenuesJobResult:
    """Everything one run measured, produced, and decided."""

    observations: tuple[LocationObservation, ...]
    home_venues: tuple[str, ...]  # distinct, sorted
    exclusion_counts: tuple[tuple[str, int], ...]  # reason -> event count
    gate_failures: tuple[str, ...]  # empty means every gate passed
    published_count: int | None  # None: gates failed or dry run; file untouched


def _atomic_write_json(document: dict[str, object], destination: Path, staging_root: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=staging_root,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as staging_file:
            staging_path = Path(staging_file.name)
            json.dump(document, staging_file, indent=2, ensure_ascii=False, allow_nan=False)
            staging_file.write("\n")
            staging_file.flush()
            os.fsync(staging_file.fileno())
        os.replace(staging_path, destination)
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)


def run_athletics_venues_job(
    *,
    ics_path: Path | str,
    sidecar_path: Path | str | None,
    staging_root: Path | str | None,
    aliases_path: Path | None = None,
) -> AthleticsVenuesJobResult:
    """Classify the recorded feed; publish the sidecar only on green gates.

    ``sidecar_path=None`` is a dry run: gates are still evaluated but nothing
    is written. Gates fail closed: an observed home venue missing from
    ``VENUE_MAPPINGS`` or a mapping targeting an uncatalogued place id blocks
    publication, leaving any existing sidecar untouched.
    """
    text = Path(ics_path).read_text(encoding="utf-8")
    observations = parse_location_observations(text)
    home_venues = tuple(
        sorted({o.venue or "" for o in observations if o.classification == "home-venue"})
    )
    exclusion_counts = Counter(
        o.classification for o in observations if o.classification != "home-venue"
    )

    gate_failures: list[str] = []
    unmapped = [venue for venue in home_venues if venue not in VENUE_MAPPINGS]
    if unmapped:
        gate_failures.append(
            "unmapped-home-venue: " + ", ".join(unmapped)
        )
    catalog = load_curated_catalog(aliases_path or DEFAULT_ALIASES_PATH)
    catalog_ids = {place.id for place in catalog.places}
    unknown = sorted(
        {place_id for place_id in VENUE_MAPPINGS.values() if place_id not in catalog_ids}
    )
    if unknown:
        gate_failures.append("unknown-place-id: " + ", ".join(unknown))

    published_count: int | None = None
    if not gate_failures and sidecar_path is not None:
        if staging_root is None:
            raise ValueError("staging_root is required to publish the sidecar")
        document = build_sidecar()
        _atomic_write_json(document, Path(sidecar_path), Path(staging_root))
        published_count = len(document["mappings"])  # type: ignore[arg-type]

    return AthleticsVenuesJobResult(
        observations=tuple(observations),
        home_venues=home_venues,
        exclusion_counts=tuple(sorted(exclusion_counts.items())),
        gate_failures=tuple(gate_failures),
        published_count=published_count,
    )
