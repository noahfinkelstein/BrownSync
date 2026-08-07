import type { ArticleOut, EventOut } from "@brownsync/contract";
import {
  type DiningDocument,
  type DiningLocation,
  type DiningService,
  isServing,
} from "../dining/model";
import { DEFAULT_DURATION_MS } from "../map/eventsLayer";

/**
 * One campus feed out of three unrelated upstreams, as data.
 *
 * Events, publications and dining hours arrive with nothing in common — no
 * shared id space, no shared notion of "when", no shared source registry — so
 * the union below is the narrowest shape that ranking, dedup and diversity can
 * all operate on without knowing which upstream produced a row.
 *
 * Kept pure and away from React for the same reason `nowSummary` is: every
 * interesting case is a boundary (a hall open at the cursor, an all-day event,
 * two outlets running the same headline, one source that published twenty
 * times today) and those are miserable to assert through a rendered list.
 */

/** Matches the publications artifact the ingest job publishes. */
export type PublicationArticle = {
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly url: string;
  /** ISO-8601. */
  readonly published: string;
  readonly section: string | null;
  readonly author: string | null;
};

export type PublicationsDocument = {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly sources: readonly {
    readonly id: string;
    readonly name: string;
    readonly homepage: string;
    readonly license: string;
  }[];
  readonly articles: readonly PublicationArticle[];
};

export type FeedKind = "event" | "article" | "dining";

type FeedItemBase = {
  /**
   * Globally unique, and NOT the upstream id. Two upstreams that both number
   * their rows from 1 would otherwise collide in the dedup set and in React
   * keys, so every id is namespaced by kind.
   */
  readonly id: string;
  /** Diversity is enforced per source, so this is required on every kind. */
  readonly sourceId: string;
  readonly title: string;
  /** Milliseconds. When the item starts (events, dining) or ran (articles). */
  readonly timestamp: number;
  /**
   * When the item stops being current, or null when it is a point in time.
   * Ranking needs the interval, not just the start: a dinner service that
   * opened two hours ago is happening NOW, and scoring it purely on how long
   * ago it started would sink it below a lecture that has not begun.
   */
  readonly endsAt: number | null;
  readonly placeId: string | null;
  readonly url: string | null;
};

export type EventFeedItem = FeedItemBase & {
  readonly kind: "event";
  readonly event: EventOut;
};

export type ArticleFeedItem = FeedItemBase & {
  readonly kind: "article";
  readonly article: PublicationArticle;
  /**
   * Human attribution label ("Brown News", "Brown Daily Herald"). Rendering
   * it on article rows is a licence obligation, not decoration: headline-only
   * rows exist on the promise of prominent attribution + click-through.
   * Null when the upstream carries no label — the row falls back to the
   * generic kind label rather than inventing one.
   */
  readonly publication: string | null;
};

export type DiningFeedItem = FeedItemBase & {
  readonly kind: "dining";
  /** Both halves: a service alone cannot say which hall it belongs to. */
  readonly location: DiningLocation;
  readonly service: DiningService;
};

export type FeedItem = EventFeedItem | ArticleFeedItem | DiningFeedItem;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far ahead a dining service may be and still earn a feed slot.
 *
 * Three hours ≈ "my next meal". Wider and the 6 p.m. dinner sitting shows up
 * during lunch; narrower and the feed never answers "where do I eat later".
 */
export const DINING_LOOKAHEAD_MS = 3 * HOUR_MS;

/** The artifact leaves `end` null on some services (see `dining/model`). */
const DINING_DEFAULT_SERVICE_MS = 3 * HOUR_MS;

/** Every hall comes from the one daily Brown Dining artifact. */
export const DINING_SOURCE_ID = "brown-dining";

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

/**
 * Events → feed rows.
 *
 * Deliberately does NO time filtering: `eventsLayer.isEventLive` is
 * `start <= cursor + 2 h`, i.e. "draw this on the map", and reusing it here
 * would silently cap the feed at a two-hour horizon. Pass an already-windowed
 * list (the same one the map is showing) and let `rankFeed` decide what floats.
 *
 * Canceled events are dropped. They are genuinely useful news to the handful
 * of people who planned to attend, but with no saved-events signal the only
 * option is to show them to everyone, and an "off" row is noise in a feed
 * whose whole job is "what should I do next". Revisit once saves exist.
 */
export function eventsToFeed(events: readonly EventOut[]): EventFeedItem[] {
  const items: EventFeedItem[] = [];
  for (const event of events) {
    if (event.isCanceled) continue;
    const start = parse(event.start);
    if (start === null) continue;

    // An all-day event has a midnight start and usually no end. Falling back
    // to the 90-minute default would retire it at 1:30 a.m., so it gets the
    // day it actually occupies.
    const fallback = event.allDay ? DAY_MS : DEFAULT_DURATION_MS;
    const end = parse(event.end);

    items.push({
      kind: "event",
      id: `event:${event.id}`,
      // The contract calls this `source`; the feed calls it `sourceId`
      // because articles and dining have to answer the same question.
      sourceId: event.source,
      title: event.title,
      timestamp: start,
      endsAt: end !== null && end >= start ? end : start + fallback,
      placeId: event.placeId,
      url: event.url,
      event,
    });
  }
  return items;
}

/**
 * Articles → feed rows. `endsAt` stays null: a story is published at an
 * instant and never "ends", which is exactly what the null case means.
 */
export function articlesToFeed(doc: PublicationsDocument | null | undefined): ArticleFeedItem[] {
  if (!doc) return [];
  const nameBySource = new Map(doc.sources.map((s) => [s.id, s.name]));
  const items: ArticleFeedItem[] = [];
  for (const article of doc.articles) {
    const published = parse(article.published);
    if (published === null) continue;
    items.push({
      kind: "article",
      // Two outlets can both call a story `2026-07-29-commencement`.
      id: `article:${article.sourceId}:${article.id}`,
      sourceId: article.sourceId,
      title: article.title,
      timestamp: published,
      endsAt: null,
      // Articles are not places. Guessing a placeId from the headline is how
      // a story about Providence ends up pinned to the Ratty.
      placeId: null,
      url: article.url,
      article,
      publication: nameBySource.get(article.sourceId) ?? null,
    });
  }
  return items;
}

/**
 * API articles (contract v1.9, GET /api/articles — the `articles` table's
 * read model) → feed rows. Same shape as `articlesToFeed`, different
 * upstream: these rows come from the database, already carry their registry
 * attribution label ("Brown News"), and are headline+URL+date by database
 * CHECK — there is no body to be tempted by.
 */
export function apiArticlesToFeed(articles: readonly ArticleOut[]): ArticleFeedItem[] {
  const items: ArticleFeedItem[] = [];
  for (const article of articles) {
    const published = parse(article.publishedAt);
    if (published === null) continue;
    items.push({
      kind: "article",
      id: `article:${article.source}:${article.id}`,
      sourceId: article.source,
      title: article.title,
      timestamp: published,
      endsAt: null,
      placeId: null,
      url: article.url,
      article: {
        id: article.id,
        sourceId: article.source,
        title: article.title,
        url: article.url,
        published: article.publishedAt,
        section: null,
        author: article.author,
      },
      publication: article.publication,
    });
  }
  return items;
}

/**
 * Dining → feed rows, one per SERVICE that is open at the cursor or opens
 * within `lookaheadMs`.
 *
 * Not one row per hall per day: the published artifact carries three weeks of
 * sittings (Verney-Woolley alone has 21), and adapting all of them would put
 * ~150 near-identical rows into a list that holds twenty. The cursor filter is
 * what makes dining a feed item rather than a directory.
 */
export function diningToFeed(
  doc: DiningDocument | null | undefined,
  at: number,
  lookaheadMs: number = DINING_LOOKAHEAD_MS,
): DiningFeedItem[] {
  if (!doc) return [];
  const items: DiningFeedItem[] = [];
  for (const location of doc.locations) {
    for (const service of location.services) {
      const start = parse(service.start);
      if (start === null) continue;

      // `isServing` is half-open on the end on purpose — a hall that closes at
      // 15:00 must not be advertised at 15:00. Reuse it rather than re-deriving.
      const open = isServing(service, at);
      const opening = start > at && start - at <= lookaheadMs;
      if (!open && !opening) continue;

      const end = parse(service.end);
      items.push({
        kind: "dining",
        id: `dining:${location.locationId}:${service.start}:${service.meal}`,
        sourceId: DINING_SOURCE_ID,
        title: `${location.name} — ${service.meal}`,
        timestamp: start,
        endsAt: end !== null && end > start ? end : start + DINING_DEFAULT_SERVICE_MS,
        placeId: location.placeId,
        // The artifact publishes no per-service permalink; the dining panel
        // owns the deep link, so the feed row carries none rather than a guess.
        url: null,
        location,
        service,
      });
    }
  }
  return items;
}

/** utm_*, and the handful of click ids that ride along with syndicated links. */
const TRACKING_PARAM = /^(utm_[a-z_]+|fbclid|gclid|mc_cid|mc_eid|igshid)$/i;

/**
 * A URL reduced to the document it names, or null when it is not a URL.
 *
 * The same Herald story reaches us from the RSS feed as `?utm_source=rss` and
 * from the sitemap bare; those are one document. Scheme is folded to https and
 * the fragment is dropped for the same reason — neither names a different
 * story. Host is only lowercased and de-`www`'d: anything more aggressive
 * risks collapsing two outlets into one, which is the failure this module is
 * least willing to have.
 */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Relative hrefs and junk never dedupe against anything — losing a row to
    // a bad parse is worse than showing it twice.
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.host.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";

  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  // Sorted so `?a=1&b=2` and `?b=2&a=1` produce one key.
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");

  return `https://${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * Drop rows that are literally the same row twice. Nothing else.
 *
 * Two outlets covering the same story are TWO items and must both survive:
 * "Brown announces tuition freeze" from the Herald and from Brown News are
 * different reporting with different framing, and a feed that silently picks
 * one has made an editorial decision it has no basis for. Title similarity is
 * therefore never consulted — only an exact canonical-URL match, and only
 * within a kind, since an event's landing page and a write-up of that event
 * are different affordances (one you attend, one you read).
 *
 * First occurrence wins, so callers control precedence by input order.
 */
export function dedupeFeed(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const item of items) {
    const canonical = item.url ? canonicalizeUrl(item.url) : null;
    const keys = [`id:${item.id}`];
    if (canonical) keys.push(`url:${item.kind}:${canonical}`);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    out.push(item);
  }
  return out;
}
