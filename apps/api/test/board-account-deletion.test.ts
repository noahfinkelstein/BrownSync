import { describe, expect, it, vi } from "vitest";
import type { AccountDeleter, AuthUser } from "../src/auth";
import {
  type BoardAccountCleaner,
  createBoardAwareAccountDeleter,
} from "../src/board-account-deletion";
import type { BoardIdentity } from "../src/board-identity";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const AUTHOR_TOKEN = "55caa01066713671b919ea7c26db87b31d14e6fb35c24f1160d05434d072950f";
const USER: AuthUser = { id: ACTOR_ID, email: "member@brown.edu" };

function availableIdentity(events: string[] = []): BoardIdentity {
  return {
    derive: vi.fn(async (actorId: string) => {
      events.push("identity");
      return {
        kind: "ok" as const,
        value: {
          actorId,
          alias: "Anonymous Otter 55CA",
          authorToken: AUTHOR_TOKEN,
          tokenVersion: 1 as const,
        },
      };
    }),
  };
}

describe("board-aware account deletion", () => {
  it("preserves the legacy Admin deletion path while the board pepper is unconfigured", async () => {
    const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "unconfigured",
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("deleted");
    expect(adminDeleter).toHaveBeenCalledOnce();
    expect(adminDeleter).toHaveBeenCalledWith(USER);
  });

  it("derives identity, completes board cleanup, then invokes Admin deletion", async () => {
    const events: string[] = [];
    const identity = availableIdentity(events);
    const cleanup = vi.fn<BoardAccountCleaner>(async (actorId, authorToken) => {
      events.push("cleanup");
      expect(actorId).toBe(ACTOR_ID);
      expect(authorToken).toBe(AUTHOR_TOKEN);
      return "cleaned";
    });
    const adminDeleter = vi.fn<AccountDeleter>(async () => {
      events.push("admin");
      return "deleted";
    });
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity,
      cleanup,
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("deleted");
    expect(events).toEqual(["identity", "cleanup", "admin"]);
  });

  it.each(["unavailable", "throw"] as const)(
    "fails closed before cleanup and Admin deletion when identity is %s",
    async (failure) => {
      const identity: BoardIdentity = {
        derive: vi.fn(async () => {
          if (failure === "throw") throw new Error(`identity:${AUTHOR_TOKEN}`);
          return { kind: "unavailable" as const };
        }),
      };
      const cleanup = vi.fn<BoardAccountCleaner>(async () => "cleaned");
      const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
      const deleter = createBoardAwareAccountDeleter({
        cleanupState: "configured",
        identity,
        cleanup,
        adminDeleter,
      });

      await expect(deleter(USER)).resolves.toBe("unavailable");
      expect(cleanup).not.toHaveBeenCalled();
      expect(adminDeleter).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed injected identity before it reaches cleanup", async () => {
    const identity = {
      derive: vi.fn(async () => ({
        kind: "ok",
        value: {
          actorId: ACTOR_ID,
          alias: "Anonymous Otter 55CA",
          authorToken: AUTHOR_TOKEN.toUpperCase(),
          tokenVersion: 1,
        },
      })),
    } as unknown as BoardIdentity;
    const cleanup = vi.fn<BoardAccountCleaner>(async () => "cleaned");
    const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity,
      cleanup,
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("unavailable");
    expect(cleanup).not.toHaveBeenCalled();
    expect(adminDeleter).not.toHaveBeenCalled();
  });

  it("rejects an injected identity for a different actor before cleanup or Admin deletion", async () => {
    const identity = {
      derive: vi.fn(async () => ({
        kind: "ok",
        value: {
          actorId: "20000000-0000-4000-8000-000000000002",
          alias: "Anonymous Otter 55CA",
          authorToken: AUTHOR_TOKEN,
          tokenVersion: 1,
        },
      })),
    } as unknown as BoardIdentity;
    const cleanup = vi.fn<BoardAccountCleaner>(async () => "cleaned");
    const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity,
      cleanup,
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("unavailable");
    expect(cleanup).not.toHaveBeenCalled();
    expect(adminDeleter).not.toHaveBeenCalled();
  });

  it("surfaces a sole-owner cleanup conflict without touching Admin deletion", async () => {
    const cleanup = vi.fn<BoardAccountCleaner>(async () => "owner_transfer_required");
    const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity: availableIdentity(),
      cleanup,
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("owner_transfer_required");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(adminDeleter).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "throw"] as const)(
    "fails closed before Admin deletion when board cleanup is %s",
    async (failure) => {
      const cleanup = vi.fn<BoardAccountCleaner>(async () => {
        if (failure === "throw") throw new Error(`cleanup:${AUTHOR_TOKEN}`);
        return "unavailable";
      });
      const adminDeleter = vi.fn<AccountDeleter>(async () => "deleted");
      const deleter = createBoardAwareAccountDeleter({
        cleanupState: "configured",
        identity: availableIdentity(),
        cleanup,
        adminDeleter,
      });

      await expect(deleter(USER)).resolves.toBe("unavailable");
      expect(cleanup).toHaveBeenCalledOnce();
      expect(adminDeleter).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "throw"] as const)(
    "maps an Admin %s after successful cleanup to unavailable",
    async (failure) => {
      const cleanup = vi.fn<BoardAccountCleaner>(async () => "cleaned");
      const adminDeleter = vi.fn<AccountDeleter>(async () => {
        if (failure === "throw") throw new Error(`admin:${AUTHOR_TOKEN}`);
        return "unavailable";
      });
      const deleter = createBoardAwareAccountDeleter({
        cleanupState: "configured",
        identity: availableIdentity(),
        cleanup,
        adminDeleter,
      });

      await expect(deleter(USER)).resolves.toBe("unavailable");
      expect(cleanup).toHaveBeenCalledOnce();
      expect(adminDeleter).toHaveBeenCalledOnce();
    },
  );

  it("repeats idempotent cleanup before a safe retry of Admin deletion", async () => {
    const events: string[] = [];
    const cleanup = vi.fn<BoardAccountCleaner>(async () => {
      events.push("cleanup");
      return "cleaned";
    });
    const adminDeleter = vi
      .fn<AccountDeleter>()
      .mockImplementationOnce(async () => {
        events.push("admin-unavailable");
        return "unavailable";
      })
      .mockImplementationOnce(async () => {
        events.push("admin-deleted");
        return "deleted";
      });
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity: availableIdentity(events),
      cleanup,
      adminDeleter,
    });

    await expect(deleter(USER)).resolves.toBe("unavailable");
    await expect(deleter(USER)).resolves.toBe("deleted");
    expect(events).toEqual([
      "identity",
      "cleanup",
      "admin-unavailable",
      "identity",
      "cleanup",
      "admin-deleted",
    ]);
  });

  it("never logs identity, cleanup, or Admin failures containing private material", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cleanup = vi.fn<BoardAccountCleaner>(async () => {
      throw new Error(`${ACTOR_ID}:${AUTHOR_TOKEN}`);
    });
    const deleter = createBoardAwareAccountDeleter({
      cleanupState: "configured",
      identity: availableIdentity(),
      cleanup,
      adminDeleter: vi.fn<AccountDeleter>(async () => "deleted"),
    });

    await expect(deleter(USER)).resolves.toBe("unavailable");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
