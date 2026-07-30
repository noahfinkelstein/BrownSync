/**
 * Dining hours and menus, as data.
 *
 * Kept pure and away from React because every interesting case is a boundary:
 * a hall that closes at 15:00 asked at exactly 15:00, a hall with no services
 * at all (four of seven are shut all summer), a service whose `end` the source
 * left null, and the cursor being scrubbed to next Tuesday rather than now.
 *
 * TIME HANDLING. The artifact's `start`/`end` are ISO-8601 **with offset**
 * (`2026-07-29T07:30:00-04:00`) exactly as Brown publishes them. That is
 * deliberate: `Date.parse` resolves them to the correct instant without the
 * client needing a tz database, and the offset is what makes "closes at 3pm"
 * mean 3pm *in Providence* rather than 3pm wherever the reader is.
 */

export type DiningItem = {
  readonly name: string;
  readonly allergens?: readonly string[];
  readonly icons?: readonly string[];
  readonly description?: string;
};

export type DiningStation = {
  readonly name: string;
  readonly items: readonly DiningItem[];
};

export type DiningService = {
  readonly date: string;
  readonly meal: string;
  readonly name: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly stations: readonly DiningStation[];
};

export type DiningLocation = {
  readonly locationId: string;
  readonly name: string;
  readonly address: string | null;
  readonly placeId: string | null;
  readonly services: readonly DiningService[];
};

export type DiningDocument = {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly attribution: string;
  readonly icon_labels: Readonly<Record<string, string>>;
  readonly locations: readonly DiningLocation[];
};

export type DiningStatus =
  | { readonly kind: "open"; readonly service: DiningService; readonly closesInMs: number | null }
  | { readonly kind: "opens-later"; readonly service: DiningService; readonly opensInMs: number }
  | { readonly kind: "closed" };

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

/**
 * Is this service running at `at`?
 *
 * Half-open on the end: a hall that closes at 15:00 is NOT open at 15:00.
 * Reporting "open" at the exact closing instant sends someone across campus
 * to a locked door, which is the one outcome worth being pedantic about.
 * A null `end` means the source did not publish one — treated as open, since
 * the alternative is hiding a menu that exists.
 */
export function isServing(service: DiningService, at: number): boolean {
  const start = ms(service.start);
  if (start === null || at < start) return false;
  const end = ms(service.end);
  return end === null || at < end;
}

/** Whether the hall is serving at `at`, and what's next if it isn't. */
export function statusAt(location: DiningLocation, at: number): DiningStatus {
  let soonest: { service: DiningService; start: number } | null = null;

  for (const service of location.services) {
    if (isServing(service, at)) {
      const end = ms(service.end);
      return { kind: "open", service, closesInMs: end === null ? null : end - at };
    }
    const start = ms(service.start);
    if (start !== null && start > at && (soonest === null || start < soonest.start)) {
      soonest = { service, start };
    }
  }

  if (soonest) {
    return { kind: "opens-later", service: soonest.service, opensInMs: soonest.start - at };
  }
  return { kind: "closed" };
}

/** Services on the given campus-local calendar date, in start order. */
export function servicesOn(location: DiningLocation, isoDate: string): DiningService[] {
  return location.services
    .filter((service) => service.date === isoDate)
    .slice()
    .sort((a, b) => (ms(a.start) ?? 0) - (ms(b.start) ?? 0));
}

/**
 * The campus-local calendar date at an instant, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` is WRONG here and is the classic bug: it uses
 * UTC, so anything after 20:00 EDT reports tomorrow's date and the panel shows
 * tomorrow's breakfast while the user is standing in tonight's dinner queue.
 */
export const CAMPUS_TZ = "America/New_York";

export function campusDate(at: number, timeZone: string = CAMPUS_TZ): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the artifact's date key.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** `7:30 AM` in campus local time, from an offset-bearing ISO string. */
export function formatServiceTime(iso: string | null, timeZone: string = CAMPUS_TZ): string | null {
  const value = ms(iso);
  if (value === null) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Halls sorted for display: open first, then opening soonest, then shut. */
export function sortByAvailability(
  locations: readonly DiningLocation[],
  at: number,
): DiningLocation[] {
  const rank = (location: DiningLocation): [number, number, string] => {
    const status = statusAt(location, at);
    if (status.kind === "open")
      return [0, status.closesInMs ?? Number.MAX_SAFE_INTEGER, location.name];
    if (status.kind === "opens-later") return [1, status.opensInMs, location.name];
    return [2, 0, location.name];
  };
  return locations.slice().sort((a, b) => {
    const [ra, sa, na] = rank(a);
    const [rb, sb, nb] = rank(b);
    return ra - rb || sa - sb || na.localeCompare(nb);
  });
}

/** Dietary icons present across a service, for the summary line. */
export function dietaryIcons(service: DiningService): string[] {
  const found = new Set<string>();
  for (const station of service.stations) {
    for (const item of station.items) {
      for (const icon of item.icons ?? []) found.add(icon);
    }
  }
  return [...found].sort();
}
