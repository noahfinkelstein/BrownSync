"""Poller-parity entity decoding (services/poller/src/util.ts).

The TS poller normalizes LiveWhale text with ``decodeEntities`` before
deriving titles, group keys, and tags. The bootstrap seeds must transform
text IDENTICALLY, so this module mirrors the poller's table exactly: the
14 named entities the feeds actually emit plus decimal/hex numeric
references — and, unlike ``html.unescape``, an UNKNOWN named entity is
preserved verbatim, exactly as the poller leaves it.
"""

from __future__ import annotations

from brownsync_ingest.common.text import decode_entities


class TestNamedEntities:
    def test_decodes_the_poller_named_table(self) -> None:
        assert decode_entities("Alumni &amp; Friends") == "Alumni & Friends"
        assert decode_entities("&lt;b&gt;") == "<b>"
        assert decode_entities("&quot;x&quot; &apos;y&apos;") == "\"x\" 'y'"
        assert decode_entities("a&nbsp;b") == "a b"
        assert decode_entities("1&ndash;2&mdash;3") == "1–2—3"
        assert decode_entities("&lsquo;a&rsquo; &ldquo;b&rdquo;") == (
            "‘a’ “b”"
        )
        assert decode_entities("more&hellip;") == "more…"

    def test_named_lookup_is_case_insensitive_like_the_poller(self) -> None:
        # the poller lowercases the name before its table lookup
        assert decode_entities("&AMP;") == "&"

    def test_unknown_named_entity_is_preserved_not_stripped(self) -> None:
        # html.unescape would decode &copy; — the poller does NOT: its
        # table has no entry, so the match is returned unchanged.
        assert decode_entities("&copy; 2026") == "&copy; 2026"
        assert decode_entities("&bogus;") == "&bogus;"


class TestNumericEntities:
    def test_decimal_references(self) -> None:
        assert decode_entities("It&#8217;s") == "It’s"

    def test_hexadecimal_references_either_case(self) -> None:
        assert decode_entities("&#x2014;") == "—"
        assert decode_entities("&#X2014;") == "—"

    def test_astral_code_points_round_trip(self) -> None:
        assert decode_entities("&#128640;") == "\U0001f680"


class TestPlainText:
    def test_text_without_entities_is_unchanged(self) -> None:
        assert decode_entities("Barus & Holley 168") == "Barus & Holley 168"

    def test_empty_string(self) -> None:
        assert decode_entities("") == ""
