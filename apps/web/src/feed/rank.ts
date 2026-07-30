import type { EventOut } from "@brownsync/contract";
import type { DiningDocument } from "../dining/model";
import type { FeedItem, FeedKind, PublicationsDocument } from "./model";
import { articlesToFeed, dedupeFeed, diningToFeed, eventsToFeed } from "./model";

/**
 * Feed ranking, as arithmetic you can audit.
 *
 * There is no engagement telemetry yet, so every number below is a guess, and
 * the first week of real data has to be replayable against a changed guess
 * offline. That constraint drives the whole design: the score is a plain SUM
 * of separately reported contributions (`score === recency + kind +
 * diversity`, exactly), the ordering is a total order with explicit
 * tiebreakers rather than whatever `sort` happened to do, and nothing here
 * reads the clock — `at` is always passed in.
 *
 * The 30% and no-three-in-a-row rules are NOT part of the score. They are
 * constraints on the output order, applied after scoring by `assembleFeed`,
 * because folding them into a score means a source can buy its way past them
 * by being very recent.
 */

export type FeedWeights = {
  /** Multiplier on the 0..1 time relevance. */
  readonly recency: number;
  /** Flat per-kind bonus. */
  readonly kind: Readonly<Record<FeedKind, number>>;
  /** Subtracted once per earlier item from the same source. */
  readonly diversityPenalty: number;
};

/**
 * Recency spans 0..1 and the kind bonuses are a fifth of that on purpose.
 * With no evidence that anyone prefers events to news, a kind weight large
 * enough to outrank "this starts in ten minutes" would be an opinion the data
 * does not support. The kind term is a tiebreaker, not a thumb on the scale.
 */
export const DEFAULT_FEED_WEIGHTS: FeedWeights = {
  recency: 1,
  kind: { event: 0.2, article: 0.14, dining: 0.08 },
  diversityPenalty: 0.06,
};

const HOUR_MS = 60 * 60_000;

/**
 * Half-lives, not cutoffs: `1 / (1 + age / halfLife)` never reaches zero, so
 * two stale items still order against each other instead of tying at 0 and
 * falling through to the id tiebreak.
 *
 * The past decays SLOWER than the future, which reads backwards until you
 * notice that publications only ever have a past. A symmetric curve would
 * mean articles never rank, and the kind weight would have to grow grotesque
 * to compensate — which is exactly the uninterpretable knob this design is
 * trying to avoid. It also keeps the feed from emptying out at 2 a.m.
 */
export const FUTURE_HALF_LIFE_MS = 3 * HOUR_MS;
export const PAST_HALF_LIFE_MS = 6 * HOUR_MS;

/**
 * 0..1: how much this item is about *now*.
 *
 * Peaks at 1 across the whole interval `[timestamp, endsAt]` — anything in
 * progress is maximally relevant while it is in progress.
 *
 * Not `eventsLayer.imminence`, which is 1 for anything within 30 minutes and
 * eases to 0 at the map's 2 h lookahead. That function drives a circle radius
 * and knows nothing about articles or dining.
 */
export function timeRelevance(item: FeedItem, at: number): number {
  const start = item.timestamp;
  if (!Number.isFinite(start)) return 0;
  if (at < start) return 1 / (1 + (start - at) / FUTURE_HALF_LIFE_MS);
  const end = item.endsAt ?? start;
  if (at <= end) return 1;
  return 1 / (1 + (at - end) / PAST_HALF_LIFE_MS);
}

/** Each entry is a signed contribution; they sum to `score`. */
export type FeedScoreComponents = {
  readonly recency: number;
  readonly kind: number;
  /** Zero or negative. */
  readonly diversity: number;
};

export type RankedFeedItem = {
  readonly item: FeedItem;
  readonly score: number;
  readonly scoreComponents: FeedScoreComponents;
};

/**
 * Not `Partial<FeedWeights>`: `kind` has to be partial one level deeper so a
 * caller (or a replay harness sweeping one knob) can nudge dining without
 * restating events and articles and silently pinning them to today's numbers.
 */
export type FeedWeightOverrides = {
  readonly recency?: number;
  readonly kind?: Partial<Readonly<Record<FeedKind, number>>>;
  readonly diversityPenalty?: number;
};

export type RankFeedOptions = {
  /** Milliseconds. The time cursor, never `Date.now()` read internally. */
  readonly at: number;
  readonly weights?: FeedWeightOverrides;
};

/** Shallow merge, plus a nested merge of `kind` so callers can tune one kind. */
export function resolveWeights(overrides?: FeedWeightOverrides): FeedWeights {
  return {
    recency: overrides?.recency ?? DEFAULT_FEED_WEIGHTS.recency,
    kind: { ...DEFAULT_FEED_WEIGHTS.kind, ...overrides?.kind },
    diversityPenalty: overrides?.diversityPenalty ?? DEFAULT_FEED_WEIGHTS.diversityPenalty,
  };
}

/**
 * Total order. Score first, then newest, then id.
 *
 * The id tiebreak looks like paranoia and is not: ingest emits rows in
 * whatever order the upstream returned them, so without it a replay of the
 * same day can produce a different page and no one can tell whether the
 * weights changed or the crawler did.
 */
function compareRanked(a: RankedFeedItem, b: RankedFeedItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.item.timestamp !== b.item.timestamp) return b.item.timestamp - a.item.timestamp;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/**
 * Score every item and return them in ranked order.
 *
 * The diversity penalty is assigned from the BASE (recency + kind) ordering
 * and then frozen. Defining it against the final order would make it its own
 * fixed point — the penalty changes the order, which changes the penalty —
 * and a score that depends on iteration count is not a score anyone can
 * replay. So: rank by base, hand out `-n * penalty` for the n items from that
 * source that already outranked this one, re-sort once, done.
 */
export function rankFeed(items: readonly FeedItem[], options: RankFeedOptions): RankedFeedItem[] {
  const weights = resolveWeights(options.weights);
  const at = options.at;

  const base = items.map((item) => ({
    item,
    recency: timeRelevance(item, at) * weights.recency,
    kind: weights.kind[item.kind],
  }));

  base.sort((a, b) => {
    const delta = b.recency + b.kind - (a.recency + a.kind);
    if (delta !== 0) return delta;
    if (a.item.timestamp !== b.item.timestamp) return b.item.timestamp - a.item.timestamp;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });

  const seenBySource = new Map<string, number>();
  const ranked = base.map((row) => {
    const seen = seenBySource.get(row.item.sourceId) ?? 0;
    seenBySource.set(row.item.sourceId, seen + 1);
    // Guarded against negative zero: `-0 * penalty` is `-0`, which survives
    // JSON round-trips as `-0` and fails `Object.is` against `0`. An offline
    // replay comparing today's components against a stored run would report a
    // diff on every unpenalized item.
    const diversity = seen === 0 ? 0 : -seen * weights.diversityPenalty;
    return {
      item: row.item,
      score: row.recency + row.kind + diversity,
      scoreComponents: { recency: row.recency, kind: row.kind, diversity },
    };
  });

  ranked.sort(compareRanked);
  return ranked;
}

/** No source may hold more than this share of a rendered page. */
export const MAX_SOURCE_SHARE = 0.3;
/** No source may hold more than this many CONSECUTIVE slots. */
export const MAX_SOURCE_RUN = 2;
export const DEFAULT_PAGE_SIZE = 20;

/** Which constraint had to be dropped to fill the page, if any. */
export type FeedRelaxation = "share" | "run";

export type AssembledFeed = {
  readonly items: readonly RankedFeedItem[];
  /**
   * Empty on a healthy page. Reported rather than swallowed so a replay can
   * measure how often the campus only had one source talking.
   */
  readonly relaxed: readonly FeedRelaxation[];
};

export type AssembleFeedOptions = {
  readonly pageSize?: number;
  readonly maxSourceShare?: number;
  readonly maxSourceRun?: number;
};

/** How many of the last slots already belong to `sourceId`. */
function trailingRun(page: readonly RankedFeedItem[], sourceId: string): number {
  let run = 0;
  for (let i = page.length - 1; i >= 0; i -= 1) {
    const row = page[i];
    if (!row || row.item.sourceId !== sourceId) break;
    run += 1;
  }
  return run;
}

/**
 * Ranked items → the page actually rendered, obeying the diversity rules.
 *
 * Greedy: repeatedly take the highest-scoring item that violates nothing.
 * Greedy is right here because the score already encodes preference, so any
 * swap that improves diversity at the cost of taking a lower item is a swap
 * the caller can see and reason about, unlike a global optimum nobody can
 * explain to a student asking why the Herald is at the top.
 *
 * DEGRADATION. The two rules can be jointly unsatisfiable — a day when only
 * one source published cannot fill six slots at 30% each and cannot avoid a
 * run of three. When that happens the page is FILLED ANYWAY, relaxing in a
 * fixed order, and the relaxation is reported:
 *
 *   1. the 30% share cap goes first. It exists to stop one loud source
 *      dominating a page that had alternatives; when there are no
 *      alternatives it is protecting nothing.
 *   2. the no-three-in-a-row rule goes only if the page still cannot fill.
 *      It is the one a reader can see, so it is the last to go.
 *
 * The alternative — truncating to a short, diverse page — was rejected: a
 * four-item feed reads as "nothing is happening on campus", which is a worse
 * and less recoverable lie than "the Herald posted a lot today". Callers that
 * disagree can look at `relaxed` and truncate themselves.
 *
 * The share cap is computed against the page's ACTUAL length, not the
 * requested `pageSize`, so "no more than 30%" holds for what is on screen
 * rather than for a page size that never materialized.
 */
export function assembleFeed(
  ranked: readonly RankedFeedItem[],
  options: AssembleFeedOptions = {},
): AssembledFeed {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxShare = options.maxSourceShare ?? MAX_SOURCE_SHARE;
  const maxRun = options.maxSourceRun ?? MAX_SOURCE_RUN;

  const pageLength = Math.min(Math.max(0, pageSize), ranked.length);
  if (pageLength === 0) return { items: [], relaxed: [] };

  // `max(1, …)` because floor(3 * 0.3) is 0, and a cap of zero admits nothing.
  const cap = Math.max(1, Math.floor(pageLength * maxShare));

  const remaining = ranked.slice();
  const page: RankedFeedItem[] = [];
  const taken = new Map<string, number>();
  const relaxed = new Set<FeedRelaxation>();

  while (page.length < pageLength && remaining.length > 0) {
    let clean = -1;
    let overCap = -1;

    for (let i = 0; i < remaining.length; i += 1) {
      const row = remaining[i];
      if (!row) continue;
      const source = row.item.sourceId;
      const underRun = trailingRun(page, source) < maxRun;
      if (!underRun) continue;
      if ((taken.get(source) ?? 0) < cap) {
        clean = i;
        break;
      }
      // `remaining` is score-ordered, so the first over-cap candidate that
      // still respects the run rule is the best relaxation available.
      if (overCap < 0) overCap = i;
    }

    // Nothing respects the run rule → everything left is the source already
    // sitting at the bottom of the page. Take the best of it (index 0).
    const pick = clean >= 0 ? clean : overCap >= 0 ? overCap : 0;
    const chosen = remaining[pick];
    if (!chosen) break;

    const source = chosen.item.sourceId;
    if ((taken.get(source) ?? 0) >= cap) relaxed.add("share");
    if (trailingRun(page, source) >= maxRun) relaxed.add("run");

    page.push(chosen);
    taken.set(source, (taken.get(source) ?? 0) + 1);
    remaining.splice(pick, 1);
  }

  // Fixed order so assertions and logs do not depend on which rule broke first.
  const order: FeedRelaxation[] = ["share", "run"];
  return { items: page, relaxed: order.filter((rule) => relaxed.has(rule)) };
}

export type FeedInput = {
  readonly events?: readonly EventOut[];
  readonly publications?: PublicationsDocument | null;
  readonly dining?: DiningDocument | null;
};

export type BuildFeedOptions = RankFeedOptions &
  AssembleFeedOptions & {
    readonly diningLookaheadMs?: number;
  };

/**
 * Adapters → dedup → rank → assemble, in the one order that is correct.
 *
 * Dedup runs BEFORE ranking so a duplicate cannot consume a source's share of
 * the page, and assembly runs after ranking because the diversity rules are
 * about the output order and there is no output order until things are ranked.
 *
 * Every input is optional: React Query hands back `undefined` while loading,
 * and a feed that throws because the dining artifact is one second late is a
 * blank screen for no reason.
 */
export function buildFeed(input: FeedInput, options: BuildFeedOptions): AssembledFeed {
  const items: FeedItem[] = [
    ...eventsToFeed(input.events ?? []),
    ...articlesToFeed(input.publications),
    ...diningToFeed(input.dining, options.at, options.diningLookaheadMs),
  ];
  return assembleFeed(rankFeed(dedupeFeed(items), options), options);
}
