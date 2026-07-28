import type { Category } from "@brownsync/contract";
import { decodeEntities } from "../util";

/**
 * LiveWhale `event_types` → taxonomy (DATA_CONTRACT §4) mapping.
 *
 * Derived from the recorded real feed (fixtures/livewhale-events.json,
 * 2026-07-28; counts out of 1000 rows):
 *
 * | event_type                              | n   | category   |
 * |-----------------------------------------|-----|------------|
 * | Performances, Concerts and Exhibitions  | 256 | arts       |
 * | Lectures, Seminars and Workshops        |  86 | academic   |
 * | Free Food                               |  28 | food       |
 * | Social Event, Study Break               |  20 | social     |
 * | Conferences and Colloquia               |   9 | academic   |
 * | Awards, Receptions and Celebrations     |   1 | social     |
 * | Open to the Public                      | 417 | (audience qualifier — ignored) |
 *
 * Decisions, per that real data:
 * - Priority when an event carries several topical types: the rarer, more
 *   student-actionable signal wins — food > arts > social > academic. A
 *   lecture that advertises Free Food is surfaced as `food` (taxonomy defines
 *   food as "dining, free food"); everything academic-flavored collapses to
 *   `academic` last.
 * - 625/1000 rows carry NO topical type at all, so a group-name fallback table
 *   catches the unambiguous publishers (Athletics → athletics, Academic
 *   Calendar deadlines → admin, Tisch Career Center → career, CAPS/Chaplains/
 *   Health & Wellness → wellness, HR → admin).
 * - Final fallback is `academic`, NOT `admin` or `social`: sampling the
 *   unmapped remainder shows info sessions, dissertation defenses, office
 *   hours and orientation programming — talk/lecture-shaped academic life.
 *   `social` is only ever assigned via the explicit types above.
 */
export const EVENT_TYPE_CATEGORIES: ReadonlyArray<readonly [string, Category]> = [
  ["Free Food", "food"],
  ["Performances, Concerts and Exhibitions", "arts"],
  ["Social Event, Study Break", "social"],
  ["Awards, Receptions and Celebrations", "social"],
  ["Conferences and Colloquia", "academic"],
  ["Lectures, Seminars and Workshops", "academic"],
];

/** Audience qualifiers, not topics — never influence the category. */
export const IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set(["Open to the Public"]);

/** Publisher-group fallback for rows with no topical event_type (keys entity-decoded). */
export const GROUP_CATEGORIES: Readonly<Record<string, Category>> = {
  athletics: "athletics",
  "academic calendar": "admin",
  "human resources": "admin",
  "tisch career center": "career",
  "counseling and psychological services": "wellness",
  "office of the chaplains and religious life": "wellness",
  "student health & wellness": "wellness",
};

export const FALLBACK_CATEGORY: Category = "academic";

/** LiveWhale group names arrive HTML-encoded ("Alumni &amp; Friends") — normalize before lookup. */
export function groupKey(name: string): string {
  return decodeEntities(name).trim().toLowerCase();
}

export function categorize(
  eventTypes: readonly string[] | null | undefined,
  group: string | null | undefined,
): Category {
  const present = new Set(
    (eventTypes ?? []).map((t) => t.trim()).filter((t) => !IGNORED_EVENT_TYPES.has(t)),
  );
  for (const [type, category] of EVENT_TYPE_CATEGORIES) {
    if (present.has(type)) return category;
  }
  if (group) {
    const fallback = GROUP_CATEGORIES[groupKey(group)];
    if (fallback) return fallback;
  }
  return FALLBACK_CATEGORY;
}
