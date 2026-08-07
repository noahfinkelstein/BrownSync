# Workstream C — source vetting record, 2026-08-07

Per ops handoff §6: every candidate source gets a robots/ToS check recorded
BEFORE the first producer request. Checks below were made with the declared UA
`BrownSync/1.0 (+https://brownsync.pages.dev)`, single requests, ≥1s spacing.

## brown.edu/news (G3's sanctioned public alternative) — CLEARED to proceed

- **robots.txt** (fetched 2026-08-07): standard Drupal profile. `/news` is NOT
  disallowed; blocks are `/core/`, `/admin/`, `/search/`, `/user/*`, etc.
  No crawl-delay directive. Crawling the news listing with the declared UA at
  registry etiquette (≥1 req/s, ETag) is within policy.
- **Feed situation**: no live RSS. `www.brown.edu/rss.xml` exists but serves
  stale 2019 items (dead channel — do not use). `/news/feed`, `/news/rss`,
  `news.brown.edu/rss` → 404; `/news?_format=rss` → 406.
- **Listing shape**: `/news` is server-rendered HTML with stable dateful hrefs
  `href="/news/YYYY-MM-DD/slug"` — current (2026-08-03, 2026-08-06 items seen).
  Producer strategy per Lane B spec risk R2: parse the listing, headline+URL+
  date only, **fail-closed gate at <10 parsed items** (selector drift = refuse,
  keep previous artifact, record `partial`).
- **License**: publisher is Brown itself; still ship headline-only + link
  (consistent with every `articles` row; body text stays out).
- Registry row: `brown_news`, lane worker, cadence 1800s, stale_after 7200s,
  license `headline_only`, enabled once the producer + fixture land.

## events.brown.edu/live/rss — noted, not needed

Returns 200 (LiveWhale's RSS skin). We already consume LiveWhale JSON with
date-window sharding; RSS adds nothing. No registry row.

## Major outlets (ProJo, Globe, NYT, AP, higher-ed trades) — NOT YET VETTED

Deliberately deferred: their producers are sequenced behind the Lane B
contract-v2 `articles` table (license CHECKs must exist before the first
outlet row is stored). Vet each (robots + ToS + RSS availability) in the same
PR that adds its producer. Google News RSS query feeds are the discovery
fallback where a publisher prohibits direct indexing; refusals get registry
rows per §2 rule 1.

## Standing refusals (unchanged, re-affirmed)

- Sidechat (G6) — never; not the owner's to clear.
- Instagram feed harvesting (G7) — oEmbed opt-in only, via Lane C club claims.
- providenceri.gov (G2), today.brown.edu (G3) — never crawled; registry rows
  already record the refusals.
