"""Poller-parity text helpers (mirror of ``services/poller/src/util.ts``).

The app lane's TS poller refreshes the LiveWhale bootstrap seeds and
upserts on ``(source, source_id)``; every text transformation feeding a
published field must therefore match the poller EXACTLY. This module
mirrors ``decodeEntities`` verbatim: the 14 named entities the Brown
feeds actually emit plus decimal/hex numeric references. Unlike
``html.unescape`` (which knows the full HTML5 table), an unknown named
entity is preserved verbatim — exactly as the poller leaves it.
"""

from __future__ import annotations

import re


# Field-for-field the poller's NAMED_ENTITIES table (util.ts).
NAMED_ENTITIES: dict[str, str] = {
    "amp": "&",
    "lt": "<",
    "gt": ">",
    "quot": '"',
    "apos": "'",
    "nbsp": " ",
    "ndash": "–",
    "mdash": "—",
    "lsquo": "‘",
    "rsquo": "’",
    "ldquo": "“",
    "rdquo": "”",
    "hellip": "…",
}

_DECIMAL = re.compile(r"&#(\d+);")
_HEXADECIMAL = re.compile(r"&#x([0-9a-f]+);", re.IGNORECASE)
_NAMED = re.compile(r"&([a-z]+);", re.IGNORECASE)


def decode_entities(text: str) -> str:
    """Decode the HTML entities LiveWhale/SIDEARM actually emit.

    Same three passes, same order, as the poller: decimal numeric, hex
    numeric, then the named table (case-insensitive lookup, unknown
    names preserved).
    """
    text = _DECIMAL.sub(lambda match: chr(int(match.group(1))), text)
    text = _HEXADECIMAL.sub(lambda match: chr(int(match.group(1), 16)), text)
    return _NAMED.sub(
        lambda match: NAMED_ENTITIES.get(match.group(1).lower(), match.group(0)),
        text,
    )
