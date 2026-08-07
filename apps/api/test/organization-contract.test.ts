import * as Contract from "@brownsync/contract";
import { describe, expect, it } from "vitest";

type RuntimeSchema = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
};

function schema(name: string): RuntimeSchema {
  const candidate = (Contract as unknown as Record<string, unknown>)[name];
  expect(candidate, `missing contract export ${name}`).toBeDefined();
  return candidate as RuntimeSchema;
}

describe("organization contract schemas", () => {
  it("exports every named organization schema", () => {
    for (const name of [
      "OrgLinkSchema",
      "OrgEnrichedDetailSchema",
      "OrgMembershipSchema",
      "OrgClaimSummarySchema",
      "MyOrganizationsSchema",
      "OrgCreateRequestSchema",
      "OrgCreateResultSchema",
      "OrgClaimRequestSchema",
      "OrgClaimResultSchema",
      "OrgReviewableClaimSchema",
      "OrgClaimReviewCursorSchema",
      "OrgClaimReviewQueueQuerySchema",
      "OrgClaimReviewQueueSchema",
      "OrgClaimDecisionRequestSchema",
      "OrgClaimDecisionResultSchema",
      "OrgEditPatchSchema",
      "OrgEditRequestSchema",
      "OrgEditResultSchema",
    ]) {
      expect((Contract as unknown as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("accepts only strict, bounded HTTPS organization links", () => {
    const orgLink = schema("OrgLinkSchema");
    const valid = {
      platform: "discord",
      url: "https://discord.gg/brownsync",
      label: "Join us",
    };

    expect(orgLink.parse(valid)).toEqual(valid);
    expect(orgLink.safeParse({ ...valid, actorId: crypto.randomUUID() }).success).toBe(false);
    expect(orgLink.safeParse({ ...valid, platform: "mastodon" }).success).toBe(false);
    expect(orgLink.safeParse({ ...valid, url: "http://discord.gg/brownsync" }).success).toBe(false);
    expect(orgLink.safeParse({ ...valid, url: "javascript:alert(1)" }).success).toBe(false);
    expect(
      orgLink.safeParse({ ...valid, url: `https://example.com/${"a".repeat(2030)}` }).success,
    ).toBe(false);
    expect(orgLink.safeParse({ ...valid, label: "a".repeat(81) }).success).toBe(false);
  });

  it("rejects unknown or privileged claim inputs and trims evidence", () => {
    const claim = schema("OrgClaimRequestSchema");

    expect(claim.parse({ evidence: "  elected president  " })).toEqual({
      evidence: "elected president",
    });
    expect(claim.safeParse({ evidence: "" }).success).toBe(false);
    expect(claim.safeParse({ evidence: "a".repeat(2001) }).success).toBe(false);
    for (const forbidden of ["actorId", "email", "role", "status", "audit"]) {
      expect(claim.safeParse({ evidence: "proof", [forbidden]: "forged" }).success).toBe(false);
    }
  });

  it("keeps the review queue safe and accepts only a strict decision", () => {
    const queue = schema("OrgClaimReviewQueueSchema");
    const decision = schema("OrgClaimDecisionRequestSchema");
    const body = {
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
    };

    expect(queue.parse(body)).toEqual(body);
    for (const forbidden of ["claimantEmail", "contactEmails", "reviewerId"]) {
      expect(
        queue.safeParse({
          claims: [{ ...body.claims[0], [forbidden]: "private" }],
        }).success,
      ).toBe(false);
    }
    expect(decision.parse({ approve: true, note: "  Verified roster  " })).toEqual({
      approve: true,
      note: "Verified roster",
    });
    expect(decision.safeParse({ approve: true, note: "" }).success).toBe(false);
    expect(decision.safeParse({ approve: true, note: "a".repeat(2_001) }).success).toBe(false);
    for (const forbidden of ["actorId", "claimId", "role", "status"]) {
      expect(decision.safeParse({ approve: true, [forbidden]: "forged" }).success).toBe(false);
    }
  });

  it("requires a paired review cursor and defaults a bounded page size", () => {
    const query = schema("OrgClaimReviewQueueQuerySchema");
    const cursor = {
      afterCreatedAt: "2026-07-30T00:01:00.000Z",
      afterClaimId: "20000000-0000-4000-8000-000000000001",
    };

    expect(query.parse({})).toEqual({ limit: 50 });
    expect(query.parse({ ...cursor, limit: "100" })).toEqual({ ...cursor, limit: 100 });
    expect(query.safeParse({ afterCreatedAt: cursor.afterCreatedAt }).success).toBe(false);
    expect(query.safeParse({ afterClaimId: cursor.afterClaimId }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "0" }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "101" }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "1.5" }).success).toBe(false);
  });

  it("exposes only the claimant's nullable review note in own claim summaries", () => {
    const summary = schema("OrgClaimSummarySchema");
    const body = {
      id: "20000000-0000-4000-8000-000000000001",
      organizationId: "brown-lecture-board",
      organizationName: "Brown Lecture Board",
      status: "rejected",
      createdAt: "2026-07-30T00:01:00.000Z",
      reviewedAt: "2026-07-30T01:01:00.000Z",
      reviewNote: "Please use your official roster.",
    };

    expect(summary.parse(body)).toEqual(body);
    expect(summary.safeParse({ ...body, evidence: "private evidence" }).success).toBe(false);
    expect(summary.safeParse({ ...body, reviewerId: crypto.randomUUID() }).success).toBe(false);
  });

  it("accepts only safe user-authored organization creation fields", () => {
    const create = schema("OrgCreateRequestSchema");
    const valid = {
      name: "  BrownSync Builders  ",
      description: "Builds useful campus software.",
      aboutMd: null,
      meetingInfo: "Wednesdays at 6",
      links: [{ platform: "website", url: "https://example.edu/builders" }],
    };

    expect(create.parse(valid)).toEqual({ ...valid, name: "BrownSync Builders" });
    expect(create.safeParse({ name: "" }).success).toBe(false);
    expect(create.safeParse({ name: "a".repeat(161) }).success).toBe(false);
    expect(create.safeParse({ name: "Safe Org", description: "a".repeat(10_001) }).success).toBe(
      false,
    );
    expect(create.safeParse({ name: "Safe Org", aboutMd: "a".repeat(20_001) }).success).toBe(false);
    expect(create.safeParse({ name: "Safe Org", meetingInfo: "a".repeat(4_001) }).success).toBe(
      false,
    );
    for (const forbidden of [
      "id",
      "actorId",
      "source",
      "contactEmails",
      "adminRole",
      "avatarUrl",
      "bannerUrl",
      "revision",
    ]) {
      expect(create.safeParse({ name: "Safe Org", [forbidden]: "forged" }).success).toBe(false);
    }
  });

  it("names fresh and idempotently replayed organization creation results", () => {
    const result = schema("OrgCreateResultSchema");
    const base = {
      organizationId: "user-safe-org-12345678",
      revision: 0,
      role: "owner",
    };

    expect(result.parse({ ...base, disposition: "created" })).toEqual({
      ...base,
      disposition: "created",
    });
    expect(result.parse({ ...base, disposition: "replayed" })).toEqual({
      ...base,
      disposition: "replayed",
    });
    expect(result.safeParse({ ...base, disposition: "already_exists" }).success).toBe(false);
  });

  it("requires a non-empty strict edit patch and never accepts media URLs or metadata", () => {
    const edit = schema("OrgEditRequestSchema");
    const valid = {
      expectedRevision: 0,
      patch: {
        description: "A student organization.",
        aboutMd: null,
        meetingInfo: "Fridays at 4",
        links: [{ platform: "website", url: "https://example.edu" }],
      },
    };

    expect(edit.parse(valid)).toEqual(valid);
    expect(edit.safeParse({ expectedRevision: 0, patch: {} }).success).toBe(false);
    expect(edit.safeParse({ expectedRevision: -1, patch: { description: null } }).success).toBe(
      false,
    );
    expect(
      edit.safeParse({
        expectedRevision: 0,
        patch: { description: "a".repeat(10_001) },
      }).success,
    ).toBe(false);
    expect(
      edit.safeParse({
        expectedRevision: 0,
        patch: { aboutMd: "a".repeat(20_001) },
      }).success,
    ).toBe(false);
    expect(
      edit.safeParse({
        expectedRevision: 0,
        patch: { meetingInfo: "a".repeat(4_001) },
      }).success,
    ).toBe(false);
    for (const forbidden of [
      "actorId",
      "email",
      "role",
      "status",
      "avatarUrl",
      "bannerUrl",
      "revision",
      "updatedBy",
    ]) {
      expect(
        edit.safeParse({
          expectedRevision: 0,
          patch: { description: null, [forbidden]: "forged" },
        }).success,
      ).toBe(false);
    }
  });

  it("keeps enriched organization output contact-free and preserves legacy detail fields", () => {
    const enriched = schema("OrgEnrichedDetailSchema");
    const body = {
      id: "brown-lecture-board",
      name: "Brown Lecture Board",
      kind: "club",
      category: "academic",
      description: "Brings speakers to campus.",
      url: "https://brownlectureboard.org",
      instagram: "brownlectureboard",
      defaultPlaceId: "salomon-center",
      upcoming: [],
      past: [],
      advisor: null,
      fundingCategory: "UFB",
      aboutMd: null,
      meetingInfo: null,
      links: [],
      avatarUrl: null,
      bannerUrl: null,
      overriddenFields: [],
      revision: 0,
      updatedAt: null,
    };

    expect(enriched.parse(body)).toEqual(body);
    expect(
      enriched.safeParse({
        ...body,
        contactEmails: ["sentinel-contact@brown.edu"],
      }).success,
    ).toBe(false);
  });
});
