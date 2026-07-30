# Athletics source probe — brownbears.com (SIDEARM)

Date: 2026-07-29 (04:08 UTC)
UA used (exact, both requests): `BrownSync/1.0 (+noah_finkelstein@brown.edu)`
Requests made: 2 of 4 allowed, ~2s apart, via curl. No retries, no header changes, no evasion.
Endpoint source: `DATA_CONTRACT.md` section 5 documents `GET https://brownbears.com/calendar.ashx/calendar.ics` (matches the standard SIDEARM path).

## Request 1 — robots.txt

- URL: `https://brownbears.com/robots.txt`
- Status: **200**, 5,479 bytes
- Key headers:
  - `content-type: text/plain; charset=utf-8`
  - `x-cdn: Imperva` (Incapsula CDN/WAF fronts the site; `visid_incap_*` / `incap_ses_*` cookies set, but no challenge served)
  - No `server` header, no `x-amzn-waf-*` headers (not AWS WAF)
- First ~200 bytes of body:

  ```
  User-agent: BLP_bbot/0.1
  Disallow: /

  User-agent: BLP_bbot
  Disallow: /

  User-agent: Slurp
  Disallow: /

  User-agent: Spinn3r
  Disallow: /

  User-agent: Baiduspider
  Disallow: /
  ```

### robots.txt rules relevant to our paths

`BrownSync` is not a named user-agent, so the `User-agent: *` block governs us:

```
User-agent: *
Disallow: /common/  /images/  /documents/  /admin/  /services/  /site/  /hidden/  /tags/
Disallow: /*.js$  /*.css$  /*.jpg$  /*.gif$  /*.axd  /*print=true*
Allow: /
Crawl-delay: 30
```

- `/calendar.ashx/calendar.ics` matches **no Disallow rule** (`/*.axd` covers `.axd` handlers only, not `.ashx`) → **allowed** under `Allow: /`.
- `Crawl-delay: 30` applies to us: keep polls ≥30s apart. The feed itself advertises `X-PUBLISHED-TTL:PT120M`, so a 2-hour poll cadence is both polite and sufficient.
- The long per-bot blocklist (Slurp, Yandex, MJ12bot, ccbot, …) names specific crawlers; none is a generic scraper ban and none matches BrownSync.

## Request 2 — SIDEARM composite ICS

- URL: `https://brownbears.com/calendar.ashx/calendar.ics`
- Status: **200**, 71,149 bytes, valid iCalendar with **170 VEVENTs**
- Key headers:
  - `content-type: text/calendar`
  - `cache-control: private`, `x-cache-status: MISS`
  - `access-control-allow-origin: *` (feed is intentionally public)
  - `x-sa-pr: calendar` (SIDEARM platform header)
  - `x-cdn: Imperva` — again passed through without challenge
- First ~200 bytes of body (no personal data present; feed is public schedule data):

  ```
  BEGIN:VCALENDAR
  VERSION:2.0
  PRODID:-//SIDEARM Sports//NONSGML SIDEARM//EN
  X-WR-CALNAME:Brown University Athletics
  X-PUBLISHED-TTL:PT120M
  BEGIN:VEVENT
  UID:vcal_20893-admin.brownbears.com
  DTSTAMP:20260729T040805Z
  ```

- Sample event shape: `SUMMARY:Brown University Women's Soccer vs New Haven`, `LOCATION:Providence\, R.I., Stevenson-Pincince Field`, `URL:https://admin.brownbears.com/calendar.aspx?game_id=...&sport_id=...`, stable `UID:vcal_<game_id>-admin.brownbears.com`. Note: LOCATION for home games actually includes the venue name after the city (e.g. "Stevenson-Pincince Field"), which is better than the "city-level only" caveat in DATA_CONTRACT.md — the gazetteer alias resolution still applies but has more signal to work with.

## Verdict

**Feasible.** Task 8 athletics capture works today with the declared identity: both `robots.txt` and the documented SIDEARM composite ICS returned 200 to the exact UA `BrownSync/1.0 (+noah_finkelstein@brown.edu)` with no bot challenge, despite the site sitting behind Imperva. The feed is a clean, public, CORS-open iCalendar with 170 events and stable per-game UIDs suitable for upsert keys. robots.txt permits the path and asks only for a 30s crawl delay, which our cadence (feed TTL is 120 minutes) trivially satisfies. Athletics does **not** join clubs/dining in needing user action — no credentials, no browser session, no exception request required. Poller requirements: keep the exact declared UA, poll no more often than every 2 hours (respecting `X-PUBLISHED-TTL`), and tolerate the Incapsula cookies without needing to persist them (the 200s above were cookie-free first contacts).
