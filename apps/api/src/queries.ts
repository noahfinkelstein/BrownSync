import type { Sql } from "./db";

/**
 * All SQL lives here, behind the `Queries` interface, so route handlers can
 * be tested with an injected fake. Row shapes are snake_case, exactly what
 * the 0002_api.sql view/functions return; src/mappers.ts converts them to
 * the contract's camelCase Out-shapes.
 */

/** One row of v_events_api / api_events(). */
export type EventApiRow = {
  id: string;
  title: string;
  description: string | null;
  start_ts: Date;
  end_ts: Date | null;
  is_all_day: boolean;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  place_name: string | null;
  location_raw: string | null;
  org_id: string | null;
  org_name: string | null;
  category: string | null;
  tags: string[];
  url: string | null;
  cost: string | null;
  source: string;
  confidence: number;
  is_canceled: boolean;
  merged_sources: string[];
};

/** places columns exposed by the API (contract §1). */
export type PlaceRow = {
  id: string;
  name: string;
  aliases: string[];
  kind: string;
  lat: number;
  lng: number;
  address: string | null;
};

/** organizations columns exposed by the API (contract §1). */
export type OrgRow = {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  description: string | null;
  url: string | null;
  instagram: string | null;
  default_place_id: string | null;
};

/** One row of api_meetings_at(). start/end_time are "HH:MM:SS" strings. */
export type MeetingRow = {
  id: string;
  course_code: string;
  title: string;
  instructor: string | null;
  days: string;
  start_time: string;
  end_time: string;
  location_raw: string | null;
  place_id: string | null;
  place_name: string | null;
  room: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * One row of api_health(). The last three columns come from the
 * `source_registry` left join added in migration 0006; they are null for a
 * source that has run but is not registered.
 */
export type SourceHealthRow = {
  source: string;
  status: string;
  last_run_at: Date | null;
  last_ok_at: Date | null;
  items_upserted: number | null;
  error: string | null;
  stale_after_seconds: number | null;
  enabled: boolean | null;
  label: string | null;
};

export type EventsFilter = {
  from?: Date;
  to?: Date;
  bbox?: { w: number; s: number; e: number; n: number };
  category?: string;
  q?: string;
};

export interface Queries {
  events(filter: EventsFilter): Promise<EventApiRow[]>;
  eventById(id: string): Promise<EventApiRow | null>;
  places(): Promise<PlaceRow[]>;
  placeById(id: string): Promise<PlaceRow | null>;
  /** Canonical events at a place overlapping [from, to], soonest first. */
  eventsByPlace(placeId: string, from: Date, to: Date): Promise<EventApiRow[]>;
  orgs(): Promise<OrgRow[]>;
  orgById(id: string): Promise<OrgRow | null>;
  /** Canonical events for an org, split around `pivot` (usually now). */
  eventsByOrg(
    orgId: string,
    pivot: Date,
  ): Promise<{ upcoming: EventApiRow[]; past: EventApiRow[] }>;
  meetingsAt(at: Date): Promise<MeetingRow[]>;
  meetingsAtByPlace(at: Date, placeId: string): Promise<MeetingRow[]>;
  health(): Promise<SourceHealthRow[]>;
}

export function createQueries(sql: Sql): Queries {
  return {
    async events(f) {
      const rows = await sql`
        select * from api_events(
          ${f.from ?? null}::timestamptz,
          ${f.to ?? null}::timestamptz,
          ${f.bbox?.w ?? null}::float8,
          ${f.bbox?.s ?? null}::float8,
          ${f.bbox?.e ?? null}::float8,
          ${f.bbox?.n ?? null}::float8,
          ${f.category ?? null}::text,
          ${f.q ?? null}::text
        )`;
      return rows as unknown as EventApiRow[];
    },

    async eventById(id) {
      const rows = await sql`
        select * from v_events_api where id = ${id}::uuid limit 1`;
      return (rows[0] as unknown as EventApiRow | undefined) ?? null;
    },

    async places() {
      const rows = await sql`
        select id, name, aliases, kind, lat, lng, address
        from places
        order by name asc`;
      return rows as unknown as PlaceRow[];
    },

    async placeById(id) {
      const rows = await sql`
        select id, name, aliases, kind, lat, lng, address
        from places
        where id = ${id}
        limit 1`;
      return (rows[0] as unknown as PlaceRow | undefined) ?? null;
    },

    async eventsByPlace(placeId, from, to) {
      const rows = await sql`
        select * from v_events_api
        where place_id = ${placeId}
          and start_ts <= ${to}::timestamptz
          and coalesce(end_ts, start_ts) >= ${from}::timestamptz
        order by start_ts asc, id asc
        limit 200`;
      return rows as unknown as EventApiRow[];
    },

    async orgs() {
      const rows = await sql`
        select id, name, kind, category, description, url, instagram, default_place_id
        from organizations
        order by name asc`;
      return rows as unknown as OrgRow[];
    },

    async orgById(id) {
      const rows = await sql`
        select id, name, kind, category, description, url, instagram, default_place_id
        from organizations
        where id = ${id}
        limit 1`;
      return (rows[0] as unknown as OrgRow | undefined) ?? null;
    },

    async eventsByOrg(orgId, pivot) {
      const [upcoming, past] = await Promise.all([
        sql`
          select * from v_events_api
          where org_id = ${orgId} and coalesce(end_ts, start_ts) >= ${pivot}::timestamptz
          order by start_ts asc, id asc
          limit 100`,
        sql`
          select * from v_events_api
          where org_id = ${orgId} and coalesce(end_ts, start_ts) < ${pivot}::timestamptz
          order by start_ts desc, id asc
          limit 100`,
      ]);
      return {
        upcoming: upcoming as unknown as EventApiRow[],
        past: past as unknown as EventApiRow[],
      };
    },

    async meetingsAt(at) {
      const rows = await sql`select * from api_meetings_at(${at}::timestamptz)`;
      return rows as unknown as MeetingRow[];
    },

    async meetingsAtByPlace(at, placeId) {
      const rows = await sql`
        select * from api_meetings_at(${at}::timestamptz) where place_id = ${placeId}`;
      return rows as unknown as MeetingRow[];
    },

    async health() {
      const rows = await sql`select * from api_health()`;
      return rows as unknown as SourceHealthRow[];
    },
  };
}
