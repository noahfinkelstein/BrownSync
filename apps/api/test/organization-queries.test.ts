import { describe, expect, it, vi } from "vitest";
import type { Sql } from "../src/db";
import { createQueries } from "../src/queries";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";

function queryText(call: unknown[] | undefined): string {
  const strings = call?.[0] as TemplateStringsArray | undefined;
  return strings === undefined ? "" : strings.join("?").replaceAll(/\s+/g, " ").trim();
}

describe("organization query adapter", () => {
  it("passes an explicitly cleared create links field to PostgreSQL as SQL NULL", async () => {
    const sql = vi.fn(async () => [
      {
        organization_id: "user-safe-org-12345678",
        revision: 0,
        admin_role: "owner",
        disposition: "created",
      },
    ]);
    const json = vi.fn((value: unknown) => ({ encoded: value }));
    Object.assign(sql, { json });

    const result = await createQueries(sql as unknown as Sql).createOrganization?.(ACTOR_ID, {
      name: "Safe Org",
      links: null,
    });

    expect(result).toMatchObject({ kind: "ok" });
    expect(json).not.toHaveBeenCalled();
    expect(sql.mock.calls[0]?.slice(1)).toContain(null);
    expect(queryText(sql.mock.calls[0])).toContain("brownsync_create_organization(");
    expect(sql.mock.calls[0]?.slice(1)).toHaveLength(6);
    expect(result).toEqual({
      kind: "ok",
      value: {
        organizationId: "user-safe-org-12345678",
        revision: 0,
        role: "owner",
        disposition: "created",
      },
    });
  });

  it("returns an identical create retry as a successful replay", async () => {
    const sql = vi.fn(async () => [
      {
        organization_id: "user-safe-org-12345678",
        revision: 1,
        admin_role: "owner",
        disposition: "already_exists",
      },
    ]);
    Object.assign(sql, { json: vi.fn() });

    const result = await createQueries(sql as unknown as Sql).createOrganization?.(ACTOR_ID, {
      name: "Safe Org",
      description: "Same payload",
    });

    expect(result).toEqual({
      kind: "ok",
      value: {
        organizationId: "user-safe-org-12345678",
        revision: 1,
        role: "owner",
        disposition: "replayed",
      },
    });
  });

  it("keeps a changed-payload create retry as a conflict", async () => {
    const sql = vi.fn(async () => {
      throw new Error("BROWNSYNC_ORG_CREATE_CONFLICT");
    });
    Object.assign(sql, { json: vi.fn() });

    const result = await createQueries(sql as unknown as Sql).createOrganization?.(ACTOR_ID, {
      name: "Safe Org",
      description: "Changed payload",
    });

    expect(result).toEqual({ kind: "conflict" });
  });

  it("maps claimant-only review notes without evidence or reviewer identity", async () => {
    const sql = vi.fn(async () => [
      {
        organization_id: "brown-lecture-board",
        organization_name: "Brown Lecture Board",
        admin_role: null,
        membership_granted_at: null,
        claim_id: "20000000-0000-4000-8000-000000000001",
        claim_status: "rejected",
        claim_created_at: new Date("2026-07-30T00:01:00Z"),
        claim_reviewed_at: new Date("2026-07-30T01:01:00Z"),
        claim_review_note: "Please use your official roster.",
        evidence: "must never be mapped",
        reviewed_by: "must never be mapped",
      },
    ]);
    Object.assign(sql, { json: vi.fn() });

    const result = await createQueries(sql as unknown as Sql).myOrganizations?.(ACTOR_ID);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      kind: "ok",
      value: {
        claims: [
          {
            reviewNote: "Please use your official roster.",
          },
        ],
      },
    });
    expect(serialized).not.toContain("must never be mapped");
    expect(serialized).not.toContain("reviewed_by");
    expect(queryText(sql.mock.calls[0])).toContain("brownsync_list_org_access(?::uuid)");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID]);
  });

  it("maps the authority-scoped review queue and atomic decision routine", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          claim_id: "20000000-0000-4000-8000-000000000001",
          organization_id: "brown-lecture-board",
          organization_name: "Brown Lecture Board",
          claimant_display_name: "Brown Student",
          claimant_handle: "student",
          evidence: "Elected president",
          created_at: new Date("2026-07-30T00:01:00Z"),
          has_more: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          claim_status: "approved",
          granted_role: "editor",
          changed: true,
        },
      ]);
    Object.assign(sql, { json: vi.fn() });
    const queries = createQueries(sql as unknown as Sql);

    const queue = await queries.reviewableOrganizationClaims?.(ACTOR_ID, {
      afterCreatedAt: "2026-07-29T23:59:00.000Z",
      afterClaimId: "20000000-0000-4000-8000-000000000000",
      limit: 25,
    });
    const decision = await queries.decideOrganizationClaim?.(
      ACTOR_ID,
      "20000000-0000-4000-8000-000000000001",
      true,
      "Verified roster",
    );

    expect(queue).toEqual({
      kind: "ok",
      value: {
        claims: [
          {
            claimId: "20000000-0000-4000-8000-000000000001",
            organizationId: "brown-lecture-board",
            organizationName: "Brown Lecture Board",
            claimantDisplayName: "Brown Student",
            claimantHandle: "student",
            evidence: "Elected president",
            createdAt: "2026-07-30T00:01:00.000Z",
          },
        ],
        next: {
          afterCreatedAt: "2026-07-30T00:01:00.000Z",
          afterClaimId: "20000000-0000-4000-8000-000000000001",
        },
      },
    });
    expect(decision).toEqual({
      kind: "ok",
      value: {
        claimId: "20000000-0000-4000-8000-000000000001",
        status: "approved",
        grantedRole: "editor",
        changed: true,
      },
    });
    expect(sql.mock.calls[0]?.slice(1)).toContain(ACTOR_ID);
    expect(queryText(sql.mock.calls[0])).toContain(
      "brownsync_list_reviewable_org_claims( ?::uuid, ?::timestamptz, ?::uuid, ?::integer )",
    );
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      ACTOR_ID,
      "2026-07-29T23:59:00.000Z",
      "20000000-0000-4000-8000-000000000000",
      25,
    ]);
    expect(queryText(sql.mock.calls[1])).toContain("brownsync_review_org_claim(");
    expect(sql.mock.calls[1]?.slice(1)).toHaveLength(4);
    expect(sql.mock.calls[1]?.slice(1)).toEqual(
      expect.arrayContaining([
        ACTOR_ID,
        "20000000-0000-4000-8000-000000000001",
        true,
        "Verified roster",
      ]),
    );
  });

  it("returns a null review cursor on the final page and maps invalid cursors to bad request", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          claim_id: "20000000-0000-4000-8000-000000000001",
          organization_id: "brown-lecture-board",
          organization_name: "Brown Lecture Board",
          claimant_display_name: "Brown Student",
          claimant_handle: "student",
          evidence: null,
          created_at: new Date("2026-07-30T00:01:00Z"),
          has_more: false,
        },
      ])
      .mockRejectedValueOnce(new Error("BROWNSYNC_ORG_QUEUE_INVALID"));
    Object.assign(sql, { json: vi.fn() });
    const queries = createQueries(sql as unknown as Sql);

    const finalPage = await queries.reviewableOrganizationClaims?.(ACTOR_ID, {
      afterCreatedAt: null,
      afterClaimId: null,
      limit: 50,
    });
    const invalid = await queries.reviewableOrganizationClaims?.(ACTOR_ID, {
      afterCreatedAt: "2026-07-30T00:01:00.000Z",
      afterClaimId: "20000000-0000-4000-8000-000000000001",
      limit: 50,
    });

    expect(finalPage).toMatchObject({ kind: "ok", value: { next: null } });
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, null, null, 50]);
    expect(invalid).toEqual({ kind: "bad_request" });
  });

  it("calls the final claim and edit routine signatures with trusted actor arguments", async () => {
    const encodedPatch = { encoded: { description: "Updated" } };
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          claim_id: "20000000-0000-4000-8000-000000000001",
          claim_status: "pending",
          admin_role: null,
          disposition: "pending",
        },
      ])
      .mockResolvedValueOnce([{ revision: 4, changed: true }]);
    Object.assign(sql, { json: vi.fn(() => encodedPatch) });
    const queries = createQueries(sql as unknown as Sql);

    await queries.claimOrganization?.(ACTOR_ID, "brown-lecture-board", "Elected president");
    await queries.editOrganization?.(ACTOR_ID, "brown-lecture-board", 3, {
      description: "Updated",
    });

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_claim_organization(");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      ACTOR_ID,
      "brown-lecture-board",
      "Elected president",
    ]);
    expect(queryText(sql.mock.calls[1])).toContain("brownsync_edit_organization(");
    expect(sql.mock.calls[1]?.slice(1)).toEqual([ACTOR_ID, "brown-lecture-board", 3, encodedPatch]);
  });
});
