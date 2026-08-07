import {
  MyOrganizationsSchema,
  OrgClaimDecisionResultSchema,
  OrgClaimResultSchema,
  OrgClaimReviewQueueSchema,
  OrgCreateResultSchema,
  OrgDetailOutSchema,
  OrgEditResultSchema,
  OrgEnrichedDetailSchema,
  type OrgLink,
} from "@brownsync/contract";
import { describe, expect, it, vi } from "vitest";
import { buildOpenApiDocument, createApp } from "../src/app";
import type { Authenticator, RateLimiterBinding } from "../src/auth";
import type { Queries } from "../src/queries";
import { eventRow, fakeQueries, orgRow } from "./fixtures";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const ORG_ID = "brown-lecture-board";
const CLAIM_ID = "20000000-0000-4000-8000-000000000001";

type OrganizationQueryOverrides = {
  createOrganization?: (
    actorId: string,
    input: {
      name: string;
      description?: string | null;
      aboutMd?: string | null;
      meetingInfo?: string | null;
      links?: OrgLink[] | null;
    },
  ) => Promise<unknown>;
  myOrganizations?: (actorId: string) => Promise<unknown>;
  reviewableOrganizationClaims?: (
    actorId: string,
    page: {
      afterCreatedAt: string | null;
      afterClaimId: string | null;
      limit: number;
    },
  ) => Promise<unknown>;
  decideOrganizationClaim?: (
    actorId: string,
    claimId: string,
    approve: boolean,
    note?: string,
  ) => Promise<unknown>;
  claimOrganization?: (
    actorId: string,
    organizationId: string,
    evidence?: string,
  ) => Promise<unknown>;
  editOrganization?: (
    actorId: string,
    organizationId: string,
    expectedRevision: number,
    patch: {
      description?: string | null;
      aboutMd?: string | null;
      meetingInfo?: string | null;
      links?: OrgLink[] | null;
    },
  ) => Promise<unknown>;
};

function queries(overrides: OrganizationQueryOverrides = {}): Queries {
  return Object.assign(fakeQueries(), overrides) as unknown as Queries;
}

const authenticated: Authenticator = async (c, next) => {
  c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
  c.set("authentication", { oauthAuthenticatedAt: null });
  await next();
};

function blocked(status: 401 | 403): Authenticator {
  return async (c) =>
    c.json(
      {
        error: {
          code: status === 401 ? "unauthorized" : "membership_required",
          message: "Synthetic auth rejection.",
        },
      },
      status,
    );
}

function limiter(success = true): RateLimiterBinding {
  return { limit: vi.fn(async () => ({ success })) };
}

const myOrganizations = {
  memberships: [
    {
      organizationId: ORG_ID,
      organizationName: "Brown Lecture Board",
      role: "owner" as const,
      grantedAt: "2026-07-30T00:00:00.000Z",
    },
  ],
  claims: [
    {
      id: CLAIM_ID,
      organizationId: "brown-band",
      organizationName: "Brown Band",
      status: "pending" as const,
      createdAt: "2026-07-30T00:01:00.000Z",
      reviewedAt: null,
      reviewNote: null,
    },
  ],
};

describe("authenticated organization routes", () => {
  it("creates an organization as the verified actor and returns a named 201 result", async () => {
    const create = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        organizationId: "brownsync-builders",
        revision: 0,
        role: "owner" as const,
        disposition: "created" as const,
      },
    }));
    const app = createApp(queries({ createOrganization: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });
    const input = {
      name: "  BrownSync Builders  ",
      description: "Campus software.",
      aboutMd: null,
      meetingInfo: "Wednesdays at 6",
      links: [{ platform: "website", url: "https://example.edu/builders" }],
    };

    const response = await app.request("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = OrgCreateResultSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body).toEqual({
      organizationId: "brownsync-builders",
      revision: 0,
      role: "owner",
      disposition: "created",
    });
    expect(create).toHaveBeenCalledWith(ACTOR_ID, {
      ...input,
      name: "BrownSync Builders",
    });
  });

  it("returns an identical organization create retry as a 201 replay", async () => {
    const create = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        organizationId: "brownsync-builders",
        revision: 1,
        role: "owner" as const,
        disposition: "replayed" as const,
      },
    }));
    const app = createApp(queries({ createOrganization: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "BrownSync Builders", description: "Same payload" }),
    });

    expect(response.status).toBe(201);
    expect(OrgCreateResultSchema.parse(await response.json())).toEqual({
      organizationId: "brownsync-builders",
      revision: 1,
      role: "owner",
      disposition: "replayed",
    });
  });

  it("returns a changed-payload organization create retry as 409", async () => {
    const app = createApp(
      queries({
        createOrganization: vi.fn(async () => ({ kind: "conflict" as const })),
      }),
      { authenticator: authenticated, userWriteLimiter: limiter() },
    );

    const response = await app.request("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "BrownSync Builders", description: "Changed payload" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "conflict" },
    });
  });

  it.each(["id", "actorId", "source", "contactEmails", "adminRole", "avatarUrl"])(
    "rejects forged organization creation field %s before querying",
    async (field) => {
      const create = vi.fn();
      const app = createApp(queries({ createOrganization: create }), {
        authenticator: authenticated,
        userWriteLimiter: limiter(),
      });

      const response = await app.request("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Safe Org", [field]: "forged" }),
      });

      expect(response.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["create", "/api/orgs", "POST", ""],
    ["claim", `/api/orgs/${ORG_ID}/claims`, "POST", "{"],
    ["edit", `/api/orgs/${ORG_ID}`, "PATCH", ""],
    ["decision", `/api/org-claims/${CLAIM_ID}/decision`, "POST", "{"],
  ])("rejects malformed or empty %s JSON before querying", async (_label, path, method, body) => {
    const create = vi.fn();
    const claim = vi.fn();
    const edit = vi.fn();
    const decide = vi.fn();
    const app = createApp(
      queries({
        createOrganization: create,
        claimOrganization: claim,
        editOrganization: edit,
        decideOrganizationClaim: decide,
      }),
      { authenticator: authenticated, userWriteLimiter: limiter() },
    );

    const response = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([401, 403] as const)(
    "rejects with %s before the write limiter or claim query",
    async (status) => {
      const writeLimiter = limiter();
      const claim = vi.fn(async () => ({
        kind: "ok",
        value: {
          organizationId: ORG_ID,
          disposition: "pending",
          role: null,
          claimId: CLAIM_ID,
        },
      }));
      const app = createApp(queries({ claimOrganization: claim }), {
        authenticator: blocked(status),
        userWriteLimiter: writeLimiter,
      });

      const response = await app.request(`/api/orgs/${ORG_ID}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence: "club officer" }),
      });

      expect(response.status).toBe(status);
      expect(writeLimiter.limit).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    },
  );

  it("returns 429 after authentication and before the claim query", async () => {
    const claim = vi.fn();
    const writeLimiter = limiter(false);
    const app = createApp(queries({ claimOrganization: claim }), {
      authenticator: authenticated,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request(`/api/orgs/${ORG_ID}/claims`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ evidence: "club officer" }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-expose-headers")).toBe("Retry-After");
    expect(writeLimiter.limit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(claim).not.toHaveBeenCalled();
  });

  it("lists only the verified actor's memberships after authenticated read limiting", async () => {
    const list = vi.fn(async () => ({ kind: "ok" as const, value: myOrganizations }));
    const readLimiter = limiter();
    const writeLimiter = limiter();
    const app = createApp(queries({ myOrganizations: list }), {
      authenticator: authenticated,
      userReadLimiter: readLimiter,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request("/api/me/organizations");
    const body = MyOrganizationsSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toEqual(myOrganizations);
    expect(JSON.stringify(body)).not.toContain("evidence");
    expect(list).toHaveBeenCalledWith(ACTOR_ID);
    expect(readLimiter.limit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
    expect(writeLimiter.limit).not.toHaveBeenCalled();
  });

  it("authenticates HEAD access-list requests before the limiter or query", async () => {
    const list = vi.fn();
    const readLimiter = limiter();
    const writeLimiter = limiter();
    const app = createApp(queries({ myOrganizations: list }), {
      authenticator: blocked(401),
      userReadLimiter: readLimiter,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request("/api/me/organizations", { method: "HEAD" });

    expect(response.status).toBe(401);
    expect(readLimiter.limit).not.toHaveBeenCalled();
    expect(writeLimiter.limit).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("maps a database-side membership rejection on the access list to 403", async () => {
    const app = createApp(
      queries({
        myOrganizations: vi.fn(async () => ({ kind: "forbidden" as const })),
      }),
      { authenticator: authenticated, userReadLimiter: limiter() },
    );

    const response = await app.request("/api/me/organizations");

    expect(response.status).toBe(403);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("paginates reviewable claims after authenticated read limiting", async () => {
    const reviewable = {
      claims: [
        {
          claimId: CLAIM_ID,
          organizationId: ORG_ID,
          organizationName: "Brown Lecture Board",
          claimantDisplayName: "Brown Student",
          claimantHandle: "student",
          evidence: "Elected president",
          createdAt: "2026-07-30T00:01:00.000Z",
        },
      ],
      next: {
        afterCreatedAt: "2026-07-30T00:01:00.000Z",
        afterClaimId: CLAIM_ID,
      },
    };
    const list = vi.fn(async () => ({ kind: "ok" as const, value: reviewable }));
    const readLimiter = limiter();
    const writeLimiter = limiter();
    const app = createApp(queries({ reviewableOrganizationClaims: list }), {
      authenticator: authenticated,
      userReadLimiter: readLimiter,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request(
      `/api/me/org-claims/reviewable?afterCreatedAt=2026-07-29T23%3A59%3A00.000Z&afterClaimId=${OTHER_ID}&limit=25`,
    );
    const text = await response.text();
    const body = OrgClaimReviewQueueSchema.parse(JSON.parse(text));

    expect(response.status).toBe(200);
    expect(body).toEqual(reviewable);
    expect(list).toHaveBeenCalledWith(ACTOR_ID, {
      afterCreatedAt: "2026-07-29T23:59:00.000Z",
      afterClaimId: OTHER_ID,
      limit: 25,
    });
    expect(readLimiter.limit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
    expect(writeLimiter.limit).not.toHaveBeenCalled();
    expect(text).not.toContain("email");
    expect(text).not.toContain("contact");
    expect(text).not.toContain("reviewer");
  });

  it.each([
    ["missing timestamp", `?afterClaimId=${CLAIM_ID}`],
    ["missing claim id", "?afterCreatedAt=2026-07-30T00%3A01%3A00.000Z"],
    ["zero limit", "?limit=0"],
    ["oversized limit", "?limit=101"],
  ])("rejects a %s review cursor before querying", async (_label, suffix) => {
    const list = vi.fn();
    const app = createApp(queries({ reviewableOrganizationClaims: list }), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
    });

    const response = await app.request(`/api/me/org-claims/reviewable${suffix}`);

    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("uses the default first review page when no cursor is supplied", async () => {
    const list = vi.fn(async () => ({
      kind: "ok" as const,
      value: { claims: [], next: null },
    }));
    const app = createApp(queries({ reviewableOrganizationClaims: list }), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
    });

    const response = await app.request("/api/me/org-claims/reviewable");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claims: [], next: null });
    expect(list).toHaveBeenCalledWith(ACTOR_ID, {
      afterCreatedAt: null,
      afterClaimId: null,
      limit: 50,
    });
  });

  it.each([
    ["access GET", "/api/me/organizations", "GET"],
    ["access HEAD", "/api/me/organizations", "HEAD"],
    ["review GET", "/api/me/org-claims/reviewable", "GET"],
    ["review HEAD", "/api/me/org-claims/reviewable", "HEAD"],
  ])("rate-limits %s after auth and before querying", async (_label, path, method) => {
    const access = vi.fn();
    const review = vi.fn();
    const readLimiter = limiter(false);
    const app = createApp(
      queries({
        myOrganizations: access,
        reviewableOrganizationClaims: review,
      }),
      {
        authenticator: authenticated,
        userReadLimiter: readLimiter,
      },
    );

    const response = await app.request(path, { method });

    expect(response.status).toBe(429);
    expect(readLimiter.limit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
    expect(access).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("fails closed before a protected read when the read limiter binding is missing", async () => {
    const access = vi.fn();
    const app = createApp(queries({ myOrganizations: access }), {
      authenticator: authenticated,
    });

    const response = await app.request("/api/me/organizations");

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "rate_limit_unavailable" },
    });
    expect(access).not.toHaveBeenCalled();
  });

  it("decides a claim as the verified actor after write limiting", async () => {
    const decide = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        claimId: CLAIM_ID,
        status: "approved" as const,
        grantedRole: "editor" as const,
        changed: true,
      },
    }));
    const writeLimiter = limiter();
    const app = createApp(queries({ decideOrganizationClaim: decide }), {
      authenticator: authenticated,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request(`/api/org-claims/${CLAIM_ID}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true, note: "  Verified roster  " }),
    });
    const body = OrgClaimDecisionResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toEqual({
      claimId: CLAIM_ID,
      status: "approved",
      grantedRole: "editor",
      changed: true,
    });
    expect(writeLimiter.limit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(decide).toHaveBeenCalledWith(ACTOR_ID, CLAIM_ID, true, "Verified roster");
  });

  it.each([401, 403] as const)(
    "rejects a claim decision with %s before the limiter or query",
    async (status) => {
      const decide = vi.fn();
      const writeLimiter = limiter();
      const app = createApp(queries({ decideOrganizationClaim: decide }), {
        authenticator: blocked(status),
        userWriteLimiter: writeLimiter,
      });

      const response = await app.request(`/api/org-claims/${CLAIM_ID}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: false, note: "Insufficient evidence" }),
      });

      expect(response.status).toBe(status);
      expect(writeLimiter.limit).not.toHaveBeenCalled();
      expect(decide).not.toHaveBeenCalled();
    },
  );

  it.each(["actorId", "claimId", "role", "status"])(
    "rejects forged claim decision field %s before querying",
    async (field) => {
      const decide = vi.fn();
      const app = createApp(queries({ decideOrganizationClaim: decide }), {
        authenticator: authenticated,
        userWriteLimiter: limiter(),
      });

      const response = await app.request(`/api/org-claims/${CLAIM_ID}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true, [field]: "forged" }),
      });

      expect(response.status).toBe(400);
      expect(decide).not.toHaveBeenCalled();
    },
  );

  it("rate-limits a claim decision after auth and before querying", async () => {
    const decide = vi.fn();
    const app = createApp(queries({ decideOrganizationClaim: decide }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(false),
    });

    const response = await app.request(`/api/org-claims/${CLAIM_ID}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ approve: true }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("access-control-expose-headers")).toBe("Retry-After");
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    ["authority", { kind: "forbidden" }, 403, "forbidden"],
    ["missing claim", { kind: "not_found" }, 404, "not_found"],
    ["terminal claim", { kind: "conflict" }, 409, "conflict"],
    ["database outage", { kind: "unavailable" }, 503, "organization_service_unavailable"],
  ] as const)("maps claim decision %s errors safely", async (_label, result, status, code) => {
    const app = createApp(
      queries({
        decideOrganizationClaim: vi.fn(async () => result),
      }),
      { authenticator: authenticated, userWriteLimiter: limiter() },
    );

    const response = await app.request(`/api/org-claims/${CLAIM_ID}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: false }),
    });
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain(ACTOR_ID);
    expect(text).not.toContain("BROWNSYNC_ORG_");
  });

  it.each([
    ["auto_approved", "owner", CLAIM_ID],
    ["pending", null, CLAIM_ID],
    ["already_admin", "editor", null],
    ["already_pending", null, CLAIM_ID],
  ] as const)("serializes the %s claim disposition exactly", async (disposition, role, claimId) => {
    const claim = vi.fn(async () => ({
      kind: "ok" as const,
      value: { organizationId: ORG_ID, disposition, role, claimId },
    }));
    const app = createApp(queries({ claimOrganization: claim }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/orgs/${ORG_ID}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence: "  elected president  " }),
    });
    const body = OrgClaimResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toEqual({ organizationId: ORG_ID, disposition, role, claimId });
    expect(claim).toHaveBeenCalledWith(ACTOR_ID, ORG_ID, "elected president");
    expect(claim).not.toHaveBeenCalledWith(OTHER_ID, expect.anything(), expect.anything());
  });

  it.each([
    ["actor id", { evidence: "proof", actorId: OTHER_ID }],
    ["email", { evidence: "proof", email: "attacker@brown.edu" }],
    ["role", { evidence: "proof", role: "owner" }],
    ["status", { evidence: "proof", status: "approved" }],
    ["unknown", { evidence: "proof", surprise: true }],
  ])("rejects forged claim %s fields before querying", async (_label, body) => {
    const claim = vi.fn();
    const app = createApp(queries({ claimOrganization: claim }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/orgs/${ORG_ID}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(claim).not.toHaveBeenCalled();
  });

  it("serializes changed and idempotent edit results using only the verified actor", async () => {
    const edit = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ok",
        value: { organizationId: ORG_ID, revision: 4, changed: true },
      })
      .mockResolvedValueOnce({
        kind: "ok",
        value: { organizationId: ORG_ID, revision: 4, changed: false },
      });
    const app = createApp(queries({ editOrganization: edit }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });
    const request = {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 3,
        patch: { description: "Updated", aboutMd: null },
      }),
    };

    const changed = await app.request(`/api/orgs/${ORG_ID}`, request);
    const noOp = await app.request(`/api/orgs/${ORG_ID}`, request);

    expect(OrgEditResultSchema.parse(await changed.json())).toEqual({
      organizationId: ORG_ID,
      revision: 4,
      changed: true,
    });
    expect(OrgEditResultSchema.parse(await noOp.json())).toEqual({
      organizationId: ORG_ID,
      revision: 4,
      changed: false,
    });
    expect(edit).toHaveBeenNthCalledWith(1, ACTOR_ID, ORG_ID, 3, {
      description: "Updated",
      aboutMd: null,
    });
  });

  it.each([
    ["missing organization", { kind: "not_found" }, 404, "not_found"],
    ["non-admin", { kind: "forbidden" }, 403, "forbidden"],
    ["terminal claim", { kind: "conflict" }, 409, "conflict"],
  ] as const)("maps %s to a sanitized error", async (_label, result, status, code) => {
    const claim = vi.fn(async () => result);
    const app = createApp(queries({ claimOrganization: claim }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/orgs/${ORG_ID}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence: "proof" }),
    });
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain("BROWNSYNC_ORG_");
    expect(text).not.toContain(ACTOR_ID);
  });

  it("maps a database outage to 503 without exposing its message", async () => {
    const failure = Object.assign(new Error("secret database details"), { code: "ECONNREFUSED" });
    const app = createApp(
      queries({
        editOrganization: vi.fn(async () => {
          throw failure;
        }),
      }),
      {
        authenticator: authenticated,
        userWriteLimiter: limiter(),
      },
    );

    const response = await app.request(`/api/orgs/${ORG_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 0, patch: { description: null } }),
    });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("secret database details");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "db_unavailable" } });
  });
});

describe("public organization enrichment", () => {
  it("keeps the legacy detail operation on OrgDetail without enrichment fields", async () => {
    const app = createApp(
      queries({
        orgById: async () => ({
          ...orgRow,
          advisor: "Must stay off the legacy operation",
          revision: 2,
        }),
        eventsByOrg: async () => ({ upcoming: [eventRow], past: [] }),
      } as unknown as OrganizationQueryOverrides),
    );

    const response = await app.request(`/api/orgs/${ORG_ID}`);
    const text = await response.text();
    const body = OrgDetailOutSchema.parse(JSON.parse(text));

    expect(response.status).toBe(200);
    expect(body.upcoming).toHaveLength(1);
    expect(text).not.toContain("advisor");
    expect(text).not.toContain("revision");
  });

  it("returns safe merged profile enrichment and never promotes contact or raw logo data", async () => {
    let capturedPivot: Date | undefined;
    const enrichedRow = {
      ...orgRow,
      description: "Club-authored description",
      advisor: "Faculty Advisor",
      funding_category: "UFB",
      about_md: "Long-form profile",
      meeting_info: "Fridays at 4",
      links: [{ platform: "website", url: "https://example.edu" }],
      avatar_url: null,
      logo_url: "https://untrusted.example/raw-logo.svg",
      banner_url: null,
      overridden_fields: ["description", "links"],
      revision: 2,
      updated_at: new Date("2026-07-30T00:02:00Z"),
      contact_emails: ["sentinel-contact@brown.edu"],
    };
    const app = createApp(
      queries({
        orgById: async () => enrichedRow,
        eventsByOrg: async (_id: string, pivot: Date) => {
          capturedPivot = pivot;
          return { upcoming: [eventRow], past: [] };
        },
      } as unknown as OrganizationQueryOverrides),
    );

    const response = await app.request(
      `/api/orgs/${ORG_ID}/profile?at=2026-09-20T12%3A30%3A00-04%3A00`,
    );
    const text = await response.text();
    const body = OrgEnrichedDetailSchema.parse(JSON.parse(text));

    expect(response.status).toBe(200);
    expect(body.description).toBe("Club-authored description");
    expect(body.avatarUrl).toBeNull();
    expect(capturedPivot?.toISOString()).toBe("2026-09-20T16:30:00.000Z");
    expect(body.revision).toBe(2);
    expect(body.overriddenFields).toEqual(["description", "links"]);
    expect(text).not.toContain("contactEmails");
    expect(text).not.toContain("contact_emails");
    expect(text).not.toContain("sentinel-contact@brown.edu");
    expect(text).not.toContain("untrusted.example");
  });
});

describe("organization OpenAPI", () => {
  it("uses named responses and bearer security for every protected operation", () => {
    const document = buildOpenApiDocument(createApp(fakeQueries())) as unknown as {
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown;
            responses?: Record<
              string,
              { content?: { "application/json"?: { schema?: { $ref?: string } } } }
            >;
          }
        >
      >;
    };

    for (const [path, method, status, component] of [
      ["/api/orgs", "post", "201", "OrgCreateResult"],
      ["/api/me/organizations", "get", "200", "MyOrganizations"],
      ["/api/orgs/{id}/claims", "post", "200", "OrgClaimResult"],
      ["/api/orgs/{id}", "patch", "200", "OrgEditResult"],
      ["/api/me/org-claims/reviewable", "get", "200", "OrgClaimReviewQueue"],
      ["/api/org-claims/{claimId}/decision", "post", "200", "OrgClaimDecisionResult"],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation?.security).toEqual([{ bearerAuth: [] }]);
      expect(operation?.responses?.[status]?.content?.["application/json"]?.schema?.$ref).toBe(
        `#/components/schemas/${component}`,
      );
      for (const response of Object.values(operation?.responses ?? {})) {
        const responseSchema = response.content?.["application/json"]?.schema;
        if (responseSchema !== undefined)
          expect(responseSchema.$ref).toMatch(/^#\/components\/schemas\//);
      }
    }

    expect(
      document.paths["/api/orgs/{id}"]?.get?.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref,
    ).toBe("#/components/schemas/OrgDetail");
    expect(
      document.paths["/api/orgs/{id}/profile"]?.get?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema?.$ref,
    ).toBe("#/components/schemas/OrgEnrichedDetail");
    expect(
      (document.paths["/api/orgs/{id}/profile"]?.get as { operationId?: string } | undefined)
        ?.operationId,
    ).toBe("getOrganizationProfile");
  });
});
