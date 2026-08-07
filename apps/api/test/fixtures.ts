import type {
  ArticleApiRow,
  EventApiRow,
  MeetingRow,
  OrgRow,
  PlaceRow,
  Queries,
  SourceHealthRow,
} from "../src/queries";

/**
 * Realistic rows matching what 0002_api.sql's view/functions return (columns
 * per contract §1). Injected into createApp via fakeQueries() — tests never
 * touch a live database.
 */

export const eventRow: EventApiRow = {
  id: "a3c1b7f2-4d5e-4f60-8a9b-1c2d3e4f5a6b",
  title: "Provost's Lecture: Mapping College Hill",
  description: "A talk on campus cartography and the 3D building model.",
  start_ts: new Date("2026-09-15T22:00:00Z"), // 18:00 America/New_York
  end_ts: new Date("2026-09-15T23:30:00Z"),
  is_all_day: false,
  lat: 41.8268,
  lng: -71.4025,
  place_id: "salomon-center",
  place_name: "Salomon Center",
  location_raw: "Salomon Center 101",
  org_id: "brown-lecture-board",
  org_name: "Brown Lecture Board",
  category: "academic",
  tags: ["lecture", "maps"],
  url: "https://events.brown.edu/event/12345",
  cost: null,
  source: "livewhale",
  confidence: 1,
  is_canceled: false,
  merged_sources: ["cab"],
};

export const placeRow: PlaceRow = {
  id: "salomon-center",
  name: "Salomon Center",
  aliases: ["Salomon", "Salomon Center for Teaching"],
  kind: "academic",
  lat: 41.8268,
  lng: -71.4025,
  address: "79 Waterman St, Providence, RI 02912",
};

export const orgRow: OrgRow = {
  id: "brown-lecture-board",
  name: "Brown Lecture Board",
  kind: "club",
  category: "academic",
  description: "Brings speakers to campus.",
  url: "https://brownlectureboard.org",
  instagram: "brownlectureboard",
  default_place_id: "salomon-center",
};

export const meetingRow: MeetingRow = {
  id: "202610-17538-0",
  course_code: "CSCI 0150",
  title: "Introduction to Object-Oriented Programming",
  instructor: "A. van Dam",
  days: "TTh",
  start_time: "14:00:00",
  end_time: "15:20:00",
  location_raw: "Salomon Center 101",
  place_id: "salomon-center",
  place_name: "Salomon Center",
  room: "101",
  lat: 41.8268,
  lng: -71.4025,
};

export const healthRows: SourceHealthRow[] = [
  {
    source: "livewhale",
    status: "ok",
    last_run_at: new Date("2026-07-28T12:00:00Z"),
    last_ok_at: new Date("2026-07-28T12:00:00Z"),
    items_upserted: 321,
    error: null,
    stale_after_seconds: 2400,
    enabled: true,
    label: "LiveWhale events",
  },
  {
    source: "cab",
    status: "error",
    last_run_at: new Date("2026-07-28T11:00:00Z"),
    last_ok_at: new Date("2026-07-27T11:00:00Z"),
    items_upserted: null,
    error: "HTTP 500 from cab.brown.edu",
    // Runs, but not in source_registry: the registry columns come back null
    // and must read as "use your own defaults", never as "switched off".
    stale_after_seconds: null,
    enabled: null,
    label: null,
  },
  {
    // A recorded refusal: registered, never ran, and never will.
    source: "providence_gov",
    status: "never",
    last_run_at: null,
    last_ok_at: null,
    items_upserted: null,
    error: null,
    stale_after_seconds: null,
    enabled: false,
    label: "City of Providence events",
  },
];

/** One row of api_articles() (migration 0021), as the brown_news producer writes it. */
export const articleRow: ArticleApiRow = {
  id: "6f2d9a1c-7b3e-4c8d-9e0f-2a4b6c8d0e1f",
  title:
    "Meet the scientists behind the science, at Brown's Multidisciplinary Teaching Laboratories",
  url: "https://www.brown.edu/news/2026-08-03/multidisciplinary-teaching-laboratories",
  published_at: new Date("2026-08-03T04:00:00Z"),
  author: null,
  source: "brown_news",
  publication: "Brown News",
  license: "headline_only",
};

export function fakeQueries(overrides: Partial<Queries> = {}): Queries {
  const base: Queries = {
    events: async () => [eventRow],
    eventById: async (id) => (id === eventRow.id ? eventRow : null),
    places: async () => [placeRow],
    placeById: async (id) => (id === placeRow.id ? placeRow : null),
    eventsByPlace: async () => [eventRow],
    orgs: async () => [orgRow],
    orgById: async (id) => (id === orgRow.id ? orgRow : null),
    eventsByOrg: async () => ({ upcoming: [eventRow], past: [] }),
    meetingsAt: async () => [meetingRow],
    meetingsAtByPlace: async () => [meetingRow],
    articles: async () => [articleRow],
    health: async () => healthRows,
  };
  return { ...base, ...overrides };
}
