import {
  type EventOut,
  EventOutSchema,
  type MeetingOut,
  MeetingOutSchema,
  type OrgOut,
  OrgOutSchema,
  type PlaceOut,
  PlaceOutSchema,
} from "@brownsync/contract";

/**
 * API-shaped fixtures for lane H tests. Every object is parsed through the
 * contract schemas at module load, so contract drift fails the suite loudly.
 * Tests NEVER hit live servers (handoff §8) — MSW serves these.
 */

export const PLACES: PlaceOut[] = [
  {
    id: "salomon-center",
    name: "Salomon Center",
    aliases: ["Salomon", "Salomon Center for Teaching"],
    kind: "academic",
    lat: 41.8262,
    lng: -71.4032,
    address: "79 Waterman St",
  },
  {
    id: "sayles-hall",
    name: "Sayles Hall",
    aliases: ["Sayles"],
    kind: "academic",
    lat: 41.8258,
    lng: -71.4025,
    address: "81 Waterman St",
  },
  {
    id: "barus-holley",
    name: "Barus & Holley",
    aliases: ["B&H", "BH"],
    kind: "academic",
    lat: 41.8272,
    lng: -71.3998,
    address: "184 Hope St",
  },
].map((p) => PlaceOutSchema.parse(p));

export const ORGS: OrgOut[] = [
  {
    id: "brown-outing-club",
    name: "Brown Outing Club",
    kind: "club",
    category: "club",
    description: "Hiking, climbing, and paddling trips around New England.",
    url: "https://brownoutingclub.example.edu",
    instagram: "brownoutingclub",
    defaultPlaceId: null,
  },
  {
    id: "brown-university-orchestra",
    name: "Brown University Orchestra",
    kind: "club",
    category: "arts",
    description: "The university's flagship symphony orchestra.",
    url: null,
    instagram: null,
    defaultPlaceId: "sayles-hall",
  },
].map((o) => OrgOutSchema.parse(o));

export const MEETINGS: MeetingOut[] = [
  {
    id: "202610-17423-0",
    courseCode: "CSCI 0150",
    title: "Introduction to Object-Oriented Programming",
    instructor: "K. Fisler",
    days: "MWF",
    startTime: "14:00",
    endTime: "14:50",
    locationRaw: "Salomon Center 101",
    placeId: "salomon-center",
    placeName: "Salomon Center",
    room: "101",
    lat: 41.8262,
    lng: -71.4032,
  },
  {
    // Second weekly pattern of the same course — palette must dedupe.
    id: "202610-17423-1",
    courseCode: "CSCI 0150",
    title: "Introduction to Object-Oriented Programming",
    instructor: "K. Fisler",
    days: "Th",
    startTime: "16:00",
    endTime: "16:50",
    locationRaw: "Salomon Center 101",
    placeId: "salomon-center",
    placeName: "Salomon Center",
    room: "101",
    lat: 41.8262,
    lng: -71.4032,
  },
  {
    id: "202610-18001-0",
    courseCode: "MATH 0100",
    title: "Introductory Calculus, Part II",
    instructor: null,
    days: "TTh",
    startTime: "13:00",
    endTime: "14:20",
    locationRaw: "Sayles Hall 105",
    placeId: "sayles-hall",
    placeName: "Sayles Hall",
    room: "105",
    lat: 41.8258,
    lng: -71.4025,
  },
].map((m) => MeetingOutSchema.parse(m));

type EventSeed = Partial<EventOut> & { id: string; title: string; start: string };

/** Contract-shaped event with sensible defaults; parsed on the way out. */
export function mkEvent(seed: EventSeed): EventOut {
  return EventOutSchema.parse({
    description: null,
    end: null,
    allDay: false,
    lat: 41.8262,
    lng: -71.4032,
    placeId: "salomon-center",
    placeName: "Salomon Center",
    locationRaw: null,
    orgId: null,
    orgName: null,
    category: "academic",
    tags: [],
    url: "https://events.brown.edu/event/1",
    cost: null,
    source: "livewhale",
    confidence: 1,
    isCanceled: false,
    ...seed,
  });
}

export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Static event set used by palette + page tests (times relative to import). */
export const EVENTS: EventOut[] = [
  mkEvent({
    id: "e-salomon-lecture",
    title: "Salomon Lecture: Quantum Computing",
    start: hoursFromNow(3),
    category: "academic",
  }),
  mkEvent({
    id: "e-outing-gbm",
    title: "Outing Club GBM",
    start: hoursFromNow(5),
    category: "club",
    placeId: "sayles-hall",
    placeName: "Sayles Hall",
    orgId: "brown-outing-club",
    orgName: "Brown Outing Club",
    source: "clubs",
    confidence: 0.9,
  }),
  mkEvent({
    id: "e-orchestra-concert",
    title: "Orchestra Fall Concert",
    start: hoursFromNow(26),
    category: "arts",
    placeId: "sayles-hall",
    placeName: "Sayles Hall",
    orgId: "brown-university-orchestra",
    orgName: "Brown University Orchestra",
  }),
];

export const PAST_EVENTS: EventOut[] = [
  mkEvent({
    id: "e-outing-past",
    title: "Fall Break Camping Trip Info Session",
    start: hoursFromNow(-72),
    category: "club",
    orgId: "brown-outing-club",
    orgName: "Brown Outing Club",
    source: "clubs",
  }),
];
