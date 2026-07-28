from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import threading

import httpx
import pytest

from brownsync_ingest.common.http import CachedHttpClient
import brownsync_ingest.common.http as http_module


class FakeTime:
    def __init__(self) -> None:
        self.value = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds


def client(tmp_path: Path, handler, time: FakeTime | None = None, **kwargs: object) -> CachedHttpClient:
    fake_time = time or FakeTime()
    return CachedHttpClient(
        contact_email="ingest@brown.edu",
        cache_dir=tmp_path / "cache",
        transport=httpx.MockTransport(handler),
        clock=fake_time.clock,
        wall_clock=lambda: datetime(2026, 7, 28, tzinfo=UTC),
        sleeper=fake_time.sleep,
        **kwargs,
    )


@pytest.mark.parametrize("contact", ["", "not-an-email", "person@example", "a@b\n.com"])
def test_rejects_invalid_contact_before_client_creation(tmp_path: Path, contact: str) -> None:
    with pytest.raises(ValueError, match="contact"):
        CachedHttpClient(contact_email=contact, cache_dir=tmp_path)


def test_enforces_exact_user_agent_even_when_supplied_header_attempts_override(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    response = client(tmp_path, lambda request: (seen.append(request) or httpx.Response(200, content=b"ok"))) .get(
        "https://events.brown.edu/feed", headers={"User-Agent": "evil", "Accept": "application/json"}
    )

    assert response.content == b"ok"
    assert seen[0].headers["user-agent"] == "BrownSync/1.0 (+ingest@brown.edu)"
    assert seen[0].headers["accept"] == "application/json"


def test_cache_identity_varies_by_request_and_never_persists_sensitive_headers(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []
    c = client(tmp_path, lambda request: (calls.append(request) or httpx.Response(200, content=str(len(calls)).encode())))

    assert c.get("https://EXAMPLE.test:443/path?b=2&a=1", headers={"Accept": "one", "Authorization": "Bearer top-secret"}).text == "1"
    assert c.post("https://example.test/path?b=2&a=1", json_body={"x": 1}, headers={"Accept": "one"}).text == "2"
    assert c.post("https://example.test/path?b=2&a=1", json_body={"x": 2}, headers={"Accept": "one"}).text == "3"
    assert c.post("https://example.test/path?b=2&a=1", json_body={"x": 2}, headers={"Accept": "two"}).text == "4"
    assert len(calls) == 4
    metadata = "\n".join(path.read_text() for path in (tmp_path / "cache").glob("*.json"))
    assert "top-secret" not in metadata
    assert "Authorization" not in metadata
    assert all("request_fingerprint" in json.loads(path.read_text()) for path in (tmp_path / "cache").glob("*.json"))


def test_success_is_reconstructed_from_cache_without_transport_or_sleep(tmp_path: Path) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(201, headers={"Content-Type": "application/x-test", "ETag": "tag", "Last-Modified": "yesterday"}, content=b"body")
    time = FakeTime()
    c = client(tmp_path, handler, time)

    first = c.get("https://cache.test/value")
    before_sleeps = list(time.sleeps)
    cached = c.get("https://cache.test/value")

    assert calls == 1
    assert time.sleeps == before_sleeps
    assert (cached.status_code, cached.content, cached.headers["content-type"], cached.headers["etag"], cached.headers["last-modified"]) == (201, b"body", "application/x-test", "tag", "yesterday")
    assert cached.request.method == "GET"
    assert str(cached.request.url) == "https://cache.test/value"
    assert first.content == cached.content


def test_livewhale_freshness_and_force_refresh_control_cache_use(tmp_path: Path) -> None:
    calls = 0
    now = datetime(2026, 7, 28, tzinfo=UTC)
    time = FakeTime()
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=str(calls).encode())
    c = CachedHttpClient(
        contact_email="ingest@brown.edu",
        cache_dir=tmp_path / "cache",
        transport=httpx.MockTransport(handler),
        clock=time.clock,
        wall_clock=lambda: now,
        sleeper=time.sleep,
    )

    assert c.get("https://livewhale.test/events", max_age_seconds=600).text == "1"
    assert c.get("https://livewhale.test/events", max_age_seconds=600).text == "1"
    now += timedelta(seconds=601)
    assert c.get("https://livewhale.test/events", max_age_seconds=600).text == "2"
    assert c.get("https://livewhale.test/events", force_refresh=True).text == "3"
    assert calls == 3


def test_rate_limit_is_per_host_and_applies_to_retries(tmp_path: Path) -> None:
    time = FakeTime()
    attempts: list[tuple[str, float]] = []
    statuses = iter([500, 200, 200, 200])
    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append((request.url.host or "", time.clock()))
        return httpx.Response(next(statuses), content=b"ok")
    c = client(tmp_path, handler, time)

    assert c.get("https://one.test/a").status_code == 200
    assert c.get("https://two.test/a").status_code == 200
    assert c.get("https://one.test/a", force_refresh=True).status_code == 200

    assert attempts == [("one.test", 0.0), ("one.test", 1.0), ("two.test", 1.0), ("one.test", 2.0)]
    assert time.sleeps == [1.0, 1.0]


@pytest.mark.parametrize("outcome", ["transport", 429, 500, 502, 503, 504])
def test_retries_transient_failures_then_returns_success(tmp_path: Path, outcome: str | int) -> None:
    count = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        if count == 1 and outcome == "transport":
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(outcome if count == 1 else 200, content=b"ok")
    time = FakeTime()
    assert client(tmp_path, handler, time).get("https://retry.test/a").status_code == 200
    assert count == 2
    assert time.sleeps == [1.0]


def test_numeric_retry_after_extends_exponential_delay(tmp_path: Path) -> None:
    count = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        return httpx.Response(429 if count == 1 else 200, headers={"Retry-After": "7"}, content=b"ok")
    time = FakeTime()
    assert client(tmp_path, handler, time).get("https://retry.test/a").status_code == 200
    assert time.sleeps == [7.0]


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_permanent_client_errors_are_not_retried_or_cached(tmp_path: Path, status: int) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, content=b"no")
    with pytest.raises(httpx.HTTPStatusError):
        client(tmp_path, handler).get("https://errors.test/a")
    assert calls == 1
    assert not list((tmp_path / "cache").glob("*.json"))


def test_incomplete_cache_is_ignored_and_failed_refresh_keeps_complete_entry(tmp_path: Path) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200 if calls <= 2 else 400, content=b"stable")
    c = client(tmp_path, handler)
    assert c.get("https://cache.test/stable").content == b"stable"
    next((tmp_path / "cache").glob("*.body")).unlink()
    assert c.get("https://cache.test/stable").content == b"stable"
    assert c.get("https://cache.test/stable").content == b"stable"
    with pytest.raises(httpx.HTTPStatusError):
        c.get("https://cache.test/stable", force_refresh=True)
    assert c.get("https://cache.test/stable").content == b"stable"


def test_cache_identity_has_independent_method_url_json_content_and_header_components(tmp_path: Path) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=str(calls).encode())
    c = client(tmp_path, handler)

    assert c.get("https://identity.test/a").text == "1"
    assert c.post("https://identity.test/a").text == "2"
    assert c.get("https://identity.test/b").text == "3"
    assert c.post("https://identity.test/a", json_body={"value": 1}).text == "4"
    assert c.post("https://identity.test/a", json_body={"value": 2}).text == "5"
    assert c.post("https://identity.test/a", content=b"one").text == "6"
    assert c.post("https://identity.test/a", content=b"two").text == "7"
    assert c.get("https://identity.test/a", headers={"Accept": "one"}).text == "8"
    assert c.get("https://identity.test/a", headers={"Accept": "two"}).text == "9"
    assert calls == 9


@pytest.mark.parametrize("credential_header", ["Authorization", "Cookie", "Proxy-Authorization", "X-Api-Key"])
def test_credentialed_requests_bypass_cache_without_persisting_secret_values(tmp_path: Path, credential_header: str) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=f"account-{calls}".encode())
    c = client(tmp_path, handler)

    credentials = {credential_header: "Bearer secret"}
    assert c.get("https://private.test/profile", headers=credentials).text == "account-1"
    assert c.get("https://private.test/profile", headers=credentials).text == "account-2"
    assert c.get("https://private.test/profile").text == "account-3"
    assert "secret" not in "\n".join(path.read_text() for path in (tmp_path / "cache").glob("*.json"))
    assert calls == 3


def test_corrupt_cached_body_is_rejected_and_refetched(tmp_path: Path) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=b"original" if calls == 1 else b"recovered")
    c = client(tmp_path, handler)

    assert c.get("https://integrity.test/value").content == b"original"
    next((tmp_path / "cache").glob("*.body")).write_bytes(b"truncated")
    assert c.get("https://integrity.test/value").content == b"recovered"
    assert calls == 2


def test_metadata_commit_failure_keeps_the_prior_complete_cache_entry(tmp_path: Path, monkeypatch) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=b"old" if calls == 1 else b"new")
    c = client(tmp_path, handler)
    assert c.get("https://atomic.test/value").content == b"old"
    original_replace = http_module.os.replace
    def fail_metadata_replace(source, destination):
        if str(destination).endswith(".json"):
            raise OSError("metadata commit failed")
        return original_replace(source, destination)
    monkeypatch.setattr(http_module.os, "replace", fail_metadata_replace)

    with pytest.raises(OSError, match="metadata commit failed"):
        c.get("https://atomic.test/value", force_refresh=True)
    assert c.get("https://atomic.test/value").content == b"old"


def test_transient_exhaustion_uses_all_four_attempts_and_exponential_backoff(tmp_path: Path) -> None:
    calls = 0
    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, content=b"unavailable")
    time = FakeTime()

    with pytest.raises(httpx.HTTPStatusError):
        client(tmp_path, handler, time).get("https://retry.test/exhausted")
    assert calls == 4
    assert time.sleeps == [1.0, 2.0, 4.0]


def test_concurrent_same_host_requests_are_scheduled_one_second_apart(tmp_path: Path) -> None:
    time = FakeTime()
    attempts: list[float] = []
    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(time.clock())
        return httpx.Response(200, content=b"ok")
    c = client(tmp_path, handler, time)
    start = threading.Barrier(3)
    failures: list[BaseException] = []
    def request() -> None:
        try:
            start.wait()
            c.get("https://concurrent.test/value", force_refresh=True)
        except BaseException as error:
            failures.append(error)
    first = threading.Thread(target=request)
    second = threading.Thread(target=request)
    first.start()
    second.start()
    start.wait()
    first.join()
    second.join()

    assert not failures
    assert sorted(attempts) == [0.0, 1.0]
