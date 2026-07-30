"""Parse Brown Facilities' ``Aliases`` string and resolve a human map label.

The ArcGIS ``Active_Buildings_2_view`` layer carries three name-ish fields and
none of them is directly usable as a map label:

* ``Property_Name`` — populated 263/263, but **91 rows are address-shaped**
  ("Hope St 170", "Waterman St 118-120") and 5 carry a complex suffix after a
  colon ("Champlin: Pembroke Quad").
* ``Official_Name`` — populated **22/263** and ceremonial, visibly truncated at
  ~100 chars in the source. Never a label.
* ``Aliases`` — a semi-structured ``KEY: value; KEY: value`` string on 218/263
  rows. This is where the display names live.

Measured key vocabulary over the recorded fixture (263 rows)::

    DISPNAME 216   LEGACY 98   ALTADDRS 67   NICKNAME 45
    OCCUPANT 35    FORMER 32   ADDITION 1    DISPLAY NAME 1   <untagged> 2

Two properties of that data drive this module's shape:

1. **Keys repeat.** ``"DISPNAME: Cental Heat Plant; NICKNAME: Chp; NICKNAME:
   Physical Plant"`` is real. Parsing into a ``dict`` silently drops the second
   NICKNAME, so :func:`parse_aliases` returns an ordered list of pairs.
2. **Unknown keys are evidence of drift, not noise.** An unrecognized key is
   surfaced as a diagnostic and its value still becomes a searchable alias,
   rather than being dropped where nobody would notice the schema moved.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


#: Keys observed in the recorded fixture. ``DISPLAY NAME`` is a one-row variant
#: spelling of ``DISPNAME`` and is folded into it.
KNOWN_ALIAS_KEYS = frozenset(
    {
        "DISPNAME",
        "DISPLAY NAME",
        "NICKNAME",
        "ALTADDRS",
        "LEGACY",
        "FORMER",
        "OCCUPANT",
        "ADDITION",
    }
)

#: Keys whose values are display names for the building itself.
DISPLAY_KEYS = ("DISPNAME", "DISPLAY NAME")

#: Street-type tokens. A trailing number is an address ONLY when preceded by
#: one of these. Measured over the fixture, the token before a trailing number
#: is: St 74, Ave 5, No. 4, Dugout 4, Unit 2, Alley 1, Sq 1, Pavillion 1,
#: Lane 1 — so a bare ``\s\d+$`` regex would misclassify "New Pembroke No. 3",
#: "... Dugout 1" and "Eddy St 365 - Unit 1" as addresses. The allowlist is the
#: discriminator; the regex alone is not.
STREET_TYPES = frozenset(
    {
        "st",
        "street",
        "ave",
        "avenue",
        "rd",
        "road",
        "dr",
        "drive",
        "ln",
        "lane",
        "pl",
        "place",
        "ct",
        "court",
        "blvd",
        "boulevard",
        "ter",
        "terrace",
        "way",
        "sq",
        "square",
        "alley",
        "pkwy",
        "parkway",
        "hwy",
        "highway",
    }
)

_TRAILING_NUMBER = re.compile(r"^(?P<head>.+?)\s+(?P<num>\d+(?:-\d+)?)$")

#: Curated label overrides, keyed by ``Property_Code``.
#:
#: Facilities' own DISPNAME is authoritative for what a building is called, but
#: it is hand-entered and contains occasional typos that would ship as visible
#: errors on a public map. Overriding is a deliberate, reviewable act — add a
#: row here with the evidence, never "fix" it by reordering the precedence
#: rules for everyone.
#:
#: Each entry carries the ``Property_Name`` it is expected to apply to.
#: :func:`resolve_label` refuses an override whose expectation does not match
#: the row, because a mistyped Property_Code would otherwise relabel an
#: unrelated building and nothing downstream would notice. (This is not
#: hypothetical: the first draft of this table guessed 100255 for the Central
#: Heat Plant, which is actually "Waterman St 131".)
LABEL_OVERRIDES: dict[str, tuple[str, str]] = {
    # (expected Property_Name, override label)
    # DISPNAME reads "Cental Heat Plant"; Property_Name has the correct spelling.
    "100093": ("Central Heat Plant", "Central Heat Plant"),
}


@dataclass(frozen=True)
class AliasParse:
    """One row's parsed ``Aliases`` string."""

    pairs: tuple[tuple[str, str], ...]
    #: Human-readable notes: unknown keys, untagged segments. Never silent.
    diagnostics: tuple[str, ...] = ()

    def values(self, *keys: str) -> tuple[str, ...]:
        """Every value for ``keys``, in source order, deduped, non-empty."""
        wanted = {k.upper() for k in keys}
        out: list[str] = []
        for key, value in self.pairs:
            if key in wanted and value and value not in out:
                out.append(value)
        return tuple(out)


#: Alias keys as they appear inside a value when the source used the wrong
#: separator. Real row 100116 reads
#:   "DISPNAME: Stonewall House, ALT ADDRESS: 22 Benevolent"
#: — a comma where a semicolon belongs. Splitting only on ";" swallowed the
#: rest of the string into DISPNAME, and "Stonewall House, ALT ADDRESS: 22
#: Benevolent" shipped as a building label on a public map.
_EMBEDDED_KEY = re.compile(
    r",\s*(ALT\s*ADDRESS|ALTADDRS|DISPNAME|DISPLAY\s+NAME|NICKNAME|LEGACY|FORMER|OCCUPANT|ADDITION)\s*:",
    re.IGNORECASE,
)


def _split_embedded_keys(segment: str) -> list[str]:
    """Recover segments the source separated with "," instead of ";"."""
    parts: list[str] = []
    remainder = segment
    while True:
        match = _EMBEDDED_KEY.search(remainder)
        if not match:
            parts.append(remainder)
            return parts
        parts.append(remainder[: match.start()])
        remainder = remainder[match.start() + 1 :].lstrip()


def parse_aliases(raw: str | None) -> AliasParse:
    """Split ``"KEY: value; KEY: value"`` into ordered pairs.

    Splits on ``;`` then on the **first** ``:`` of each segment. A segment with
    no colon, or with an unrecognized key, is kept under ``<UNTAGGED>`` and
    reported — the value is still useful as a search alias even when we do not
    know what Facilities meant by it.
    """
    if not raw or not raw.strip():
        return AliasParse(pairs=())

    pairs: list[tuple[str, str]] = []
    diagnostics: list[str] = []
    segments: list[str] = []
    for chunk in raw.split(";"):
        recovered = _split_embedded_keys(chunk.strip())
        if len(recovered) > 1:
            diagnostics.append(
                f"segment used ',' instead of ';' before an alias key: {chunk.strip()!r}"
            )
        segments.extend(recovered)

    for segment in segments:
        segment = segment.strip().rstrip(",").strip()
        if not segment:
            continue
        if ":" not in segment:
            pairs.append(("<UNTAGGED>", segment))
            diagnostics.append(f"untagged alias segment: {segment!r}")
            continue
        key, value = segment.split(":", 1)
        key = key.strip().upper()
        value = value.strip()
        if not value:
            continue
        if key not in KNOWN_ALIAS_KEYS:
            diagnostics.append(f"unknown alias key {key!r} (value {value!r})")
            pairs.append(("<UNTAGGED>", value))
            continue
        # Fold the one-row "DISPLAY NAME" spelling into DISPNAME.
        pairs.append(("DISPNAME" if key == "DISPLAY NAME" else key, value))

    return AliasParse(pairs=tuple(pairs), diagnostics=tuple(diagnostics))


def is_address_shaped(name: str | None) -> bool:
    """True when ``name`` reads as a street address rather than a building name.

    Requires a trailing number AND a street-type token immediately before it,
    so "Hope St 170" is an address while "New Pembroke No. 3" is a name.
    """
    if not name:
        return False
    match = _TRAILING_NUMBER.match(name.strip())
    if not match:
        return False
    head_tokens = match.group("head").split()
    if not head_tokens:
        return False
    return head_tokens[-1].lower().strip(".,") in STREET_TYPES


def split_complex(name: str) -> tuple[str, str | None]:
    """Split ``"Champlin: Pembroke Quad"`` into ``("Champlin", "Pembroke Quad")``.

    Five rows use a colon to name the enclosing complex. The complex is worth
    keeping (it groups the Pembroke buildings) but does not belong in the label.
    """
    if ": " not in name:
        return name.strip(), None
    head, _, tail = name.partition(": ")
    head, tail = head.strip(), tail.strip()
    if not head or not tail:
        return name.strip(), None
    return head, tail


@dataclass(frozen=True)
class ResolvedLabel:
    """The chosen map label plus everything else worth searching."""

    label: str
    #: Which rung of the precedence ladder produced ``label`` (1 is best).
    rung: int
    #: Precedence rule name, for diagnostics and the resolution report.
    rule: str
    complex_name: str | None = None
    aliases: tuple[str, ...] = ()
    diagnostics: tuple[str, ...] = field(default_factory=tuple)


def resolve_label(
    *,
    property_code: str | None,
    property_name: str | None,
    official_name: str | None,
    address_line_1: str | None,
    property_abbr: str | None,
    parsed: AliasParse,
) -> ResolvedLabel:
    """Choose a map label, strictly by precedence, and collect every alias.

    Precedence, with the evidence for each rung:

    1. **DISPNAME** — Facilities' own display name, present on 216/263. It is
       usually friendlier than ``Property_Name`` ("Hope St 170" → "170 Hope",
       "Champlin: Pembroke Quad" → "Champlin Hall").
    2. **Property_Name**, when it is not address-shaped; the ``": complex"``
       suffix is split off.
    3. **NICKNAME** — colloquial ("Pitz", "Chp"). Only when 1 and 2 both fail.
    4. **Address_Line_1**.
    5. **Property_Abbr** — last resort, and the job gates on how often it is hit.

    ``Official_Name`` is never a label (22/263 coverage, ceremonial, truncated
    in the source) but always becomes an alias.
    """
    diagnostics: list[str] = list(parsed.diagnostics)

    display = parsed.values(*DISPLAY_KEYS)
    nicknames = parsed.values("NICKNAME")
    complex_name: str | None = None

    name_head: str | None = None
    if property_name:
        name_head, complex_name = split_complex(property_name)

    label: str | None = None
    rung = 0
    rule = ""

    override = LABEL_OVERRIDES.get(property_code or "")
    if override and override[0] != (property_name or "").strip():
        # The table names the building it expects. A mismatch means the code is
        # wrong or the source renamed the row — refuse rather than relabel a
        # different building, and say so loudly.
        diagnostics.append(
            f"LABEL_OVERRIDES[{property_code!r}] expects Property_Name "
            f"{override[0]!r} but the row is {property_name!r} — override IGNORED"
        )
        override = None

    if override:
        label, rung, rule = override[1], 0, "curated-override"
    elif display:
        label, rung, rule = display[0], 1, "dispname"
        if name_head and name_head != display[0] and _near_duplicate(name_head, display[0]):
            # Likely a typo on one side. Both stay searchable; flag for curation.
            diagnostics.append(
                f"DISPNAME {display[0]!r} and Property_Name {name_head!r} differ by "
                "1-2 characters — possible typo, consider a LABEL_OVERRIDES entry"
            )
    elif name_head and not is_address_shaped(name_head):
        label, rung, rule = name_head, 2, "property-name"
    elif nicknames:
        label, rung, rule = nicknames[0], 3, "nickname"
    elif address_line_1:
        label, rung, rule = address_line_1.strip(), 4, "address"
    elif name_head:
        # Address-shaped Property_Name beats a bare abbreviation.
        label, rung, rule = name_head, 4, "property-name-address"
    elif property_abbr:
        label, rung, rule = property_abbr.strip(), 5, "abbr"
    else:
        label, rung, rule = (property_code or "unknown"), 5, "property-code"
        diagnostics.append("no name of any kind; fell through to Property_Code")

    # Belt and braces: a raw "KEY:" fragment must never reach a map label, no
    # matter how the source malformed its separators.
    if _EMBEDDED_KEY.search(f",{label}") or re.search(r"\b[A-Z][A-Z ]{2,}:", label):
        diagnostics.append(f"label {label!r} still contains an alias key — falling back")
        fallback = name_head or address_line_1 or property_abbr or (property_code or "unknown")
        label, rung, rule = fallback, max(rung, 2), f"{rule}-key-stripped"

    # Everything nameable becomes a searchable alias — this is a free win for
    # the CAB place resolver and the command palette. 218 rows carry alias
    # strings the curated gazetteer has never seen.
    candidates: list[str] = []
    for value in (
        *display,
        name_head or "",
        property_name or "",
        official_name or "",
        *nicknames,
        *parsed.values("LEGACY", "FORMER", "OCCUPANT", "ADDITION", "ALTADDRS", "<UNTAGGED>"),
        address_line_1 or "",
        property_abbr or "",
    ):
        value = (value or "").strip()
        if value and value != label and value not in candidates:
            candidates.append(value)

    return ResolvedLabel(
        label=label,
        rung=rung,
        rule=rule,
        complex_name=complex_name,
        aliases=tuple(candidates),
        diagnostics=tuple(diagnostics),
    )


def _near_duplicate(a: str, b: str) -> bool:
    """True when two names differ by at most two single-character edits.

    Deliberately tiny: this only flags likely typos for human curation, it
    never decides anything. Uses a bounded Levenshtein — the strings are short
    building names, so the quadratic cost is irrelevant.
    """
    if abs(len(a) - len(b)) > 2:
        return False
    if a.lower() == b.lower():
        return False
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (ca.lower() != cb.lower()),
                )
            )
        previous = current
    return previous[-1] <= 2
