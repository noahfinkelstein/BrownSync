import type { EventOut, HealthOut, MeetingOut, OrgOut, PlaceOut } from "@brownsync/contract";

/**
 * API-shaped fixture data (DATA_CONTRACT.md §3 response shapes), generated
 * deterministically relative to a `base` instant so "starting in 18 min" is
 * always starting in 18 min — in Vitest (fixed base) and in fixture-mode dev
 * (base = now). Shared across Phase 2 lanes; MSW handlers in ./handlers.ts
 * serve exactly this data.
 */

export type FixtureData = {
  base: Date;
  events: EventOut[];
  places: PlaceOut[];
  orgs: OrgOut[];
  meetings: MeetingOut[];
  health: HealthOut;
};

const MIN = 60_000;

const iso = (base: Date, offsetMin: number): string =>
  new Date(base.getTime() + offsetMin * MIN).toISOString();

export const FIXTURE_PLACES: PlaceOut[] = [
  {
    id: "sayles-hall",
    name: "Sayles Hall",
    aliases: ["Sayles"],
    kind: "academic",
    lat: 41.8262,
    lng: -71.4032,
    address: "79 Waterman St",
  },
  {
    id: "salomon-center",
    name: "Salomon Center",
    aliases: ["Salomon", "Salomon Center for Teaching"],
    kind: "academic",
    lat: 41.8266,
    lng: -71.4029,
    address: "79 Waterman St",
  },
  {
    id: "barus-holley",
    name: "Barus & Holley",
    aliases: ["B&H", "Barus and Holley"],
    kind: "academic",
    lat: 41.8267,
    lng: -71.3999,
    address: "184 Hope St",
  },
  {
    id: "lindemann-pac",
    name: "The Lindemann Performing Arts Center",
    aliases: ["The Lindemann", "PAC"],
    kind: "other",
    lat: 41.8296,
    lng: -71.4014,
    address: "144 Angell St",
  },
  {
    id: "faunce-house",
    name: "Stephen Robert '62 Campus Center",
    aliases: ["Faunce", "Faunce House"],
    kind: "other",
    lat: 41.8267,
    lng: -71.4025,
    address: "75 Waterman St",
  },
  {
    id: "andrews-commons",
    name: "Andrews Commons",
    aliases: ["Andrews"],
    kind: "dining",
    lat: 41.8302,
    lng: -71.4021,
    address: "211 Bowen St",
  },
  {
    id: "omac",
    name: "Olney-Margolies Athletic Center",
    aliases: ["OMAC"],
    kind: "athletic",
    lat: 41.8298,
    lng: -71.3972,
    address: "235 Hope St",
  },
  {
    id: "john-hay-library",
    name: "John Hay Library",
    aliases: ["The Hay"],
    kind: "library",
    lat: 41.8258,
    lng: -71.4046,
    address: "20 Prospect St",
  },
  {
    id: "main-green",
    name: "The College Green",
    aliases: ["Main Green"],
    kind: "outdoor",
    lat: 41.8262,
    lng: -71.4025,
    address: null,
  },
];

export const FIXTURE_ORGS: OrgOut[] = [
  {
    id: "brown-outing-club",
    name: "Brown Outing Club",
    kind: "club",
    category: "club",
    description: "Trips, gear, and the outdoors — open to all experience levels.",
    url: "https://brownoutingclub.example.edu",
    instagram: "brownoutingclub",
    defaultPlaceId: "faunce-house",
  },
  {
    id: "cs-department",
    name: "Department of Computer Science",
    kind: "department",
    category: "academic",
    description: null,
    url: "https://cs.brown.example.edu",
    instagram: null,
    defaultPlaceId: "barus-holley",
  },
  {
    id: "brown-athletics",
    name: "Brown Athletics",
    kind: "athletics",
    category: "athletics",
    description: null,
    url: "https://brownbears.example.com",
    instagram: "brownu_bears",
    defaultPlaceId: "omac",
  },
  {
    id: "brown-lecture-board",
    name: "Brown Lecture Board",
    kind: "club",
    category: "academic",
    description: "Brings speakers to campus.",
    url: null,
    instagram: null,
    defaultPlaceId: "salomon-center",
  },
];

type EventSeed = {
  id: string;
  title: string;
  description?: string;
  startMin: number;
  /** Minutes after start; null = open-ended. */
  durMin: number | null;
  allDay?: boolean;
  placeId?: string;
  locationRaw?: string;
  orgId?: string;
  category: EventOut["category"];
  tags?: string[];
  url?: string;
  cost?: string;
  source?: string;
  confidence?: number;
  isCanceled?: boolean;
  /** Omit coords even when a place is set (unresolved location). */
  noCoords?: boolean;
};

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EVENT_SEEDS: EventSeed[] = [
  {
    id: uuid(1),
    title: "CS Colloquium: Systems for Machine Learning",
    description:
      "Guest talk on schedulers and memory management for large training clusters. Reception to follow in the Fishbowl.",
    startMin: -40,
    durMin: 90,
    placeId: "barus-holley",
    locationRaw: "Barus & Holley 168",
    orgId: "cs-department",
    category: "academic",
    tags: ["colloquium", "reception"],
    url: "https://events.brown.example.edu/event/cs-colloquium",
  },
  {
    id: uuid(2),
    title: "Outing Club — General Body Meeting",
    description: "Weekend trip signups: Lincoln Woods climbing + a beginner backpacking overnight.",
    startMin: 18,
    durMin: 60,
    placeId: "faunce-house",
    locationRaw: "Petteruti Lounge",
    orgId: "brown-outing-club",
    category: "club",
    tags: ["gbm"],
    url: "https://events.brown.example.edu/event/boc-gbm",
  },
  {
    id: uuid(3),
    title: "Late Night at Andrews",
    description: "Mozzarella sticks after midnight. Meal credit accepted.",
    startMin: 25,
    durMin: 180,
    placeId: "andrews-commons",
    category: "food",
    tags: ["late-night"],
    url: "https://dining.brown.example.edu/late-night",
    cost: "Meal credit",
  },
  {
    id: uuid(4),
    title: "Student Jazz Combos",
    startMin: 95,
    durMin: 90,
    placeId: "lindemann-pac",
    locationRaw: "The Lindemann, Studio 1",
    category: "arts",
    url: "https://events.brown.example.edu/event/jazz-combos",
    cost: "Free",
  },
  {
    id: uuid(5),
    title: "Graduate Student Trivia Night",
    startMin: 180,
    durMin: 120,
    placeId: "faunce-house",
    locationRaw: "The Underground",
    category: "social",
    url: "https://events.brown.example.edu/event/trivia",
  },
  {
    id: uuid(6),
    title: "Volleyball vs. Yale",
    startMin: 320,
    durMin: 120,
    placeId: "omac",
    orgId: "brown-athletics",
    category: "athletics",
    source: "athletics_ics",
    url: "https://brownbears.example.com/calendar",
  },
  {
    id: uuid(7),
    title: "Startup Career Fair",
    description: "40+ companies hiring for internships and new-grad roles. Bring resumes.",
    startMin: 26 * 60,
    durMin: 180,
    placeId: "sayles-hall",
    category: "career",
    url: "https://events.brown.example.edu/event/startup-fair",
  },
  {
    id: uuid(8),
    title: "Sunrise Vinyasa on the Green",
    startMin: 30 * 60,
    durMin: 60,
    placeId: "main-green",
    category: "wellness",
    url: "https://events.brown.example.edu/event/vinyasa",
    cost: "Free",
  },
  {
    id: uuid(9),
    title: "Watson Lecture: AI and Public Policy",
    startMin: 2 * 24 * 60 + 120,
    durMin: 90,
    placeId: "salomon-center",
    locationRaw: "Salomon 101",
    orgId: "brown-lecture-board",
    category: "academic",
    url: "https://events.brown.example.edu/event/watson-ai",
  },
  {
    id: uuid(10),
    title: "Special Collections Open House",
    description: "Rare books and University archives out on tables. Drop in.",
    startMin: 3 * 24 * 60,
    durMin: 240,
    placeId: "john-hay-library",
    category: "admin",
    source: "clubs",
    confidence: 0.62,
    url: "https://library.brown.example.edu/hay-open-house",
  },
  {
    id: uuid(11),
    title: "First-Year Art Exhibit",
    startMin: -6 * 60,
    durMin: 18 * 60,
    allDay: true,
    placeId: "john-hay-library",
    category: "arts",
    url: "https://events.brown.example.edu/event/fy-exhibit",
  },
  {
    id: uuid(12),
    title: "Pumpkin Carving on the Quad",
    startMin: 60,
    durMin: 90,
    placeId: "main-green",
    category: "social",
    isCanceled: true,
    url: "https://events.brown.example.edu/event/pumpkins",
  },
  {
    id: uuid(13),
    title: "Chamber Music Pop-Up",
    description: "Location announced day-of on the group chat.",
    startMin: 4 * 60,
    durMin: 60,
    locationRaw: "TBD",
    category: "arts",
    noCoords: true,
    confidence: 0.7,
    source: "clubs",
  },
];

const placeById = new Map(FIXTURE_PLACES.map((p) => [p.id, p]));
const orgById = new Map(FIXTURE_ORGS.map((o) => [o.id, o]));

function seedToEvent(base: Date, s: EventSeed): EventOut {
  const place = s.placeId ? (placeById.get(s.placeId) ?? null) : null;
  const org = s.orgId ? (orgById.get(s.orgId) ?? null) : null;
  return {
    id: s.id,
    title: s.title,
    description: s.description ?? null,
    start: iso(base, s.startMin),
    end: s.durMin === null ? null : iso(base, s.startMin + s.durMin),
    allDay: s.allDay ?? false,
    lat: s.noCoords ? null : (place?.lat ?? null),
    lng: s.noCoords ? null : (place?.lng ?? null),
    placeId: place?.id ?? null,
    placeName: place?.name ?? null,
    locationRaw: s.locationRaw ?? null,
    orgId: org?.id ?? null,
    orgName: org?.name ?? null,
    category: s.category,
    tags: s.tags ?? [],
    url: s.url ?? null,
    cost: s.cost ?? null,
    source: s.source ?? "livewhale",
    confidence: s.confidence ?? 1,
    isCanceled: s.isCanceled ?? false,
  };
}

type MeetingSeed = {
  id: string;
  courseCode: string;
  title: string;
  instructor?: string;
  days: string;
  startTime: string;
  endTime: string;
  placeId: string;
  room?: string;
};

const MEETING_SEEDS: MeetingSeed[] = [
  {
    id: "202710-10041-0",
    courseCode: "CSCI 0150",
    title: "Introduction to Object-Oriented Programming",
    instructor: "A. van Dam",
    days: "MWF",
    startTime: "09:00",
    endTime: "09:50",
    placeId: "salomon-center",
    room: "101",
  },
  {
    id: "202710-10322-0",
    courseCode: "CSCI 0320",
    title: "Introduction to Software Engineering",
    days: "TTh",
    startTime: "10:30",
    endTime: "11:50",
    placeId: "barus-holley",
    room: "168",
  },
  {
    id: "202710-11204-0",
    courseCode: "MATH 0100",
    title: "Single Variable Calculus, Part II",
    days: "MWF",
    startTime: "10:00",
    endTime: "10:50",
    placeId: "barus-holley",
    room: "166",
  },
  {
    id: "202710-11890-0",
    courseCode: "ECON 0110",
    title: "Principles of Economics",
    days: "MWF",
    startTime: "10:00",
    endTime: "10:50",
    placeId: "salomon-center",
    room: "DECI",
  },
  {
    id: "202710-12055-0",
    courseCode: "ENGL 0900",
    title: "Critical Reading and Writing",
    days: "TTh",
    startTime: "13:00",
    endTime: "14:20",
    placeId: "sayles-hall",
    room: "205",
  },
  {
    id: "202710-12471-0",
    courseCode: "APMA 1650",
    title: "Statistical Inference I",
    days: "MWF",
    startTime: "14:00",
    endTime: "14:50",
    placeId: "barus-holley",
    room: "141",
  },
  {
    id: "202710-13007-0",
    courseCode: "MUSC 0550",
    title: "Chamber Music Performance",
    days: "W",
    startTime: "19:00",
    endTime: "21:00",
    placeId: "lindemann-pac",
  },
];

const dayTokenFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});
const timePartsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_TOKEN: Record<string, string> = {
  Mon: "M",
  Tue: "T",
  Wed: "W",
  Thu: "Th",
  Fri: "F",
  Sat: "S",
  Sun: "Su",
};

/** Campus-time day token (M/T/W/Th/F/S/Su) for an instant. */
export function campusDayToken(d: Date): string {
  return WEEKDAY_TOKEN[dayTokenFmt.format(d)] ?? "M";
}

/** Campus-time minutes since midnight for an instant. */
export function campusMinutes(d: Date): number {
  const [h = "0", m = "0"] = timePartsFmt.format(d).split(":");
  return Number(h) * 60 + Number(m);
}

function seedToMeeting(s: MeetingSeed): MeetingOut {
  const place = placeById.get(s.placeId) ?? null;
  return {
    id: s.id,
    courseCode: s.courseCode,
    title: s.title,
    instructor: s.instructor ?? null,
    days: s.days,
    startTime: s.startTime,
    endTime: s.endTime,
    locationRaw: place ? `${place.name}${s.room ? ` ${s.room}` : ""}` : null,
    placeId: place?.id ?? null,
    placeName: place?.name ?? null,
    room: s.room ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
  };
}

/**
 * Three synthetic sections guaranteed to be IN SESSION at `base` (campus
 * wall-clock), so the classes layer has data no matter when a demo runs.
 */
function inSessionNowMeetings(base: Date): MeetingOut[] {
  const day = campusDayToken(base);
  const minutes = campusMinutes(base);
  const startMin = Math.max(0, minutes - 20);
  const endMin = Math.min(24 * 60 - 1, minutes + 40);
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const mk = (n: number, placeId: string, courseCode: string, title: string): MeetingOut => {
    const place = placeById.get(placeId) ?? null;
    return {
      id: `202710-9990${n}-0`,
      courseCode,
      title,
      instructor: null,
      days: day,
      startTime: hhmm(startMin),
      endTime: hhmm(endMin),
      locationRaw: place?.name ?? null,
      placeId: place?.id ?? null,
      placeName: place?.name ?? null,
      room: null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
    };
  };
  return [
    mk(1, "salomon-center", "PHIL 0990", "The Examined Life"),
    mk(2, "salomon-center", "HIST 0150", "History of Capitalism"),
    mk(3, "barus-holley", "ENGN 0030", "Introduction to Engineering"),
  ];
}

function makeHealth(base: Date): HealthOut {
  return {
    sources: [
      {
        source: "livewhale",
        status: "ok",
        lastRunAt: iso(base, -4),
        lastOkAt: iso(base, -4),
        itemsUpserted: 312,
        error: null,
      },
      {
        source: "athletics_ics",
        status: "ok",
        lastRunAt: iso(base, -32),
        lastOkAt: iso(base, -32),
        itemsUpserted: 58,
        error: null,
      },
      {
        source: "cab",
        status: "ok",
        lastRunAt: iso(base, -6 * 60),
        lastOkAt: iso(base, -6 * 60),
        itemsUpserted: 4102,
        error: null,
      },
      {
        source: "clubs",
        status: "partial",
        lastRunAt: iso(base, -26 * 60),
        lastOkAt: iso(base, -50 * 60),
        itemsUpserted: 389,
        error: "12 org pages failed to parse",
      },
      {
        source: "bdh",
        status: "error",
        lastRunAt: iso(base, -70),
        lastOkAt: iso(base, -13 * 60),
        itemsUpserted: null,
        error: "feed timeout after 3 retries",
      },
    ],
  };
}

/** Build the full deterministic dataset relative to `base`. */
export function makeFixtureData(base: Date): FixtureData {
  return {
    base,
    events: EVENT_SEEDS.map((s) => seedToEvent(base, s)),
    places: FIXTURE_PLACES,
    orgs: FIXTURE_ORGS,
    meetings: [...MEETING_SEEDS.map(seedToMeeting), ...inSessionNowMeetings(base)],
    health: makeHealth(base),
  };
}

/** Well-known fixture ids, handy in tests. */
export const FIXTURE_IDS = {
  inProgressColloquium: uuid(1),
  startingSoonGbm: uuid(2),
  startingSoonLateNight: uuid(3),
  athleticsVolleyball: uuid(6),
  canceledPumpkins: uuid(12),
  noCoordsPopUp: uuid(13),
} as const;
