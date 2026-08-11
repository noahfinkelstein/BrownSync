"""Live capture harness for recorded source evidence (Task 3).

Every request flows through :class:`CachedHttpClient`, so the exact
``BrownSync/1.0 (+<contact>)`` user agent, one-request-per-second-per-host
spacing, retry/backoff, and on-disk caching are enforced by production code.
Stored bodies are scrubbed of email addresses before hashing; the manifest at
``ingest/fixtures/manifest.json`` records route, request fingerprint,
retrieval time, SHA-256, and expected parser facts for every fixture, plus an
explicit ``gaps`` list for anything that could not be captured.

Run from ``ingest/``:

    uv run python -m brownsync_ingest.fixtures_capture --cache-dir <scratch>

``--groups`` (Task 8) restricts a run to named capture groups and MERGES the
fresh entries into the existing manifest: evidence for unselected groups is
preserved verbatim, while entries, gaps, and prefixed notes belonging to the
selected groups are replaced by the new run.

Only ``main`` performs live network access; importing this module is safe and
``tests/test_fixtures_capture_athletics.py`` exercises the offline pieces.
The fixture integrity gate lives in ``tests/test_fixtures.py``.
"""
from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, Callable
from urllib.parse import quote, urlencode, urljoin

from bs4 import BeautifulSoup
import httpx
from pydantic import JsonValue

from brownsync_ingest.athletics_venues import unfold_ics_lines as _unfold_ics
from brownsync_ingest.common.http import CachedHttpClient, _normalized_url

DEFAULT_CONTACT = "noah_finkelstein@brown.edu"
SCRUB_PLACEHOLDER = "scrubbed@example.invalid"
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
NON_EMAIL_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".js", ".css", ".map", ".woff", ".woff2")
REDIRECT_STATUSES = {301, 302, 303, 307, 308}

CAB_BASE = "https://cab.brown.edu/"
CAB_API = "https://cab.brown.edu/api/"
CLUBS_UNDERGRAD = "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups"
LIVEWHALE_EVENTS = "https://events.brown.edu/live/json/events"
LIVEWHALE_GROUPS = "https://events.brown.edu/live/json/groups"
OVERPASS = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = (
    '[out:json][timeout:60]; ( way["building"](41.820,-71.410,41.834,-71.393); '
    'relation["building"](41.820,-71.410,41.834,-71.393); ); out body geom;'
)
DINING_LANDING = "https://dining.brown.edu/"
#: Brown OIT's enterprise service bus. Publicly reachable and unauthenticated,
#: but it is an INTERNAL bus that happens to be exposed — it sends no CORS
#: header, which is the tell that it was never meant for browser use. Hence a
#: once-a-day server-side job with a declared UA, never a per-request proxy.
#: See gate G4 in BROWNSYNC_V2_PLAN.md — OIT acknowledgment is still pending.
DINING_MENUS = "https://esb-level1.brown.edu/services/oit/sys/brown-dining/v1/menus"
ATHLETICS_ICS = "https://brownbears.com/calendar.ashx/calendar.ics"

CAB_SEARCH_SUBJECTS = ("CSCI", "ENGN", "HIST")
CAB_DETAIL_TARGET = 24


def scrub(body: bytes) -> tuple[bytes, bool]:
    """Replace every email-like string (except asset names) with a placeholder.

    When a match immediately follows a backslash and begins with an escape
    letter (as in JSON text ``<br \\/>\\nperson@brown.edu``, where the regex
    match starts at the ``n`` of ``\\n``), the leading letter is preserved so
    the scrub never corrupts an escape sequence in the stored body.
    """
    text = body.decode("utf-8", errors="surrogateescape")

    def replacement(match: re.Match[str]) -> str:
        value = match.group(0)
        if value == SCRUB_PLACEHOLDER or value.lower().endswith(NON_EMAIL_SUFFIXES):
            return value
        start = match.start()
        if start > 0 and text[start - 1] == "\\" and value[0] in "ntrbfu":
            return value[0] + SCRUB_PLACEHOLDER
        return SCRUB_PLACEHOLDER

    scrubbed = EMAIL.sub(replacement, text)
    return scrubbed.encode("utf-8", errors="surrogateescape"), scrubbed != text


class CaptureBlockedError(RuntimeError):
    """Raised when a source answers with a bot challenge or non-200 status.

    Bot-detection challenges (e.g. AWS WAF ``x-amzn-waf-action: challenge``)
    are never bypassed and their pages are never stored as fixtures; the
    source is recorded as an explicit gap instead.
    """


class _TimeoutTransport(httpx.BaseTransport):
    """Default HTTP transport with a generous read timeout for slow endpoints."""

    def __init__(self, timeout_seconds: float) -> None:
        self._inner = httpx.HTTPTransport()
        self._timeout = httpx.Timeout(timeout_seconds, connect=30.0)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        request.extensions = dict(request.extensions)
        request.extensions["timeout"] = self._timeout.as_dict()
        return self._inner.handle_request(request)


class CaptureSession:
    def __init__(self, *, contact_email: str, fixtures_root: Path, cache_dir: Path) -> None:
        self.client = CachedHttpClient(
            contact_email=contact_email,
            cache_dir=cache_dir,
            transport=_TimeoutTransport(timeout_seconds=120.0),
        )
        self.user_agent = f"BrownSync/1.0 (+{contact_email})"
        self.fixtures_root = fixtures_root
        self.entries: list[dict[str, Any]] = []
        self.gaps: list[dict[str, str]] = []
        self.notes: list[str] = []

    # -- transport helpers ---------------------------------------------------

    def fetch(
        self,
        method: str,
        url: str,
        *,
        json_body: JsonValue | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
        max_age_seconds: float | None = None,
    ) -> tuple[httpx.Response, str]:
        """Fetch through the cached client, following up to five redirects.

        Returns the successful response and the final URL that produced it.
        """
        current_method, current_url = method, url
        for _ in range(6):
            try:
                response = self.client.request(
                    current_method,
                    current_url,
                    json_body=json_body,
                    content=content,
                    headers=headers,
                    max_age_seconds=max_age_seconds,
                )
                return response, current_url
            except httpx.HTTPStatusError as error:
                status = error.response.status_code
                location = error.response.headers.get("location")
                if status not in REDIRECT_STATUSES or not location:
                    raise
                current_url = urljoin(current_url, location)
                if status == 303:
                    current_method, json_body, content = "GET", None, None
        raise RuntimeError(f"too many redirects for {url}")

    def _fingerprint(
        self,
        method: str,
        url: str,
        *,
        json_body: JsonValue | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> str:
        """Mirror the client's cache identity for the manifest.

        Uses the client's private identity helper on purpose: the fingerprint
        recorded in the manifest must be the one the production cache would
        compute for the same request.
        """
        request_headers = {name: value for name, value in (headers or {}).items() if name.lower() != "user-agent"}
        request_headers["User-Agent"] = self.user_agent
        body = content
        if json_body is not None:
            body = json.dumps(
                json_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
            ).encode()
            request_headers.setdefault("Content-Type", "application/json")
        return self.client._fingerprint(method.upper(), _normalized_url(url), body, request_headers)

    # -- recording -----------------------------------------------------------

    def capture(
        self,
        *,
        source: str,
        relpath: str,
        method: str,
        url: str,
        json_body: JsonValue | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
        request_body_display: Any = None,
        max_age_seconds: float | None = None,
        pre_scrub: Callable[[bytes], bytes] | None = None,
        expected: Callable[[bytes], dict[str, Any]],
    ) -> bytes:
        response, final_url = self.fetch(
            method, url, json_body=json_body, content=content, headers=headers, max_age_seconds=max_age_seconds
        )
        waf_action = response.headers.get("x-amzn-waf-action")
        challenge_202 = response.status_code == 202 and (not response.content or b"awsWaf" in response.content)
        if waf_action is not None or challenge_202:
            raise CaptureBlockedError(
                f"{final_url} answered with a bot challenge (status {response.status_code}, "
                f"x-amzn-waf-action={waf_action!r}); bypassing bot-detection is not permitted, "
                "so no fixture was recorded"
            )
        if response.status_code != 200:
            raise CaptureBlockedError(
                f"{final_url} answered {response.status_code}; only plain 200 responses are recorded as fixtures"
            )
        transformed = pre_scrub(response.content) if pre_scrub is not None else response.content
        stored, was_scrubbed = scrub(transformed)
        was_scrubbed = was_scrubbed or transformed != response.content
        display_body = request_body_display
        if display_body is None and json_body is not None:
            display_body = json_body
        # Build the complete manifest entry BEFORE any bytes land on disk so a
        # failing fact-builder can never leave an unmanifested fixture behind.
        entry = {
            "path": relpath,
            "source": source,
            "route": f"{method.upper()} {_normalized_url(final_url)}",
            "request_body": display_body,
            "request_fingerprint": self._fingerprint(
                method, final_url, json_body=json_body, content=content, headers=headers
            ),
            "retrieved_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "status": response.status_code,
            "content_type": response.headers.get("content-type", "unknown"),
            "sha256": hashlib.sha256(stored).hexdigest(),
            "bytes": len(stored),
            "scrubbed": was_scrubbed,
            "expected": expected(stored),
        }
        destination = self.fixtures_root / relpath
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(stored)
        self.entries.append(entry)
        print(f"  captured {source}: {relpath} ({len(stored)} bytes)")
        return stored

    def gap(self, source: str, reason: str) -> None:
        # Keep reasons single-line and free of library boilerplate.
        reason = " ".join(reason.split("\nFor more information")[0].split())
        print(f"  GAP {source}: {reason}", file=sys.stderr)
        self.gaps.append({"source": source, "reason": reason})

    def note(self, text: str) -> None:
        self.notes.append(text)

    def write_manifest(self) -> Path:
        manifest = {
            "schema_version": 1,
            "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "recorded_user_agent": self.user_agent,
            "notes": self.notes,
            "gaps": self.gaps,
            "fixtures": sorted(self.entries, key=lambda entry: entry["path"]),
        }
        destination = self.fixtures_root / "manifest.json"
        destination.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return destination


# -- expected-fact builders ------------------------------------------------


def _text(body: bytes) -> str:
    return body.decode("utf-8", errors="replace")


def _json_facts(body: bytes) -> Any:
    return json.loads(body.decode("utf-8"))


# -- CAB -------------------------------------------------------------------


def capture_cab(session: CaptureSession) -> None:
    home = session.capture(
        source="cab_home",
        relpath="recorded/cab/home.html",
        method="GET",
        url=CAB_BASE,
        expected=_cab_home_expected,
    )
    soup = BeautifulSoup(_text(home), "html.parser")
    srcdb = _find_fall_2026_srcdb(soup, _text(home))
    if srcdb is None:
        session.gap("cab_search", "Fall 2026 srcdb could not be discovered from the CAB home document")
        session.gap("cab_details", "no srcdb discovered, so no search results to expand")
        return
    session.note(f"Fall 2026 srcdb discovered from the CAB home document: {srcdb}")

    bootstrap_url = _find_bootstrap_url(soup, _text(home))
    if bootstrap_url is None:
        session.note(
            "cab_bootstrap: no separate bootstrap JSON endpoint is referenced by the home document; "
            "term options are embedded in the home HTML itself"
        )
    else:
        session.capture(
            source="cab_bootstrap",
            relpath="recorded/cab/bootstrap.json",
            method="GET",
            url=bootstrap_url,
            expected=lambda body: {"body_contains": [srcdb]},
        )

    results: list[dict[str, Any]] = []
    for subject in CAB_SEARCH_SUBJECTS:
        payload: JsonValue = {
            "other": {"srcdb": srcdb},
            "criteria": [
                {"field": "subject", "value": subject},
                {"field": "is_ind_study", "value": "N"},
                {"field": "is_canc", "value": "N"},
            ],
        }
        body = session.capture(
            source="cab_search",
            relpath=f"recorded/cab/search-{subject.lower()}.json",
            method="POST",
            url=f"{CAB_API}?page=fose&route=search",
            json_body=payload,
            expected=_cab_search_expected,
        )
        parsed = _json_facts(body)
        results.extend(parsed.get("results", []))

    selected = _select_diverse_sections(results, CAB_DETAIL_TARGET)
    if len(selected) < 20:
        session.gap(
            "cab_details",
            f"only {len(selected)} distinct sections were available across subjects {CAB_SEARCH_SUBJECTS}",
        )
    for section in selected:
        crn = section["crn"]
        payload = {
            "group": "code:" + section["code"],
            "key": "crn:" + crn,
            "srcdb": srcdb,
            "matched": "crn:" + crn,
        }
        session.capture(
            source="cab_details",
            relpath=f"recorded/cab/details/{srcdb}-{crn}.json",
            method="POST",
            url=f"{CAB_API}?page=fose&route=details",
            json_body=payload,
            expected=_cab_detail_expected,
        )


def _cab_home_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    facts: dict[str, Any] = {"body_contains": ["Fall 2026"]}
    soup = BeautifulSoup(text, "html.parser")
    srcdb = _find_fall_2026_srcdb(soup, text)
    if srcdb is not None:
        facts["fall_2026_srcdb"] = srcdb
        facts["body_contains"].append(srcdb)
    return facts


def _find_fall_2026_srcdb(soup: BeautifulSoup, text: str) -> str | None:
    for option in soup.find_all("option"):
        label = option.get_text(strip=True)
        value = option.get("value")
        if value and "fall 2026" in label.lower():
            return str(value)
    match = re.search(r'\{[^{}]*"srcdb"\s*:\s*"([^"]+)"[^{}]*Fall\s*2026[^{}]*\}', text)
    if match:
        return match.group(1)
    match = re.search(r'Fall\s*2026[^{}]*?"srcdb"\s*:\s*"([^"]+)"', text)
    if match:
        return match.group(1)
    return None


def _find_bootstrap_url(soup: BeautifulSoup, text: str) -> str | None:
    for script in soup.find_all("script", src=True):
        src = str(script["src"])
        if "bootstrap" in src.lower() and "fose" in src.lower():
            return urljoin(CAB_BASE, src)
    match = re.search(r'["\']([^"\']*route=bootstrap[^"\']*)["\']', text)
    if match:
        return urljoin(CAB_BASE, match.group(1))
    return None


def _cab_search_expected(body: bytes) -> dict[str, Any]:
    parsed = _json_facts(body)
    results = parsed.get("results", [])
    facts: dict[str, Any] = {
        "result_count": len(results),
        "srcdb": parsed.get("srcdb"),
        "body_contains": ['"results"'],
    }
    if results:
        sample = results[0]
        facts["sample_crn"] = sample.get("crn")
        facts["sample_code"] = sample.get("code")
        facts["body_contains"].extend(value for value in (sample.get("crn"), sample.get("code")) if value)
    return facts


def _cab_detail_expected(body: bytes) -> dict[str, Any]:
    parsed = _json_facts(body)
    facts: dict[str, Any] = {
        "crn": parsed.get("crn"),
        "code": parsed.get("code"),
        "srcdb": parsed.get("srcdb"),
        "has_meeting_html": bool(parsed.get("meeting_html")),
        "has_instructordetail_html": bool(parsed.get("instructordetail_html")),
        "body_contains": [value for value in (parsed.get("crn"), parsed.get("code")) if value] or ['"crn"'],
    }
    return facts


def _select_diverse_sections(results: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    """Pick up to ``target`` sections spread across distinct meeting patterns."""
    by_crn: dict[str, dict[str, Any]] = {}
    for result in results:
        crn, code = result.get("crn"), result.get("code")
        if crn and code and crn not in by_crn:
            by_crn[crn] = result
    groups: dict[str, list[dict[str, Any]]] = {}
    for result in by_crn.values():
        groups.setdefault(str(result.get("meets", "")), []).append(result)
    selected: list[dict[str, Any]] = []
    buckets = sorted(groups.values(), key=lambda bucket: str(bucket[0].get("meets", "")))
    index = 0
    while len(selected) < target and any(buckets):
        bucket = buckets[index % len(buckets)]
        if bucket:
            selected.append(bucket.pop(0))
        index += 1
        if index > 10_000:
            break
    return selected


# -- clubs -----------------------------------------------------------------


def capture_clubs(session: CaptureSession) -> None:
    first = session.capture(
        source="clubs_undergraduate",
        relpath="recorded/clubs/undergraduate-page-00.html",
        method="GET",
        url=CLUBS_UNDERGRAD,
        expected=_clubs_expected,
    )
    soup = BeautifulSoup(_text(first), "html.parser")
    last_page = _drupal_last_page(soup)
    for page in range(1, last_page + 1):
        session.capture(
            source="clubs_undergraduate",
            relpath=f"recorded/clubs/undergraduate-page-{page:02d}.html",
            method="GET",
            url=f"{CLUBS_UNDERGRAD}?page={page}",
            expected=_clubs_expected,
        )
    session.note(f"clubs_undergraduate: captured pages 0..{last_page} of the Drupal pager")

    graduate_url = _find_graduate_url(soup)
    if graduate_url is None:
        session.gap("clubs_graduate", "no graduate student groups link discovered on the undergraduate directory")
        return
    try:
        grad_first = session.capture(
            source="clubs_graduate",
            relpath="recorded/clubs/graduate-page-00.html",
            method="GET",
            url=graduate_url,
            expected=_clubs_expected,
        )
    except httpx.HTTPError as error:
        session.gap("clubs_graduate", f"graduate directory fetch failed after retries: {error}")
        return
    grad_soup = BeautifulSoup(_text(grad_first), "html.parser")
    grad_last = _drupal_last_page(grad_soup)
    for page in range(1, grad_last + 1):
        session.capture(
            source="clubs_graduate",
            relpath=f"recorded/clubs/graduate-page-{page:02d}.html",
            method="GET",
            url=f"{graduate_url}?page={page}",
            expected=_clubs_expected,
        )


def _clubs_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    soup = BeautifulSoup(text, "html.parser")
    rows = soup.select(".views-row")
    facts: dict[str, Any] = {"views_rows": len(rows), "body_contains": ["Student Groups"]}
    if rows:
        heading = rows[0].find(["h2", "h3", "h4", "a"])
        if heading is not None:
            sample = heading.get_text(strip=True)
            if sample and sample in text:
                facts["sample_group"] = sample
                facts["body_contains"].append(sample)
    return facts


def _drupal_last_page(soup: BeautifulSoup) -> int:
    last = 0
    for anchor in soup.select("a[href*='page=']"):
        match = re.search(r"[?&]page=(\d+)", str(anchor.get("href", "")))
        if match:
            last = max(last, int(match.group(1)))
    return last


def _find_graduate_url(soup: BeautifulSoup) -> str | None:
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"])
        text = anchor.get_text(" ", strip=True).lower()
        if "graduate" in href.lower() and "group" in href.lower():
            return urljoin(CLUBS_UNDERGRAD, href)
        if "graduate student groups" in text:
            return urljoin(CLUBS_UNDERGRAD, href)
    return None


# -- LiveWhale -------------------------------------------------------------

_CONTACT_INFO_VALUE = re.compile(r'("contact_info"\s*:\s*)"(?:[^"\\]|\\.)*"')


def _scrub_livewhale_contact_info(body: bytes) -> bytes:
    """Blank contact_info values: they carry staff names/titles/phones, and no
    contract field consumes them."""
    text = body.decode("utf-8", errors="surrogateescape")
    replaced = _CONTACT_INFO_VALUE.sub(r'\1"[contact scrubbed]"', text)
    return replaced.encode("utf-8", errors="surrogateescape")


def capture_livewhale(session: CaptureSession) -> None:
    session.capture(
        source="livewhale_events",
        relpath="recorded/livewhale/events.json",
        method="GET",
        url=f"{LIVEWHALE_EVENTS}?max=200",
        max_age_seconds=600.0,
        pre_scrub=_scrub_livewhale_contact_info,
        expected=_livewhale_events_expected,
    )
    session.note(
        "livewhale_events: contact_info values are blanked at capture — they hold staff names/titles and "
        "no contract field consumes them"
    )
    event_count = session.entries[-1]["expected"].get("event_count")
    if event_count is not None and event_count != 200:
        session.note(
            f"livewhale_events: the '?max=200' parameter was not honored — the endpoint returned {event_count} events"
        )
    try:
        session.capture(
            source="livewhale_groups",
            relpath="recorded/livewhale/groups.json",
            method="GET",
            url=LIVEWHALE_GROUPS,
            max_age_seconds=600.0,
            expected=_livewhale_groups_expected,
        )
    except httpx.HTTPError as error:
        session.gap("livewhale_groups", f"LiveWhale groups listing fetch failed after retries: {error}")


def _livewhale_events_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    try:
        parsed = _json_facts(body)
        strict_json = True
    except json.JSONDecodeError:
        parsed = None
        strict_json = False
    facts: dict[str, Any] = {"strict_json": strict_json, "body_contains": ['"title"']}
    if strict_json:
        events = parsed if isinstance(parsed, list) else parsed.get("events", [])
        facts["event_count"] = len(events)
        for event in events:
            title = event.get("title") if isinstance(event, dict) else None
            if isinstance(title, str) and title and title in text:
                facts["sample_title"] = title
                facts["body_contains"].append(title)
                break
        if events and isinstance(events[0], dict):
            facts["first_event_fields"] = sorted(
                key
                for key in events[0]
                if key in {"title", "location_latitude", "location_longitude", "group", "is_canceled", "repeats", "event_types"}
            )
    else:
        facts["title_key_occurrences"] = text.count('"title"')
    return facts


def _livewhale_groups_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    try:
        parsed = _json_facts(body)
        strict_json = True
    except json.JSONDecodeError:
        parsed = None
        strict_json = False
    facts: dict[str, Any] = {"strict_json": strict_json, "body_contains": ["{"]}
    if strict_json:
        groups = parsed if isinstance(parsed, list) else parsed.get("groups", [])
        facts["group_count"] = len(groups)
        for group in groups:
            if not isinstance(group, dict):
                continue
            name = group.get("title") or group.get("fullname") or group.get("name")
            if isinstance(name, str) and name and name in text:
                facts["sample_group"] = name
                facts["body_contains"] = ['"title"', name]
                break
        if groups and isinstance(groups[0], dict):
            facts["first_group_fields"] = sorted(
                key for key in groups[0] if key in {"id", "title", "fullname", "web_address", "timezone"}
            )
    else:
        facts["title_key_occurrences"] = text.count('"title"')
    return facts


# -- Overpass --------------------------------------------------------------


def capture_overpass(session: CaptureSession) -> None:
    session.capture(
        source="overpass_buildings",
        relpath="recorded/overpass/college-hill-buildings.json",
        method="POST",
        url=OVERPASS,
        content=urlencode({"data": OVERPASS_QUERY}).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        request_body_display=OVERPASS_QUERY,
        expected=_overpass_expected,
    )
    session.note("overpass_buildings: OpenStreetMap data, ODbL licence — attribute OpenStreetMap contributors")


def _overpass_expected(body: bytes) -> dict[str, Any]:
    parsed = _json_facts(body)
    elements = parsed.get("elements", [])
    ways = sum(1 for element in elements if element.get("type") == "way")
    relations = sum(1 for element in elements if element.get("type") == "relation")
    facts: dict[str, Any] = {
        "element_count": len(elements),
        "way_count": ways,
        "relation_count": relations,
        "body_contains": ['"elements"'],
    }
    text = _text(body)
    for wanted in ("Sayles Hall", "Barus"):
        if wanted in text:
            facts["body_contains"].append(wanted)
    named = next(
        (element.get("tags", {}).get("name") for element in elements if element.get("tags", {}).get("name")),
        None,
    )
    if named and named in text:
        facts["sample_building_name"] = named
    return facts


# -- dining ----------------------------------------------------------------


def capture_dining(session: CaptureSession) -> None:
    """Record the OIT dining API, and the marketing site only if it answers.

    The marketing site (`dining.brown.edu`) sits behind a Pantheon edge that
    answers 403 to a declared UA. That was previously recorded as the reason
    dining was blocked outright — but the 403 is on the CMS, not the data.
    The menus themselves come from OIT's service bus and answer 200 with no
    auth, so dining is a real source and the block was scoped too widely.
    """
    session.capture(
        source="dining_menus",
        relpath="recorded/dining/menus.json",
        method="GET",
        url=DINING_MENUS,
        expected=_dining_expected,
    )
    session.note(
        "dining_menus: Brown OIT ESB, public and unauthenticated but CORS-less — "
        "one request per day from a server-side job, never proxied per visitor. "
        "Gate G4 (OIT acknowledgment) is still open."
    )
    try:
        landing = session.capture(
            source="dining_landing",
            relpath="recorded/dining/landing.html",
            method="GET",
            url=DINING_LANDING,
            expected=lambda body: {"body_contains": ["Dining"]},
        )
    except Exception as error:  # noqa: BLE001
        # Expected: the Pantheon edge 403s a declared UA. Not fatal any more —
        # the menus are already recorded above. Both sources must be declared:
        # the bundles are only discoverable FROM the landing page, so an
        # un-gapped `dining_bundle` would read as a silent absence.
        session.gap("dining_landing", f"{type(error).__name__}: {error}")
        session.gap("dining_bundle", "unreachable: bundles are discovered from the landing page, which is blocked")
        return
    soup = BeautifulSoup(_text(landing), "html.parser")
    bundles = _find_dining_bundles(soup)
    if not bundles:
        session.gap("dining_bundle", "no same-site script/config bundles referenced by the dining landing page")
        return
    for index, bundle_url in enumerate(bundles[:3]):
        name = re.sub(r"[^A-Za-z0-9._-]", "-", bundle_url.rsplit("/", 1)[-1].split("?")[0]) or f"bundle-{index}"
        try:
            session.capture(
                source="dining_bundle",
                relpath=f"recorded/dining/bundle-{index:02d}-{name}",
                method="GET",
                url=bundle_url,
                expected=lambda body: {"body_contains": [_text(body)[:16] or " "]},
            )
        except httpx.HTTPError as error:
            session.gap("dining_bundle", f"bundle fetch failed after retries: {bundle_url}: {error}")


def _dining_expected(body: bytes) -> dict[str, Any]:
    parsed = _json_facts(body)
    locations = parsed if isinstance(parsed, list) else []
    dated = {
        day
        for location in locations
        for day in (location.get("meals") or {})
    }
    return {
        "location_count": len(locations),
        "location_ids": sorted(str(location.get("locationId")) for location in locations),
        "dated_menu_days": len(dated),
        # Locations close for the summer, so per-location meal counts move.
        # The ids and the envelope shape are the stable facts.
        "body_contains": ['"locationId"', '"stations"', '"allergens"'],
    }


def _find_dining_bundles(soup: BeautifulSoup) -> list[str]:
    candidates: list[str] = []
    for script in soup.find_all("script", src=True):
        src = urljoin(DINING_LANDING, str(script["src"]))
        if "brown.edu" not in src:
            continue
        lowered = src.lower()
        if any(token in lowered for token in ("app", "main", "bundle", "config", "settings", "drupal", "menu", "dining")):
            candidates.append(src)
    seen: set[str] = set()
    unique = []
    for src in candidates:
        if src not in seen:
            seen.add(src)
            unique.append(src)
    return unique


# -- athletics -------------------------------------------------------------


def capture_athletics(session: CaptureSession) -> None:
    session.capture(
        source="athletics_ics",
        relpath="recorded/athletics/calendar.ics",
        method="GET",
        url=ATHLETICS_ICS,
        expected=_athletics_ics_expected,
    )
    session.note(
        "athletics_ics: robots.txt asks Crawl-delay 30 and the feed advertises X-PUBLISHED-TTL PT120M — "
        "poll no more often than every 2 hours (probe: reports/sdd/brownsync-ingestion/athletics-probe.md)"
    )


def _athletics_ics_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    lines = _unfold_ics(text)
    locations = {line[len("LOCATION:") :] for line in lines if line.startswith("LOCATION:")}
    facts: dict[str, Any] = {
        "vevent_count": sum(1 for line in lines if line.strip() == "BEGIN:VEVENT"),
        "distinct_location_count": len(locations),
        "body_contains": ["BEGIN:VCALENDAR"],
    }
    for prefix, key in (("X-WR-CALNAME:", "calendar_name"), ("X-PUBLISHED-TTL:", "published_ttl")):
        for line in lines:
            if line.startswith(prefix):
                facts[key] = line[len(prefix) :].strip()
                if prefix + facts[key] in text:
                    facts["body_contains"].append(prefix + facts[key])
                break
    sample = next(
        (line[len("SUMMARY:") :] for line in lines if line.startswith("SUMMARY:")), None
    )
    if sample and sample in text:
        facts["sample_summary"] = sample
        facts["body_contains"].append(sample)
    return facts


# -- arcgis ----------------------------------------------------------------

ARCGIS_HOST = "https://services1.arcgis.com/HMLBxPKXzqtpFXfq/arcgis/rest/services"
ARCGIS_QUERY = "query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson"

#: Brown Facilities' public, unauthenticated FeatureServer layers.
#:
#: (source id, service name, LAYER INDEX, stored filename).
#:
#: The layer index is NOT always 0 and cannot be guessed:
#: `BlueLightEmergencyPhone_view` publishes its only layer at **id 8**, and
#: asking for `/0/query` returns a bare 400 with no hint as to why. Every
#: index here was read from that service's own `FeatureServer?f=json`.
#:
#: Amenity notes that shaped this list:
#:   - `AED_NEW_view_for_base_map` carries a `narcan` Y/N column, so Narcan
#:     locations come from the AED layer rather than the separate `Narcan_2_*`
#:     views. Those views report 41 points where the AED table flags 43; one
#:     table cannot disagree with itself, two can.
#:   - `All_Building_Resources` is the union behind the `Hydration_Station_view`,
#:     `Printers_view` and `Menstrual_Products_view` layers — the same 127 rows
#:     with different filters applied. Capturing the union once means the
#:     hydration/printer/menstrual/lactation/dining counts can never drift
#:     apart from each other.
#:   - `elevator_locations_view` and `EVChargers_view` are deliberately absent:
#:     their only populated attributes are `OBJECTID`/`Shape_Leng`, so they
#:     carry no label and nothing to show in a popover.
ARCGIS_LAYERS: tuple[tuple[str, str, int, str], ...] = (
    ("arcgis_buildings", "Active_Buildings_2_view", 0, "recorded/arcgis/active-buildings.geojson"),
    ("arcgis_green_spaces", "Green_Spaces_view", 0, "recorded/arcgis/Green_Spaces_view.geojson"),
    ("arcgis_athletic_fields", "Athletic_Fields_view", 0, "recorded/arcgis/Athletic_Fields_view.geojson"),
    (
        "arcgis_blue_light",
        "BlueLightEmergencyPhone_view",
        8,
        "recorded/arcgis/BlueLightEmergencyPhone_view.geojson",
    ),
    ("arcgis_aed", "AED_NEW_view_for_base_map", 0, "recorded/arcgis/AED_NEW_view_for_base_map.geojson"),
    ("arcgis_building_resources", "All_Building_Resources", 0, "recorded/arcgis/All_Building_Resources.geojson"),
    ("arcgis_bike_racks", "BikeRacks_view", 0, "recorded/arcgis/BikeRacks_view.geojson"),
    (
        "arcgis_restrooms",
        "All_Restrooms_(Includes_Sub_Types)_VIEW",
        0,
        "recorded/arcgis/All_Restrooms_VIEW.geojson",
    ),
)


def capture_arcgis(session: CaptureSession) -> None:
    blocked: list[str] = []
    for source, service, layer, relpath in ARCGIS_LAYERS:
        # Service names carry literal parentheses ("All_Restrooms_(Includes…)")
        # which must be percent-encoded or the path 404s.
        url = f"{ARCGIS_HOST}/{quote(service, safe='')}/FeatureServer/{layer}/{ARCGIS_QUERY}"
        try:
            session.capture(
                source=source, relpath=relpath, method="GET", url=url, expected=_arcgis_expected
            )
        except Exception as error:  # noqa: BLE001
            # One dead layer must not cost the other seven their capture. The
            # group-level handler upstream turns a single raise into a gap for
            # every source in the group, including the ones already recorded.
            session.gap(source, f"{type(error).__name__}: {error}")
            blocked.append(source)
    if blocked:
        print(f"  {len(blocked)} arcgis layer(s) recorded as gaps: {', '.join(blocked)}")
    session.note(
        "arcgis_*: Brown University Facilities Management public ArcGIS FeatureServer. "
        "Unauthenticated and CORS-open, but the service's licenceInfo is NOT a grant to "
        "redistribute — carry the attribution string and confirm terms before production."
    )


def _arcgis_expected(body: bytes) -> dict[str, Any]:
    parsed = _json_facts(body)
    features = parsed.get("features", []) or []
    geometry_types = sorted({
        (feature.get("geometry") or {}).get("type", "null") for feature in features
    })
    # `body_contains` anchors the facts to the STORED BYTES, so a fixture that
    # is silently replaced by a different layer fails the integrity gate rather
    # than being trusted. Anchors are restricted to plain alphanumeric values
    # so JSON escaping can never make a present string look absent.
    anchors: list[str] = ['"features"']
    for feature in features:
        for value in (feature.get("properties") or {}).values():
            if not isinstance(value, str):
                continue
            candidate = value.strip()
            if 6 <= len(candidate) <= 40 and candidate.replace(" ", "").isalnum():
                if candidate not in anchors:
                    anchors.append(candidate)
                break
        if len(anchors) >= 3:
            break
    return {
        "feature_count": len(features),
        "geometry_types": geometry_types,
        "property_keys": sorted({key for feature in features for key in (feature.get("properties") or {})}),
        "body_contains": anchors,
    }


# -- publications ----------------------------------------------------------

#: Student-press RSS. The URLs are NOT the obvious ones and were found by
#: probing: BDH runs SNworks, whose feed lives at `/plugin/feeds/top-stories.xml`
#: rather than `/feed/`. Sources that could not be recorded are declared as
#: gaps by `brownsync_ingest.publications.feeds.GAPS`, which carries the
#: verbatim failure for each — see that module before re-adding one.
PUBLICATION_FEEDS: tuple[tuple[str, str, str], ...] = (
    (
        "publications_bdh",
        "https://www.browndailyherald.com/plugin/feeds/top-stories.xml",
        "recorded/publications/browndailyherald.xml",
    ),
    (
        "publications_bpr",
        "https://brownpoliticalreview.org/feed/",
        "recorded/publications/brownpoliticalreview.xml",
    ),
    # Widened set. Brown's own feed is at the SITE ROOT — `/news/rss.xml`,
    # `/news/rss`, `/news/feed` all hard-404 and `brown.edu/news` publishes no
    # `<link rel="alternate">` to discover it from.
    (
        "publications_brown",
        "https://www.brown.edu/rss.xml",
        "recorded/publications/extended/brownuniversity.xml",
    ),
    (
        "publications_ricurrent",
        "https://rhodeislandcurrent.com/feed/",
        "recorded/publications/extended/rhodeislandcurrent.xml",
    ),
)


def capture_publications(session: CaptureSession) -> None:
    from brownsync_ingest.publications.feeds import GAPS as PUBLICATION_GAPS
    from brownsync_ingest.publications.sources import EXTENDED_GAPS

    for source, url, relpath in PUBLICATION_FEEDS:
        try:
            session.capture(
                source=source, relpath=relpath, method="GET", url=url, expected=_feed_expected
            )
        except Exception as error:  # noqa: BLE001
            session.gap(source, f"{type(error).__name__}: {error}")
    for key, reason in PUBLICATION_GAPS.items():
        session.gap(f"publications_{key}", reason)
    # Sources probed and refused. Two of these answered 200 and are gaps
    # anyway — Google News for its own licence text, Reddit because
    # robots.txt is a blanket Disallow and we never knocked.
    for key, reason in EXTENDED_GAPS.items():
        session.gap(f"publications_{key}", reason)
    session.note(
        "publications_*: HEADLINE-ONLY. The Brown Daily Herald's Terms of Use prohibit "
        "automated indexing of their content, and post- rides the same SNworks install. "
        "The producer stores title/url/timestamp/section/author and NEVER body text; "
        "`test_feeds.py` asserts that at the byte level. Gate G1."
    )


def _feed_expected(body: bytes) -> dict[str, Any]:
    # ElementTree, not BeautifulSoup(..., "xml"): that feature needs lxml,
    # which is not a dependency, and BeautifulSoup raises FeatureNotFound
    # rather than degrading. The producer parses with ElementTree too, so the
    # facts recorded here are the facts it will actually read.
    import xml.etree.ElementTree as ElementTree

    root = ElementTree.fromstring(_text(body))
    items = [
        element
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] in {"item", "entry"}
    ]

    def title_of(item: ElementTree.Element) -> str | None:
        for child in item:
            if child.tag.rsplit("}", 1)[-1] == "title":
                return (child.text or "").strip() or None
        return None

    return {
        "item_count": len(items),
        "sample_titles": [t for item in items[:3] if (t := title_of(item))],
        # Structural anchors only. Headlines turn over hourly, so anchoring on
        # one would fail the integrity gate on every refresh for no reason.
        "body_contains": ["<title>", "<link"],
    }


# -- libraries -------------------------------------------------------------

#: Brown Library's hours live in a Springshare LibCal widget, not on the page
#: that displays them: `lib.brown.edu/.../locations-hours` loads
#: `libcal.brown.edu/js/hours_grid.js`, which fetches this endpoint one WEEK at
#: a time. `iid` is Brown's LibCal institution id; `lid=0` means every location.
LIBCAL_GRID = "https://libcal.brown.edu/widget/hours/grid?iid=1403&lid=0&date={date}"

#: How many consecutive weeks to record. Seven covers the ~6-week horizon the
#: widget itself paginates through, which is as far ahead as Brown publishes.
LIBCAL_WEEKS = 7


def capture_libraries(session: CaptureSession, *, start: date | None = None) -> None:
    # Anchored to the Sunday on or before the start date: the widget returns a
    # Sunday-to-Saturday grid regardless of which day you ask for, so asking
    # mid-week silently records the same week twice.
    today = start or datetime.now(UTC).date()
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    stamps = [sunday + timedelta(weeks=week) for week in range(LIBCAL_WEEKS)]
    _prune_stale_library_grids(session, keep_stamps=stamps)
    for stamp in stamps:
        try:
            session.capture(
                source="libraries_hours",
                relpath=f"recorded/libraries/hours-grid-{stamp.isoformat()}.html",
                method="GET",
                url=LIBCAL_GRID.format(date=stamp.isoformat()),
                expected=_libcal_expected,
            )
        except Exception as error:  # noqa: BLE001
            session.gap("libraries_hours", f"week {stamp.isoformat()}: {type(error).__name__}: {error}")
    session.note(
        "libraries_hours: Springshare LibCal widget endpoint, public and unauthenticated. "
        "Seven weekly grids per refresh — the widget itself paginates a week at a time."
    )


def _prune_stale_library_grids(session: CaptureSession, *, keep_stamps: list[date]) -> None:
    """Delete hours-grid snapshots left behind by a previous run's window.

    The 7-week window re-anchors to "today" on every refresh, so a file
    recorded last run can fall out of the window. preload_manifest() already
    drops that file's manifest entry (libraries_hours is always a selected
    source when this group runs) — without this, the now-unmanifested file
    just sits in recorded/libraries/ and fails
    test_every_stored_fixture_is_manifested on every future run, not just
    once, since nothing ever recaptures or removes it.
    """
    keep = {f"hours-grid-{stamp.isoformat()}.html" for stamp in keep_stamps}
    directory = session.fixtures_root / "recorded" / "libraries"
    if not directory.is_dir():
        return
    for path in sorted(directory.glob("hours-grid-*.html")):
        if path.name not in keep:
            path.unlink()


def _libcal_expected(body: bytes) -> dict[str, Any]:
    text = _text(body)
    soup = BeautifulSoup(text, "html.parser")
    return {
        "row_count": len(soup.find_all("tr")),
        # The grid is a table keyed on location names; `Rockefeller` is the one
        # row that has never not been there.
        "body_contains": ["<table", "Rockefeller"],
    }


# -- entry point -----------------------------------------------------------

GROUPS: dict[str, Callable[[CaptureSession], None]] = {
    "cab": capture_cab,
    "clubs": capture_clubs,
    "livewhale": capture_livewhale,
    "overpass": capture_overpass,
    "dining": capture_dining,
    "athletics": capture_athletics,
    "arcgis": capture_arcgis,
    "publications": capture_publications,
    "libraries": capture_libraries,
}

GROUP_SOURCES: dict[str, tuple[str, ...]] = {
    "cab": ("cab_home", "cab_bootstrap", "cab_search", "cab_details"),
    "clubs": ("clubs_undergraduate", "clubs_graduate"),
    "livewhale": ("livewhale_events", "livewhale_groups"),
    "overpass": ("overpass_buildings",),
    "dining": ("dining_menus", "dining_landing", "dining_bundle"),
    "athletics": ("athletics_ics",),
    "arcgis": tuple(source for source, _, _, _ in ARCGIS_LAYERS),
    "publications": tuple(source for source, _, _ in PUBLICATION_FEEDS),
    "libraries": ("libraries_hours",),
}


def preload_manifest(session: CaptureSession, *, selected_sources: set[str]) -> None:
    """Carry forward existing manifest evidence for sources NOT being recaptured.

    Entries, gaps, and ``<source>:``-prefixed notes owned by the selected
    sources are dropped so the fresh run replaces them; everything else —
    including user_provided inputs, which no capture group owns — survives
    verbatim.
    """
    path = session.fixtures_root / "manifest.json"
    if not path.is_file():
        return
    existing = json.loads(path.read_text(encoding="utf-8"))
    for entry in existing.get("fixtures", []):
        if entry.get("source") not in selected_sources:
            session.entries.append(entry)
    for gap in existing.get("gaps", []):
        if gap.get("source") not in selected_sources:
            session.gaps.append(gap)
    for note in existing.get("notes", []):
        if note.split(":", 1)[0] not in selected_sources:
            session.notes.append(note)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture recorded source evidence for BrownSync ingestion.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "fixtures")
    parser.add_argument("--cache-dir", type=Path, required=True, help="scratch cache directory OUTSIDE the repository")
    parser.add_argument("--contact", default=DEFAULT_CONTACT)
    parser.add_argument(
        "--groups",
        nargs="+",
        choices=sorted(GROUPS),
        default=None,
        help="capture only these groups, merging into the existing manifest",
    )
    arguments = parser.parse_args(argv)
    selected_groups = list(GROUPS) if arguments.groups is None else list(arguments.groups)

    session = CaptureSession(
        contact_email=arguments.contact, fixtures_root=arguments.root, cache_dir=arguments.cache_dir
    )
    preload_manifest(
        session,
        selected_sources={source for group in selected_groups for source in GROUP_SOURCES[group]},
    )
    for name in selected_groups:
        group = GROUPS[name]
        print(f"capturing {name} ...")
        try:
            group(session)
        except Exception as error:  # noqa: BLE001 — a failed source becomes an explicit gap, never a fake fixture
            captured = {entry["source"] for entry in session.entries}
            declared = {gap["source"] for gap in session.gaps}
            for source in GROUP_SOURCES[name]:
                if source not in captured and source not in declared:
                    session.gap(source, f"capture failed after polite retries: {type(error).__name__}: {error}")
    manifest_path = session.write_manifest()
    print(f"wrote {manifest_path} with {len(session.entries)} fixtures and {len(session.gaps)} gap(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
