"""Cache-first, polite HTTP access for BrownSync ingestion sources."""
from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import threading
from typing import Callable, Mapping
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx
from pydantic import JsonValue
from tenacity import Retrying, RetryError, retry_if_exception_type, retry_if_result, stop_after_attempt


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SECRET_HEADERS = {"authorization", "cookie", "proxy-authorization", "proxy-authenticate", "set-cookie"}
_SENSITIVE_REQUEST_HEADERS = _SECRET_HEADERS | {"api-key", "x-api-key", "x-auth-token", "x-amz-security-token"}
_RESPONSE_HEADERS = ("content-type", "etag", "last-modified")
_RETRYABLE = {429, 500, 502, 503, 504}


def utc_now() -> datetime:
    """Return the current timezone-aware UTC wall-clock time."""
    return datetime.now(UTC)


def _normalized_url(url: str) -> str:
    parsed = urlsplit(url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("url must include a scheme and host")
    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()
    port = parsed.port
    netloc = hostname
    if port is not None and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        netloc = f"{hostname}:{port}"
    return urlunsplit((scheme, netloc, parsed.path or "/", parsed.query, ""))


def _cache_headers(headers: Mapping[str, str]) -> list[tuple[str, str]]:
    return sorted((name.lower(), value) for name, value in headers.items() if name.lower() not in _SENSITIVE_REQUEST_HEADERS)


class CachedHttpClient:
    """A synchronous client with local response caching and per-host etiquette."""

    def __init__(
        self,
        *,
        contact_email: str,
        cache_dir: Path,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = utc_now,
        sleeper: Callable[[float], None] = time.sleep,
        min_interval_seconds: float = 1.0,
        max_attempts: int = 4,
    ) -> None:
        if not _EMAIL.fullmatch(contact_email):
            raise ValueError("contact_email must be a non-empty email address")
        if min_interval_seconds < 0 or max_attempts < 1:
            raise ValueError("min_interval_seconds must be non-negative and max_attempts positive")
        self._user_agent = f"BrownSync/1.0 (+{contact_email})"
        self._cache_dir = cache_dir
        self._transport = transport
        self._clock = clock
        self._wall_clock = wall_clock
        self._sleeper = sleeper
        self._min_interval_seconds = min_interval_seconds
        self._max_attempts = max_attempts
        self._last_attempt: dict[str, float] = {}
        self._host_locks: dict[str, threading.Lock] = {}
        self._host_locks_guard = threading.Lock()

    def request(
        self,
        method: str,
        url: str,
        *,
        json_body: JsonValue | None = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        max_age_seconds: float | None = None,
        force_refresh: bool = False,
    ) -> httpx.Response:
        if json_body is not None and content is not None:
            raise ValueError("provide json_body or content, not both")
        normalized_method = method.upper()
        normalized_url = _normalized_url(url)
        supplied_headers = headers or {}
        cacheable = not any(name.lower() in _SENSITIVE_REQUEST_HEADERS for name in supplied_headers)
        request_headers = {name: value for name, value in supplied_headers.items() if name.lower() != "user-agent"}
        request_headers["User-Agent"] = self._user_agent
        body = content
        if json_body is not None:
            body = json.dumps(json_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
            request_headers.setdefault("Content-Type", "application/json")
        fingerprint = self._fingerprint(normalized_method, normalized_url, body, request_headers)
        if cacheable and not force_refresh:
            cached = self._load_cache(fingerprint, normalized_method, normalized_url, max_age_seconds)
            if cached is not None:
                return cached

        parsed = urlsplit(normalized_url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        host_key = f"{parsed.hostname}:{port}"
        retries = Retrying(
            stop=stop_after_attempt(self._max_attempts),
            retry=retry_if_exception_type(httpx.TransportError) | retry_if_result(self._is_retryable_response),
            wait=self._retry_delay,
            sleep=self._sleeper,
            reraise=False,
        )
        try:
            response = retries(
                self._transport_attempt,
                host_key,
                normalized_method,
                normalized_url,
                body,
                request_headers,
            )
        except RetryError as error:
            outcome = error.last_attempt
            if outcome.failed:
                raise outcome.exception()
            response = outcome.result()
        if response.is_success:
            if cacheable and response.status_code == 200:
                self._write_cache(fingerprint, response)
            return response
        response.raise_for_status()

    def get(self, url: str, **kwargs: object) -> httpx.Response:
        return self.request("GET", url, **kwargs)  # type: ignore[arg-type]

    def post(self, url: str, **kwargs: object) -> httpx.Response:
        return self.request("POST", url, **kwargs)  # type: ignore[arg-type]

    def _fingerprint(self, method: str, url: str, body: bytes | None, headers: Mapping[str, str]) -> str:
        identity = {"method": method, "url": url, "body": (body or b"").hex(), "headers": _cache_headers(headers)}
        encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()

    def _metadata_path(self, fingerprint: str) -> Path:
        return self._cache_dir / f"{fingerprint}.json"

    def _load_cache(self, fingerprint: str, method: str, url: str, max_age_seconds: float | None) -> httpx.Response | None:
        metadata_path = self._metadata_path(fingerprint)
        if not metadata_path.is_file():
            return None
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata["request_fingerprint"] != fingerprint or metadata["status"] != 200:
                return None
            body_name = metadata["body_file"]
            if not isinstance(body_name, str) or Path(body_name).name != body_name or not body_name.startswith(f"{fingerprint}.") or not body_name.endswith(".body"):
                return None
            body = (self._cache_dir / body_name).read_bytes()
            if metadata["body_length"] != len(body) or metadata["body_sha256"] != hashlib.sha256(body).hexdigest():
                return None
            retrieved = datetime.fromisoformat(metadata["retrieved_at"].replace("Z", "+00:00"))
            if retrieved.tzinfo is None:
                return None
            if max_age_seconds is not None and (self._wall_clock().astimezone(UTC) - retrieved.astimezone(UTC)).total_seconds() > max_age_seconds:
                return None
            response_headers = metadata.get("headers", {})
            if not isinstance(response_headers, dict):
                return None
            return httpx.Response(
                metadata["status"], headers=response_headers, content=body, request=httpx.Request(method, url)
            )
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def _write_cache(self, fingerprint: str, response: httpx.Response) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = self._metadata_path(fingerprint)
        body_name = f"{fingerprint}.{uuid4().hex}.body"
        body_path = self._cache_dir / body_name
        selected_headers = {name: response.headers[name] for name in _RESPONSE_HEADERS if name in response.headers}
        timestamp = self._wall_clock().astimezone(UTC).isoformat().replace("+00:00", "Z")
        metadata = {
            "status": response.status_code,
            "headers": selected_headers,
            "retrieved_at": timestamp,
            "request_fingerprint": fingerprint,
            "body_file": body_name,
            "body_length": len(response.content),
            "body_sha256": hashlib.sha256(response.content).hexdigest(),
        }
        self._atomic_write(body_path, response.content)
        try:
            self._atomic_write(metadata_path, json.dumps(metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
        except BaseException:
            body_path.unlink(missing_ok=True)
            raise

    def _atomic_write(self, destination: Path, data: bytes) -> None:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def _transport_attempt(
        self,
        host_key: str,
        method: str,
        url: str,
        body: bytes | None,
        headers: Mapping[str, str],
    ) -> httpx.Response:
        with self._host_lock(host_key):
            self._wait_for_host(host_key)
            with httpx.Client(transport=self._transport) as client:
                return client.request(method, url, content=body, headers=headers)

    def _host_lock(self, host_key: str) -> threading.Lock:
        with self._host_locks_guard:
            lock = self._host_locks.get(host_key)
            if lock is None:
                lock = threading.Lock()
                self._host_locks[host_key] = lock
            return lock

    def _wait_for_host(self, host_key: str) -> None:
        now = self._clock()
        previous = self._last_attempt.get(host_key)
        if previous is not None:
            remaining = self._min_interval_seconds - (now - previous)
            if remaining > 0:
                self._sleeper(remaining)
        self._last_attempt[host_key] = self._clock()

    @staticmethod
    def _numeric_retry_after(response: httpx.Response) -> float:
        try:
            return max(0.0, float(response.headers.get("Retry-After", "0")))
        except ValueError:
            return 0.0

    @staticmethod
    def _is_retryable_response(response: object) -> bool:
        return isinstance(response, httpx.Response) and response.status_code in _RETRYABLE

    def _retry_delay(self, retry_state: object) -> float:
        attempt_number = getattr(retry_state, "attempt_number")
        delay = 2.0 ** (attempt_number - 1)
        outcome = getattr(retry_state, "outcome")
        if outcome is not None and not outcome.failed:
            result = outcome.result()
            if isinstance(result, httpx.Response):
                delay = max(delay, self._numeric_retry_after(result))
        return delay
