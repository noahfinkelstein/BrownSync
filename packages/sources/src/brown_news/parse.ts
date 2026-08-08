import { newYorkToUtc, stripHtml, toIsoUtc } from "../util";

/**
 * brown.edu/news listing parser — Workstream C's first `articles` producer.
 *
 * Vetting record (reports/ops/2026-08-07-source-vetting.md): robots.txt does
 * not restrict /news; there is NO live feed — the root rss.xml is a dead 2019
 * channel and every feed probe 404s/406s — so the producer parses the
 * server-rendered listing. The stable anchor shape is
 *
 *   <a href="/news/YYYY-MM-DD/slug">Headline text</a>
 *
 * HEADLINE-ONLY, DELIBERATELY (same envelope as services/poller/src/bdh):
 * this module extracts title + URL + date and NOTHING ELSE. It never reads a
 * teaser, an image caption, or an article page. The `articles` table's CHECK
 * constraints (migration 0021) reject anything more for a headline_only
 * source, so this restraint is enforced twice: here by construction, and in
 * the database structurally.
 *
 * FAIL-CLOSED GATE: the listing carries ~40 dateful items when healthy. A
 * Drupal theme change that breaks the selector produces zero-or-few matches,
 * not an error — so "few matches" IS the error signal. Fewer than
 * MIN_LISTING_ITEMS parsed items means the runner records `partial` and
 * upserts NOTHING: previously stored rows must never be polluted or
 * half-replaced on selector drift (spec risk R2).
 */

export const BROWN_NEWS_URL = "https://www.brown.edu/news";

/** Below this, the parse is presumed broken and the run must not upsert. */
export const MIN_LISTING_ITEMS = 10;

/**
 * Ceiling on an accepted headline, in stripped characters. THIS IS A LICENCE
 * GUARD, not tidiness: `title` is the one text column the headline_only CHECK
 * constraints exempt, so it must never become a smuggling path for excerpt
 * prose. A common accessibility-driven Drupal redesign wraps the WHOLE card
 * in one anchor — headline + category + date + dek together — and a
 * longest-text-wins recovery would then be guaranteed to pick the dek-bearing
 * blob while the item count stays healthy and the fail-closed gate never
 * fires. The cap makes that blob unacceptable: an over-cap anchor is
 * REJECTED for its href, and if the rejections drop the unique-item count
 * below MIN_LISTING_ITEMS the run fails closed, which is exactly right.
 *
 * 200 comfortably clears every real headline in the recorded fixture (max
 * observed 105 chars) while a card-wide blob carrying even one dek sentence
 * plus its date/category chrome lands far past it.
 */
export const MAX_HEADLINE_CHARS = 200;

export type BrownNewsItem = {
  /** The dateful listing path, e.g. "/news/2026-08-06/some-slug" — the stable source_id. */
  source_id: string;
  title: string;
  /** Absolute canonical URL on www.brown.edu. */
  url: string;
  /** ISO-8601 UTC: midnight America/New_York of the listing date. */
  published_at: string;
  /** "YYYY-MM-DD" as printed in the href (kept in raw as provenance). */
  listing_date: string;
};

/**
 * Every anchor whose href matches the dateful pattern. The listing links each
 * story up to three times (image tile, headline, "Read Article" chip); the
 * headline anchor is recovered per href by keeping the longest stripped
 * anchor text AMONG anchors that pass the MAX_HEADLINE_CHARS cap. Longest-
 * wins alone would fail OPEN under a whole-card anchor (headline + dek in one
 * <a>) — the cap is the guarantee: it rejects anything too long to plausibly
 * be a headline before length is ever used as a tiebreak, so boilerplate
 * ("Read Article") and empty image anchors lose to a real headline, and a
 * dek-bearing blob loses to everything.
 */
const ANCHOR_RE =
  /<a\b[^>]*href="(\/news\/(\d{4})-(\d{2})-(\d{2})\/[a-z0-9][a-z0-9\-_.]*)"[^>]*>([\s\S]*?)<\/a>/gi;

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Server-rendered listing HTML → one item per unique dateful href.
 * Malformed dates and empty titles are skipped, never guessed; the gate in
 * the runner decides whether what survived is enough to trust.
 */
export function parseBrownNewsListing(html: string): BrownNewsItem[] {
  const byHref = new Map<string, BrownNewsItem>();
  for (const match of html.matchAll(ANCHOR_RE)) {
    const [, href, yearS, monthS, dayS, inner] = match;
    if (!href || !yearS || !monthS || !dayS || inner === undefined) continue;
    const year = Number(yearS);
    const month = Number(monthS);
    const day = Number(dayS);
    if (!isRealDate(year, month, day)) continue;

    const title = stripHtml(inner);
    if (title.length === 0) continue;
    // Licence guard, not a truncation: an over-cap anchor (a whole-card blob
    // carrying dek prose) is rejected outright for this href. Truncating it
    // instead would STORE excerpt text under the one column the CHECKs
    // exempt. If the rejections leave this href with no acceptable anchor,
    // the item is simply absent and the MIN_LISTING_ITEMS gate judges the run.
    if (title.length > MAX_HEADLINE_CHARS) continue;

    const existing = byHref.get(href);
    if (existing !== undefined && existing.title.length >= title.length) continue;
    byHref.set(href, {
      source_id: href,
      title,
      url: `https://www.brown.edu${href}`,
      // The listing prints a calendar date, not a timestamp; midnight
      // America/New_York is the honest reading (contract §2: source-local
      // parsing assumes America/New_York).
      published_at: toIsoUtc(newYorkToUtc(year, month, day)),
      listing_date: `${yearS}-${monthS}-${dayS}`,
    });
  }
  // Listing order is presentation, not chronology (featured tiles first);
  // newest-first by date, then by path, so replays are deterministic.
  return [...byHref.values()].sort((a, b) =>
    a.listing_date === b.listing_date
      ? a.source_id.localeCompare(b.source_id)
      : b.listing_date.localeCompare(a.listing_date),
  );
}
