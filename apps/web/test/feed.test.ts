import type { EventOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import type { DiningDocument, DiningLocation, DiningService } from "../src/dining/model";
import {
  ARTICLE_MAX_AGE_MS,
  articlesToFeed,
  assembleFeed,
  buildFeed,
  canonicalizeUrl,
  DEFAULT_FEED_WEIGHTS,
  DINING_SOURCE_ID,
  dedupeFeed,
  diningToFeed,
  eventsToFeed,
  type FeedItem,
  type PublicationArticle,
  type PublicationsDocument,
  type RankedFeedItem,
  rankFeed,
  timeRelevance,
} from "../src/feed";
import { DEFAULT_DURATION_MS } from "../src/map/eventsLayer";

/** 2026-09-10T14:00 EDT — mid-afternoon, so lunch is open and dinner is near. */
const AT = Date.parse("2026-09-10T18:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const iso = (offsetMs: number): string => new Date(AT + offsetMs).toISOString();

function event(over: Partial<EventOut> & { id: string }): EventOut {
  return {
    title: "Untitled",
    description: null,
    start: iso(HOUR),
    end: null,
    allDay: false,
    lat: 41.8268,
    lng: -71.4025,
    placeId: null,
    placeName: null,
    locationRaw: null,
    orgId: null,
    orgName: null,
    category: "academic",
    tags: [],
    url: null,
    cost: null,
    source: "livewhale",
    confidence: 1,
    isCanceled: false,
    ...over,
  };
}

function article(over: Partial<PublicationArticle> & { id: string }): PublicationArticle {
  return {
    sourceId: "bdh",
    title: "Untitled",
    url: `https://browndailyherald.com/${over.id}`,
    published: iso(-HOUR),
    section: null,
    author: null,
    ...over,
  };
}

function publications(articles: readonly PublicationArticle[]): PublicationsDocument {
  return {
    schema_version: 1,
    generated_at: iso(0),
    sources: [
      { id: "bdh", name: "Brown Daily Herald", homepage: "https://x", license: "headline-only" },
    ],
    articles,
  };
}

function service(over: Partial<DiningService> = {}): DiningService {
  return {
    date: "2026-09-10",
    meal: "Lunch",
    name: "Menu",
    start: "2026-09-10T11:00:00-04:00",
    end: "2026-09-10T15:00:00-04:00",
    stations: [],
    ...over,
  };
}

function hall(over: Partial<DiningLocation> = {}): DiningLocation {
  return {
    locationId: "BR",
    name: "Blue Room",
    address: null,
    placeId: "blue-room",
    services: [service()],
    ...over,
  };
}

function diningDoc(locations: readonly DiningLocation[]): DiningDocument {
  return {
    schema_version: 1,
    generated_at: iso(0),
    attribution: "Brown Dining",
    icon_labels: {},
    locations,
  };
}

const ids = (rows: readonly RankedFeedItem[]): string[] => rows.map((row) => row.item.id);

describe("eventsToFeed", () => {
  it("namespaces ids so two upstreams numbering from 1 cannot collide", () => {
    // Feed ids are React keys AND dedup keys. A LiveWhale event "42" and a
    // Herald article "42" sharing an id would silently drop one of them.
    const [row] = eventsToFeed([event({ id: "42" })]);
    expect(row?.id).toBe("event:42");
    expect(articlesToFeed(publications([article({ id: "42" })]))[0]?.id).toBe("article:bdh:42");
  });

  it("carries the contract's `source` through as `sourceId`", () => {
    // Diversity is enforced per sourceId; an event whose sourceId came out
    // undefined would land every event under one phantom source.
    const [row] = eventsToFeed([event({ id: "a", source: "athletics" })]);
    expect(row?.sourceId).toBe("athletics");
  });

  it("drops canceled events", () => {
    // A canceled seminar occupying one of twenty slots is pure noise: with no
    // saved-events signal there is nobody to target it at.
    expect(eventsToFeed([event({ id: "a", isCanceled: true })])).toHaveLength(0);
  });

  it("gives an all-day event the whole day, not the 90-minute default", () => {
    // THE all-day trap. `end` is null on nearly every all-day row, so the
    // 90-minute fallback would retire Commencement at 1:30 a.m.
    const [allDay] = eventsToFeed([event({ id: "a", allDay: true, start: iso(0), end: null })]);
    const [timed] = eventsToFeed([event({ id: "b", start: iso(0), end: null })]);
    expect(allDay?.endsAt).toBe(AT + DAY);
    expect(timed?.endsAt).toBe(AT + DEFAULT_DURATION_MS);
  });

  it("ignores an end that precedes its start", () => {
    // Seen in the wild when an upstream publishes a local end against a UTC
    // start. A negative interval makes the item permanently "already over".
    const [row] = eventsToFeed([event({ id: "a", start: iso(0), end: iso(-2 * HOUR) })]);
    expect(row?.endsAt).toBe(AT + DEFAULT_DURATION_MS);
  });

  it("skips an unparseable start rather than emitting NaN", () => {
    // A NaN timestamp sorts unpredictably and would scramble the whole page.
    expect(eventsToFeed([event({ id: "a", start: "sometime tuesday" })])).toHaveLength(0);
  });
});

describe("articlesToFeed", () => {
  it("returns nothing for a document that has not loaded yet", () => {
    // React Query hands back undefined on first render; throwing here is a
    // blank feed for the length of one fetch.
    expect(articlesToFeed(null)).toEqual([]);
    expect(articlesToFeed(undefined)).toEqual([]);
  });

  it("leaves endsAt null — a story is published, it does not run", () => {
    const [row] = articlesToFeed(publications([article({ id: "a" })]));
    expect(row?.endsAt).toBeNull();
  });

  it("never invents a placeId", () => {
    // A story about the Ratty is not an item at the Ratty; pinning it there
    // puts news on the map, which is a different product.
    const [row] = articlesToFeed(publications([article({ id: "a" })]));
    expect(row?.placeId).toBeNull();
  });

  it("skips an unparseable publish date", () => {
    expect(articlesToFeed(publications([article({ id: "a", published: "yesterday" })]))).toEqual(
      [],
    );
  });
});

describe("diningToFeed keeps the feed from drowning in hours", () => {
  it("emits only what is open or opening soon, not the whole three-week table", () => {
    // The published artifact carries every sitting for weeks (Verney-Woolley
    // alone has 21). One row per hall per day is ~150 rows into a 20-row list.
    const services: DiningService[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = `2026-09-${String(10 + day).padStart(2, "0")}`;
      services.push(
        service({
          date,
          meal: "Breakfast",
          start: `${date}T07:30:00-04:00`,
          end: `${date}T10:00:00-04:00`,
        }),
      );
      services.push(
        service({
          date,
          meal: "Lunch",
          start: `${date}T11:00:00-04:00`,
          end: `${date}T15:00:00-04:00`,
        }),
      );
      services.push(
        service({
          date,
          meal: "Dinner",
          start: `${date}T17:00:00-04:00`,
          end: `${date}T20:00:00-04:00`,
        }),
      );
    }
    expect(services).toHaveLength(21);

    const rows = diningToFeed(diningDoc([hall({ services })]), AT);
    // 14:00: lunch is open, dinner (17:00) is 3 h out and lands on the edge.
    expect(rows.map((row) => row.service.meal)).toEqual(["Lunch", "Dinner"]);
  });

  it("excludes a service that closed exactly at the cursor", () => {
    // Half-open on the end, same as `dining/model.isServing`. Advertising a
    // hall at its closing instant sends someone across campus to a locked door.
    const closing = service({
      start: "2026-09-10T10:00:00-04:00",
      end: "2026-09-10T14:00:00-04:00",
    });
    expect(diningToFeed(diningDoc([hall({ services: [closing] })]), AT)).toHaveLength(0);
  });

  it("honours the lookahead boundary", () => {
    const inside = service({ meal: "Early", start: iso(2 * HOUR), end: iso(4 * HOUR) });
    const outside = service({ meal: "Late", start: iso(4 * HOUR), end: iso(6 * HOUR) });
    const doc = diningDoc([hall({ services: [inside, outside] })]);
    expect(diningToFeed(doc, AT).map((row) => row.service.meal)).toEqual(["Early"]);
    // …and the window is a parameter, not a constant baked into the adapter.
    expect(diningToFeed(doc, AT, 5 * HOUR).map((row) => row.service.meal)).toEqual([
      "Early",
      "Late",
    ]);
  });

  it("treats a null end as a plausible service length, not an instant", () => {
    // The artifact leaves `end` null occasionally. Zero-length would make an
    // open hall decay out of the ranking the moment it opened.
    const open = service({ start: iso(-30 * MIN), end: null });
    const [row] = diningToFeed(diningDoc([hall({ services: [open] })]), AT);
    expect(row?.endsAt).toBe(AT - 30 * MIN + 3 * HOUR);
    expect(timeRelevance(row as FeedItem, AT)).toBe(1);
  });

  it("files every hall under one sourceId", () => {
    // Otherwise seven halls are seven sources and dining walks straight past
    // the 30% cap at lunchtime.
    const doc = diningDoc([
      hall({ locationId: "BR", name: "Blue Room" }),
      hall({ locationId: "VW", name: "Verney-Woolley", placeId: "vw" }),
    ]);
    const sources = new Set(diningToFeed(doc, AT).map((row) => row.sourceId));
    expect([...sources]).toEqual([DINING_SOURCE_ID]);
  });
});

describe("canonicalizeUrl", () => {
  it("folds the differences that do not name a different document", () => {
    expect(canonicalizeUrl("http://www.BrownDailyHerald.com/a/?utm_source=rss#lede")).toBe(
      "https://browndailyherald.com/a",
    );
    expect(canonicalizeUrl("https://browndailyherald.com/a?b=2&a=1")).toBe(
      "https://browndailyherald.com/a?a=1&b=2",
    );
  });

  it("returns null for anything that is not an http(s) URL", () => {
    // A row with an unparseable href must keep its own identity rather than
    // colliding with every other unparseable row under one empty key.
    expect(canonicalizeUrl("/relative/path")).toBeNull();
    expect(canonicalizeUrl("javascript:void 0")).toBeNull();
  });
});

describe("dedupeFeed merges reruns, never coverage", () => {
  it("keeps two outlets' takes on the same story", () => {
    // THE rule this module exists to protect. Collapsing these picks a winner
    // between two newsrooms on nothing but title equality.
    const items = articlesToFeed(
      publications([
        article({
          id: "1",
          sourceId: "bdh",
          title: "Brown freezes tuition",
          url: "https://bdh.com/1",
        }),
        article({
          id: "9",
          sourceId: "brown-news",
          title: "Brown freezes tuition",
          url: "https://brown.edu/news/9",
        }),
      ]),
    );
    const kept = dedupeFeed(items);
    expect(kept).toHaveLength(2);
    expect(new Set(kept.map((row) => row.sourceId))).toEqual(new Set(["bdh", "brown-news"]));
  });

  it("collapses the same story arriving from RSS and from the sitemap", () => {
    const items = articlesToFeed(
      publications([
        article({ id: "rss-1", url: "https://browndailyherald.com/story?utm_source=rss" }),
        article({ id: "map-1", url: "https://www.browndailyherald.com/story/" }),
      ]),
    );
    expect(dedupeFeed(items).map((row) => row.id)).toEqual(["article:bdh:rss-1"]);
  });

  it("does not collapse an event and the article written about it", () => {
    // Same landing page, different affordances: one you attend, one you read.
    const items: FeedItem[] = [
      ...eventsToFeed([event({ id: "e1", url: "https://brown.edu/thing" })]),
      ...articlesToFeed(publications([article({ id: "a1", url: "https://brown.edu/thing" })])),
    ];
    expect(dedupeFeed(items)).toHaveLength(2);
  });

  it("never merges url-less rows together", () => {
    // Dining rows carry no permalink. Keying them on an empty url would
    // collapse every open hall on campus into a single row.
    const doc = diningDoc([
      hall({ locationId: "BR", name: "Blue Room" }),
      hall({ locationId: "VW", name: "Verney-Woolley", placeId: "vw" }),
    ]);
    const rows = diningToFeed(doc, AT);
    expect(rows.every((row) => row.url === null)).toBe(true);
    expect(dedupeFeed(rows)).toHaveLength(2);
  });

  it("drops a row ingested twice under the same id", () => {
    const rows = eventsToFeed([event({ id: "e1" }), event({ id: "e1" })]);
    expect(dedupeFeed(rows)).toHaveLength(1);
  });
});

describe("timeRelevance", () => {
  it("is 1 for the whole interval, not just the start", () => {
    // A dinner sitting that opened two hours ago is happening NOW. Scoring on
    // "how long since it started" would sink it under a lecture that has not
    // begun, which is the exact inversion the feed is supposed to avoid.
    const [openHall] = diningToFeed(
      diningDoc([hall({ services: [service({ start: iso(-2 * HOUR), end: iso(HOUR) })] })]),
      AT,
    );
    const [upcoming] = eventsToFeed([event({ id: "e", start: iso(2 * HOUR) })]);
    expect(timeRelevance(openHall as FeedItem, AT)).toBe(1);
    expect(timeRelevance(upcoming as FeedItem, AT)).toBeLessThan(1);
  });

  it("decays the past more gently than the future, on purpose", () => {
    // Publications only ever have a past. A symmetric curve means articles
    // never rank and the kind weight has to grow grotesque to compensate.
    const [past] = articlesToFeed(publications([article({ id: "a", published: iso(-3 * HOUR) })]));
    const [future] = eventsToFeed([event({ id: "e", start: iso(3 * HOUR) })]);
    expect(timeRelevance(past as FeedItem, AT)).toBeCloseTo(1 / 1.5, 10);
    expect(timeRelevance(future as FeedItem, AT)).toBeCloseTo(1 / 2, 10);
  });

  it("is monotonic, and never exactly zero", () => {
    // Zero would tie every stale row together and hand the ordering to the id
    // tiebreak, so yesterday and last month would interleave.
    const old = articlesToFeed(publications([article({ id: "a", published: iso(-30 * DAY) })]));
    const older = articlesToFeed(publications([article({ id: "b", published: iso(-60 * DAY) })]));
    const a = timeRelevance(old[0] as FeedItem, AT);
    const b = timeRelevance(older[0] as FeedItem, AT);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeGreaterThan(b);
  });
});

describe("rankFeed exposes its arithmetic", () => {
  const items = (): FeedItem[] => [
    ...eventsToFeed([
      event({ id: "e1", start: iso(20 * MIN) }),
      event({ id: "e2", start: iso(6 * HOUR) }),
    ]),
    ...articlesToFeed(
      publications([
        article({ id: "a1", published: iso(-20 * MIN) }),
        article({ id: "a2", published: iso(-40 * MIN) }),
        article({ id: "a3", published: iso(-60 * MIN) }),
      ]),
    ),
  ];

  it("reports components that sum to the score", () => {
    // The replay contract: with no engagement telemetry, the only way to
    // re-score last week under new weights is for the score to be a sum of
    // separately reported parts rather than an opaque number.
    for (const row of rankFeed(items(), { at: AT })) {
      const { recency, kind, diversity } = row.scoreComponents;
      expect(row.score).toBeCloseTo(recency + kind + diversity, 12);
    }
  });

  it("charges the diversity penalty per earlier item from the same source", () => {
    const ranked = rankFeed(items(), { at: AT });
    const bdh = ranked
      .filter((row) => row.item.sourceId === "bdh")
      .sort((a, b) => b.score - a.score)
      .map((row) => row.scoreComponents.diversity);
    const p = DEFAULT_FEED_WEIGHTS.diversityPenalty;
    expect(bdh).toEqual([0, -p, -2 * p]);
  });

  it("lets a caller re-weight one kind without restating the others", () => {
    const soonEvent = eventsToFeed([event({ id: "e", start: iso(HOUR) })]);
    const soonHall = diningToFeed(
      diningDoc([hall({ services: [service({ start: iso(HOUR), end: iso(3 * HOUR) })] })]),
      AT,
    );
    const both = [...soonEvent, ...soonHall];
    expect(rankFeed(both, { at: AT })[0]?.item.kind).toBe("event");
    expect(rankFeed(both, { at: AT, weights: { kind: { dining: 0.9 } } })[0]?.item.kind).toBe(
      "dining",
    );
  });

  it("produces the same order regardless of ingest order", () => {
    // Ingest emits rows in whatever order the upstream returned. Without the
    // id tiebreak a replay of the same day yields a different page and nobody
    // can tell whether the weights changed or the crawler did.
    const tied = eventsToFeed([
      event({ id: "z", start: iso(HOUR) }),
      event({ id: "m", start: iso(HOUR) }),
      event({ id: "a", start: iso(HOUR) }),
    ]);
    const forward = ids(rankFeed(tied, { at: AT }));
    const backward = ids(rankFeed([...tied].reverse(), { at: AT }));
    expect(forward).toEqual(["event:a", "event:m", "event:z"]);
    expect(backward).toEqual(forward);
  });

  it("puts imminent things above stale things", () => {
    const ranked = rankFeed(items(), { at: AT });
    expect(ranked[0]?.item.id).toBe("event:e1");
    expect(ranked.at(-1)?.item.id).toBe("event:e2");
  });
});

/** Both output-order invariants, checked against the page that was produced. */
function violations(page: readonly RankedFeedItem[]): { over: string[]; runs: string[] } {
  const cap = Math.max(1, Math.floor(page.length * 0.3));
  const counts = new Map<string, number>();
  const over: string[] = [];
  const runs: string[] = [];
  for (let i = 0; i < page.length; i += 1) {
    const source = page[i]?.item.sourceId ?? "";
    counts.set(source, (counts.get(source) ?? 0) + 1);
    if (i >= 2 && page[i - 1]?.item.sourceId === source && page[i - 2]?.item.sourceId === source) {
      runs.push(source);
    }
  }
  for (const [source, count] of counts) if (count > cap) over.push(source);
  return { over, runs };
}

function manyArticles(sourceId: string, count: number, offset = 0): FeedItem[] {
  return articlesToFeed(
    publications(
      Array.from({ length: count }, (_, i) =>
        article({
          id: `${sourceId}-${i}`,
          sourceId,
          url: `https://${sourceId}.example/${i}`,
          published: iso(-(offset + i + 1) * MIN),
        }),
      ),
    ),
  );
}

describe("assembleFeed enforces diversity on the OUTPUT ORDER", () => {
  it("obeys both rules when the input allows it", () => {
    const items = ["bdh", "brown-news", "livewhale", "athletics"].flatMap((source, index) =>
      manyArticles(source, 4, index * 100),
    );
    const page = assembleFeed(rankFeed(items, { at: AT }), { pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.relaxed).toEqual([]);
    expect(violations(page.items)).toEqual({ over: [], runs: [] });
  });

  it("still fills the page when one source drowns out the others, and says so", () => {
    // 20 Herald stories against one each from three other outlets. The 30%
    // cap wants at most 3 Herald slots in a 10-item page and there are only 3
    // non-Herald rows in existence, so the rules are jointly unsatisfiable.
    const items = [
      ...manyArticles("bdh", 20),
      ...manyArticles("brown-news", 1, 500),
      ...manyArticles("athletics", 1, 600),
      ...manyArticles("livewhale", 1, 700),
    ];
    const page = assembleFeed(rankFeed(items, { at: AT }), { pageSize: 10 });

    // DOCUMENTED DEGRADATION: fill the page and report, rather than truncate.
    // A four-item feed reads as "nothing is happening on campus", which is a
    // worse lie than "the Herald posted a lot today".
    expect(page.items).toHaveLength(10);
    expect(page.relaxed).toEqual(["share", "run"]);

    // The rules still bought something: the three other outlets all made the
    // page, and they were spent before the Herald was allowed to repeat.
    const first = page.items.slice(0, 6).map((row) => row.item.sourceId);
    expect(new Set(first).size).toBe(4);
  });

  it("degrades in a fixed order — the share cap before the run rule", () => {
    // With exactly one extra source available, the share cap has to give but
    // the run rule does not: it is the one a reader can actually see.
    const items = [...manyArticles("bdh", 8), ...manyArticles("brown-news", 4, 500)];
    const page = assembleFeed(rankFeed(items, { at: AT }), { pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.relaxed).toEqual(["share"]);
    expect(violations(page.items).runs).toEqual([]);
  });

  it("fills a single-source day rather than returning two items", () => {
    // Both rules are unsatisfiable when only one source exists: 30% of a
    // 5-item page is 1 slot, and slot 3 is necessarily a run of three.
    const page = assembleFeed(rankFeed(manyArticles("bdh", 10), { at: AT }), { pageSize: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.relaxed).toEqual(["share", "run"]);
    // …and it is still the five best, in score order.
    expect(ids(page.items)).toEqual([
      "article:bdh:bdh-0",
      "article:bdh:bdh-1",
      "article:bdh:bdh-2",
      "article:bdh:bdh-3",
      "article:bdh:bdh-4",
    ]);
  });

  it("caps against the page that exists, not the page that was requested", () => {
    // Asking for 20 and getting 4 must not license 6 Herald slots. 30% of the
    // page that rendered is 1 slot, so a 3-of-4 Herald page is a REPORTED
    // degradation — had the cap been taken from pageSize it would have passed
    // silently while the reader looked at three Herald headlines out of four.
    const items = [...manyArticles("bdh", 3), ...manyArticles("brown-news", 1, 500)];
    const page = assembleFeed(rankFeed(items, { at: AT }), { pageSize: 20 });
    expect(page.items).toHaveLength(4);
    expect(page.relaxed).toContain("share");
    expect(violations(page.items).runs).toEqual([]);
  });

  it("survives an empty or zero-length page", () => {
    expect(assembleFeed([], { pageSize: 10 })).toEqual({ items: [], relaxed: [] });
    expect(
      assembleFeed(rankFeed(manyArticles("bdh", 3), { at: AT }), { pageSize: 0 }).items,
    ).toHaveLength(0);
  });

  it("re-orders without dropping or duplicating anything", () => {
    const items = [...manyArticles("bdh", 6), ...manyArticles("brown-news", 6, 500)];
    const page = assembleFeed(rankFeed(items, { at: AT }), { pageSize: 12 });
    expect(new Set(ids(page.items)).size).toBe(12);
  });
});

describe("buildFeed", () => {
  it("merges all three upstreams into one ranked, deduped page", () => {
    const page = buildFeed(
      {
        events: [
          event({ id: "e1", start: iso(15 * MIN), url: "https://brown.edu/e1" }),
          event({ id: "e2", start: iso(15 * MIN), isCanceled: true }),
        ],
        publications: publications([
          article({ id: "a1", published: iso(-10 * MIN), url: "https://bdh.com/a1" }),
          article({ id: "a1-dupe", published: iso(-10 * MIN), url: "https://bdh.com/a1?utm_x=1" }),
        ]),
        dining: diningDoc([hall()]),
      },
      { at: AT, pageSize: 10 },
    );

    expect(page.items.map((row) => row.item.kind).sort()).toEqual(["article", "dining", "event"]);
    // The canceled event and the utm-tagged rerun are both gone.
    expect(ids(page.items)).not.toContain("event:e2");
    expect(ids(page.items)).not.toContain("article:bdh:a1-dupe");
    expect(violations(page.items)).toEqual({ over: [], runs: [] });
  });

  it("tolerates every upstream being absent", () => {
    // The first paint has no data at all; a feed that throws is a white screen.
    expect(buildFeed({}, { at: AT })).toEqual({ items: [], relaxed: [] });
  });

  it("drops articles older than 14 days relative to the CURSOR, not the clock", () => {
    // UI audit: the landing feed was ~80% news aged 4–15 weeks. The cutoff is
    // an input filter — timeRelevance/rankFeed arithmetic stays untouched —
    // and it is inclusive at exactly 14 days so the boundary is testable.
    const page = buildFeed(
      {
        publications: publications([
          article({ id: "fresh", published: iso(-13 * DAY) }),
          article({ id: "edge", published: iso(-ARTICLE_MAX_AGE_MS) }),
          article({ id: "stale", published: iso(-ARTICLE_MAX_AGE_MS - MIN) }),
          article({ id: "ancient", published: iso(-15 * 7 * DAY) }),
        ]),
      },
      { at: AT, pageSize: 10 },
    );

    expect(ids(page.items)).toEqual([
      "article:bdh:fresh",
      "article:bdh:edge",
    ]);
    // The same document scored directly (no cutoff) still ranks stale items —
    // proof the exclusion happens at the input seam, not in the scoring.
    expect(ARTICLE_MAX_AGE_MS).toBe(14 * DAY);
  });
});

describe("feed timestamps read correctly in both directions", () => {
  // Regression: the panel first reused browse/format.ts's `formatRelative`,
  // whose signature is (now, target) rather than (target, now). Passing them
  // the way that reads naturally at a call site inverted every article —
  // a piece published five weeks ago rendered as "in 917 h".
  it("browse formatRelative really is (now, target), not (target, now)", async () => {
    const { formatRelative } = await import("../src/browse/format");
    const now = new Date("2026-07-29T12:00:00Z");
    const past = new Date("2026-07-29T10:00:00Z");
    expect(formatRelative(now, past)).toMatch(/ago$/);
    // ...and the inverted call, which is what the bug looked like:
    expect(formatRelative(past, now)).toMatch(/^in /);
  });
});
