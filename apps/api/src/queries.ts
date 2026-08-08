import type {
  MyOrganizations,
  MyUserEvents,
  OrgClaimDecisionResult,
  OrgClaimResult,
  OrgClaimReviewQueue,
  OrgCreateRequest,
  OrgCreateResult,
  OrgEditPatch,
  OrgEditResult,
  OrgLink,
  UserEventCreateRequest,
  UserEventCreateResult,
  UserEventEditPatch,
  UserEventManagement,
  UserEventMutationResult,
} from "@brownsync/contract";
import type { Sql } from "./db";

export type NormalizedUserEventCreateRequest = UserEventCreateRequest & {
  organizationId: string | null;
  description: string | null;
  end: string | null;
  url: string | null;
};

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
  advisor?: string | null;
  funding_category?: string | null;
  website_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  youtube_url?: string | null;
  twitter_url?: string | null;
  tiktok_url?: string | null;
  logo_url?: string | null;
  about_md?: string | null;
  meeting_info?: string | null;
  links?: OrgLink[] | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  overridden_fields?: string[];
  revision?: number;
  updated_at?: Date | null;
};

export type OrganizationQueryFailure =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable";

export type OrganizationQueryResult<T> =
  | { kind: "ok"; value: T }
  | { kind: OrganizationQueryFailure };

type OrgAccessRow = {
  organization_id: string;
  organization_name: string;
  admin_role: "owner" | "editor" | null;
  membership_granted_at: Date | null;
  claim_id: string | null;
  claim_status: "pending" | "approved" | "rejected" | null;
  claim_created_at: Date | null;
  claim_reviewed_at: Date | null;
  claim_review_note: string | null;
};

type OrgClaimRoutineRow = {
  claim_id: string | null;
  claim_status: "pending" | "approved" | "rejected" | null;
  admin_role: "owner" | "editor" | null;
  disposition: "auto_approved" | "pending" | "already_admin" | "already_pending";
};

type OrgReviewableClaimRow = {
  claim_id: string;
  organization_id: string;
  organization_name: string;
  claimant_display_name: string | null;
  claimant_handle: string | null;
  evidence: string | null;
  created_at: Date;
  has_more: boolean;
};

type OrgClaimReviewRoutineRow = {
  claim_status: "approved" | "rejected";
  granted_role: "owner" | "editor" | null;
  changed: boolean;
};

type OrgCreateRoutineRow = {
  organization_id: string;
  revision: number;
  admin_role: "owner";
  disposition: "created" | "already_exists";
};

type OrgEditRoutineRow = {
  revision: number;
  changed: boolean;
};

export type UserEventQueryFailure =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "unavailable";

export type UserEventQueryResult<T> = { kind: "ok"; value: T } | { kind: UserEventQueryFailure };

type UserEventCreateRoutineRow = {
  event_id: string;
  revision: number;
  replayed: boolean;
};

type UserEventMutationRoutineRow = {
  event_id: string;
  revision: number;
  changed: boolean;
};

type UserEventManagementRow = {
  event_id: string;
  organization_id: string | null;
  organization_name: string | null;
  title: string;
  description: string | null;
  start_ts: Date;
  end_ts: Date | null;
  place_id: string;
  place_name: string;
  location_raw: string | null;
  category: UserEventManagement["category"];
  url: string | null;
  status: UserEventManagement["status"];
  moderation_state: UserEventManagement["moderationState"];
  revision: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type UserEventManagementListRow = UserEventManagementRow & {
  has_more: boolean;
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

/** One row of v_articles_api / api_articles() (migration 0021). */
export type ArticleApiRow = {
  id: string;
  title: string;
  url: string;
  published_at: Date;
  author: string | null;
  source: string;
  publication: string;
  license: string;
};

export type ArticlesFilter = {
  from: Date;
  to: Date;
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
  /** Articles with published_at in [from, to], newest first (contract v1.9). */
  articles(filter: ArticlesFilter): Promise<ArticleApiRow[]>;
  health(): Promise<SourceHealthRow[]>;
  /** Owner-only Worker seam; absent only in legacy unit-test fakes. */
  myOrganizations?(actorId: string): Promise<OrganizationQueryResult<MyOrganizations>>;
  /** Owner-only Worker seam; actorId comes from a verified JWT, never a body. */
  createOrganization?(
    actorId: string,
    input: OrgCreateRequest,
  ): Promise<OrganizationQueryResult<OrgCreateResult>>;
  /** Owner-only Worker seam; actorId comes from a verified JWT, never a body. */
  claimOrganization?(
    actorId: string,
    organizationId: string,
    evidence?: string,
  ): Promise<OrganizationQueryResult<OrgClaimResult>>;
  /** Reviewer/owner queue; database independently restricts row visibility. */
  reviewableOrganizationClaims?(
    actorId: string,
    page: {
      afterCreatedAt: string | null;
      afterClaimId: string | null;
      limit: number;
    },
  ): Promise<OrganizationQueryResult<OrgClaimReviewQueue>>;
  /** Atomic review routine; actorId comes only from the verified JWT. */
  decideOrganizationClaim?(
    actorId: string,
    claimId: string,
    approve: boolean,
    note?: string,
  ): Promise<OrganizationQueryResult<OrgClaimDecisionResult>>;
  /** Owner-only Worker seam; actorId comes from a verified JWT, never a body. */
  editOrganization?(
    actorId: string,
    organizationId: string,
    expectedRevision: number,
    patch: OrgEditPatch,
  ): Promise<OrganizationQueryResult<OrgEditResult>>;
  /** Atomic idempotent create; actorId comes only from the verified JWT. */
  createUserEvent?(
    actorId: string,
    input: NormalizedUserEventCreateRequest,
  ): Promise<UserEventQueryResult<UserEventCreateResult>>;
  /** Optimistic event edit; actorId comes only from the verified JWT. */
  editUserEvent?(
    actorId: string,
    eventId: string,
    expectedRevision: number,
    patch: UserEventEditPatch,
  ): Promise<UserEventQueryResult<UserEventMutationResult>>;
  /** Idempotent safety-reducing cancellation; deliberately has no revision input. */
  deleteUserEvent?(
    actorId: string,
    eventId: string,
  ): Promise<UserEventQueryResult<UserEventMutationResult>>;
  /** Bounded management page for creator/current organization-admin authority. */
  myUserEvents?(
    actorId: string,
    page: {
      beforeUpdatedAt: string | null;
      beforeEventId: string | null;
      limit: number;
    },
  ): Promise<UserEventQueryResult<MyUserEvents>>;
  /** Authority-scoped management detail without creator identity. */
  myUserEvent?(
    actorId: string,
    eventId: string,
  ): Promise<UserEventQueryResult<UserEventManagement>>;
}

const ORG_BAD_REQUEST_ERRORS = new Set([
  "BROWNSYNC_ORG_NAME_INVALID",
  "BROWNSYNC_ORG_EVIDENCE_INVALID",
  "BROWNSYNC_ORG_DECISION_INVALID",
  "BROWNSYNC_ORG_ROLE_INVALID",
  "BROWNSYNC_ORG_PATCH_INVALID",
  "BROWNSYNC_ORG_LINKS_INVALID",
  "BROWNSYNC_ORG_QUEUE_INVALID",
]);
const ORG_FORBIDDEN_ERRORS = new Set([
  "BROWNSYNC_ORG_UNAUTHORIZED",
  "BROWNSYNC_ORG_FORBIDDEN",
  "BROWNSYNC_ORG_SELF_REVIEW",
  "BROWNSYNC_ORG_SELF_ADMIN_CHANGE",
  "BROWNSYNC_ORG_LAST_OWNER",
]);
const ORG_NOT_FOUND_ERRORS = new Set([
  "BROWNSYNC_ORG_NOT_FOUND",
  "BROWNSYNC_ORG_CLAIM_NOT_FOUND",
  "BROWNSYNC_ORG_ADMIN_NOT_FOUND",
  "BROWNSYNC_ORG_TARGET_NOT_FOUND",
]);
const ORG_CONFLICT_ERRORS = new Set([
  "BROWNSYNC_ORG_NOT_CLAIMABLE",
  "BROWNSYNC_ORG_CLAIM_ALREADY_DECIDED",
  "BROWNSYNC_ORG_REVISION_CONFLICT",
  "BROWNSYNC_ORG_NAME_EXISTS",
  "BROWNSYNC_ORG_CREATE_CONFLICT",
]);

function organizationFailure(error: unknown): OrganizationQueryFailure {
  const message =
    error !== null &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  if (ORG_BAD_REQUEST_ERRORS.has(message)) return "bad_request";
  if (ORG_FORBIDDEN_ERRORS.has(message)) return "forbidden";
  if (ORG_NOT_FOUND_ERRORS.has(message)) return "not_found";
  if (ORG_CONFLICT_ERRORS.has(message)) return "conflict";
  if (message === "BROWNSYNC_ORG_RATE_LIMITED") return "rate_limited";
  return "unavailable";
}

function organizationPatch(patch: OrgEditPatch): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (Object.hasOwn(patch, "description")) output.description = patch.description;
  if (Object.hasOwn(patch, "aboutMd")) output.about_md = patch.aboutMd;
  if (Object.hasOwn(patch, "meetingInfo")) output.meeting_info = patch.meetingInfo;
  if (Object.hasOwn(patch, "links")) output.links = patch.links;
  return output;
}

const USER_EVENT_BAD_REQUEST_ERRORS = new Set([
  "BROWNSYNC_USER_EVENT_INPUT_INVALID",
  "BROWNSYNC_USER_EVENT_PATCH_INVALID",
  "BROWNSYNC_USER_EVENT_QUEUE_INVALID",
]);
const USER_EVENT_FORBIDDEN_ERRORS = new Set([
  "BROWNSYNC_USER_EVENT_UNAUTHORIZED",
  "BROWNSYNC_USER_EVENT_FORBIDDEN",
  "BROWNSYNC_USER_EVENT_ACCOUNT_TOO_NEW",
]);
const USER_EVENT_NOT_FOUND_ERRORS = new Set([
  "BROWNSYNC_USER_EVENT_NOT_FOUND",
  "BROWNSYNC_USER_EVENT_ORGANIZATION_NOT_FOUND",
]);
const USER_EVENT_CONFLICT_ERRORS = new Set([
  "BROWNSYNC_USER_EVENT_REQUEST_CONFLICT",
  "BROWNSYNC_USER_EVENT_REVISION_CONFLICT",
]);
const USER_EVENT_UNPROCESSABLE_ERRORS = new Set([
  "BROWNSYNC_USER_EVENT_PLACE_NOT_FOUND",
  "BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED",
]);

function userEventFailure(error: unknown): UserEventQueryFailure {
  const message =
    error !== null &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  if (USER_EVENT_BAD_REQUEST_ERRORS.has(message)) return "bad_request";
  if (USER_EVENT_FORBIDDEN_ERRORS.has(message)) return "forbidden";
  if (USER_EVENT_NOT_FOUND_ERRORS.has(message)) return "not_found";
  if (USER_EVENT_CONFLICT_ERRORS.has(message)) return "conflict";
  if (USER_EVENT_UNPROCESSABLE_ERRORS.has(message)) return "unprocessable";
  if (message === "BROWNSYNC_USER_EVENT_RATE_LIMITED") return "rate_limited";
  return "unavailable";
}

function userEventPatch(patch: UserEventEditPatch): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (Object.hasOwn(patch, "title")) output.title = patch.title;
  if (Object.hasOwn(patch, "description")) output.description = patch.description;
  if (Object.hasOwn(patch, "start")) output.start_ts = patch.start;
  if (Object.hasOwn(patch, "end")) output.end_ts = patch.end;
  if (Object.hasOwn(patch, "category")) output.category = patch.category;
  if (Object.hasOwn(patch, "url")) output.url = patch.url;
  if (Object.hasOwn(patch, "placeId")) output.place_id = patch.placeId;
  if (Object.hasOwn(patch, "locationRaw")) output.location_raw = patch.locationRaw;
  return output;
}

function mapUserEventManagement(row: UserEventManagementRow): UserEventManagement {
  return {
    id: row.event_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    title: row.title,
    description: row.description,
    start: row.start_ts.toISOString(),
    end: row.end_ts?.toISOString() ?? null,
    placeId: row.place_id,
    placeName: row.place_name,
    locationRaw: row.location_raw,
    category: row.category,
    url: row.url,
    status: row.status,
    moderationState: row.moderation_state,
    revision: Number(row.revision),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
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
        from public.v_organizations_api
        order by name asc`;
      return rows as unknown as OrgRow[];
    },

    async orgById(id) {
      const rows = await sql`
        select
          id,
          name,
          kind,
          category,
          description,
          url,
          instagram,
          default_place_id,
          advisor,
          funding_category,
          website_url,
          facebook_url,
          linkedin_url,
          youtube_url,
          twitter_url,
          tiktok_url,
          logo_url,
          about_md,
          meeting_info,
          links,
          avatar_url,
          banner_url,
          overridden_fields,
          revision,
          updated_at
        from public.v_organizations_api
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

    async articles(f) {
      const rows = await sql`
        select * from api_articles(${f.from}::timestamptz, ${f.to}::timestamptz)`;
      return rows as unknown as ArticleApiRow[];
    },

    async health() {
      const rows = await sql`select * from api_health()`;
      return rows as unknown as SourceHealthRow[];
    },

    async myOrganizations(actorId) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_list_org_access(${actorId}::uuid)
          order by organization_name asc, organization_id asc
        `) as unknown as OrgAccessRow[];
        return {
          kind: "ok",
          value: {
            memberships: rows.flatMap((row) =>
              row.admin_role === null || row.membership_granted_at === null
                ? []
                : [
                    {
                      organizationId: row.organization_id,
                      organizationName: row.organization_name,
                      role: row.admin_role,
                      grantedAt: row.membership_granted_at.toISOString(),
                    },
                  ],
            ),
            claims: rows.flatMap((row) =>
              row.claim_id === null || row.claim_status === null || row.claim_created_at === null
                ? []
                : [
                    {
                      id: row.claim_id,
                      organizationId: row.organization_id,
                      organizationName: row.organization_name,
                      status: row.claim_status,
                      createdAt: row.claim_created_at.toISOString(),
                      reviewedAt: row.claim_reviewed_at?.toISOString() ?? null,
                      reviewNote: row.claim_review_note,
                    },
                  ],
            ),
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async createOrganization(actorId, input) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_create_organization(
            ${actorId}::uuid,
            ${input.name}::text,
            ${input.description ?? null}::text,
            ${input.aboutMd ?? null}::text,
            ${input.meetingInfo ?? null}::text,
            ${input.links == null ? null : sql.json(input.links as never)}::jsonb
          )
        `) as unknown as OrgCreateRoutineRow[];
        const row = rows[0];
        if (row === undefined || row.admin_role !== "owner") {
          return { kind: "unavailable" };
        }
        return {
          kind: "ok",
          value: {
            organizationId: row.organization_id,
            revision: Number(row.revision),
            role: "owner",
            disposition: row.disposition === "created" ? "created" : "replayed",
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async claimOrganization(actorId, organizationId, evidence) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_claim_organization(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${evidence ?? null}::text
          )
        `) as unknown as OrgClaimRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            organizationId,
            disposition: row.disposition,
            role: row.admin_role,
            claimId: row.claim_id,
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async reviewableOrganizationClaims(actorId, page) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_list_reviewable_org_claims(
            ${actorId}::uuid,
            ${page.afterCreatedAt}::timestamptz,
            ${page.afterClaimId}::uuid,
            ${page.limit}::integer
          )
          order by created_at asc, claim_id asc
        `) as unknown as OrgReviewableClaimRow[];
        const last = rows.at(-1);
        return {
          kind: "ok",
          value: {
            claims: rows.map((row) => ({
              claimId: row.claim_id,
              organizationId: row.organization_id,
              organizationName: row.organization_name,
              claimantDisplayName: row.claimant_display_name,
              claimantHandle: row.claimant_handle,
              evidence: row.evidence,
              createdAt: row.created_at.toISOString(),
            })),
            next:
              last?.has_more === true
                ? {
                    afterCreatedAt: last.created_at.toISOString(),
                    afterClaimId: last.claim_id,
                  }
                : null,
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async decideOrganizationClaim(actorId, claimId, approve, note) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_review_org_claim(
            ${actorId}::uuid,
            ${claimId}::uuid,
            ${approve}::boolean,
            ${note ?? null}::text
          )
        `) as unknown as OrgClaimReviewRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            claimId,
            status: row.claim_status,
            grantedRole: row.granted_role,
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async editOrganization(actorId, organizationId, expectedRevision, patch) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_edit_organization(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${expectedRevision}::bigint,
            ${sql.json(organizationPatch(patch) as never)}::jsonb
          )
        `) as unknown as OrgEditRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            organizationId,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: organizationFailure(error) };
      }
    },

    async createUserEvent(actorId, input) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_create_user_event(
            ${actorId}::uuid,
            ${input.clientRequestId}::uuid,
            ${input.organizationId}::text,
            ${input.title}::text,
            ${input.description}::text,
            ${input.start}::timestamptz,
            ${input.end}::timestamptz,
            ${input.category}::text,
            ${input.url}::text,
            ${input.placeId ?? null}::text,
            ${input.locationRaw ?? null}::text
          )
        `) as unknown as UserEventCreateRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            eventId: row.event_id,
            revision: Number(row.revision),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: userEventFailure(error) };
      }
    },

    async editUserEvent(actorId, eventId, expectedRevision, patch) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_edit_user_event(
            ${actorId}::uuid,
            ${eventId}::uuid,
            ${expectedRevision}::bigint,
            ${sql.json(userEventPatch(patch) as never)}::jsonb
          )
        `) as unknown as UserEventMutationRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            eventId: row.event_id,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: userEventFailure(error) };
      }
    },

    async deleteUserEvent(actorId, eventId) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_delete_user_event(
            ${actorId}::uuid,
            ${eventId}::uuid
          )
        `) as unknown as UserEventMutationRoutineRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            eventId: row.event_id,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: userEventFailure(error) };
      }
    },

    async myUserEvents(actorId, page) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_list_user_events(
            ${actorId}::uuid,
            ${page.beforeUpdatedAt}::timestamptz,
            ${page.beforeEventId}::uuid,
            ${page.limit}::integer
          )
          order by updated_at desc, event_id desc
        `) as unknown as UserEventManagementListRow[];
        const last = rows.at(-1);
        return {
          kind: "ok",
          value: {
            events: rows.map(mapUserEventManagement),
            next:
              last?.has_more === true
                ? {
                    beforeUpdatedAt: last.updated_at.toISOString(),
                    beforeEventId: last.event_id,
                  }
                : null,
          },
        };
      } catch (error) {
        return { kind: userEventFailure(error) };
      }
    },

    async myUserEvent(actorId, eventId) {
      try {
        const rows = (await sql`
          select *
          from public.brownsync_get_user_event(
            ${actorId}::uuid,
            ${eventId}::uuid
          )
        `) as unknown as UserEventManagementRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return { kind: "ok", value: mapUserEventManagement(row) };
      } catch (error) {
        return { kind: userEventFailure(error) };
      }
    },
  };
}
