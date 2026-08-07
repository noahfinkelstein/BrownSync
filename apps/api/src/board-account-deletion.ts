import type { AccountDeleter } from "./auth";
import { type BoardIdentity, isBoardActorIdentity } from "./board-identity";

export type BoardAccountCleanupResult = "cleaned" | "owner_transfer_required" | "unavailable";
export type BoardAccountCleaner = (
  actorId: string,
  authorToken: string,
) => Promise<BoardAccountCleanupResult>;

/**
 * Deletion semantics deliberately key on whether the board author pepper is
 * CONFIGURED — never on the BOARD_ENABLED runtime launch flag. Board content
 * can only ever exist once the pepper secret is provisioned, and the flag can
 * be (mis)flipped back off after launch; cleanup must survive that.
 */
export type BoardAwareAccountDeleterOptions =
  | Readonly<{
      adminDeleter: AccountDeleter;
      cleanupState: "unconfigured";
    }>
  | Readonly<{
      adminDeleter: AccountDeleter;
      cleanup: BoardAccountCleaner;
      identity: BoardIdentity;
      cleanupState: "configured";
    }>;

export function createBoardAwareAccountDeleter(
  options: BoardAwareAccountDeleterOptions,
): AccountDeleter {
  if (options.cleanupState === "unconfigured") {
    return async (user) => {
      try {
        return await options.adminDeleter(user);
      } catch {
        return "unavailable";
      }
    };
  }

  return async (user) => {
    try {
      const result = await options.identity.derive(user.id);
      if (
        result.kind !== "ok" ||
        !isBoardActorIdentity(result.value) ||
        result.value.actorId !== user.id.toLowerCase()
      ) {
        return "unavailable";
      }

      const cleanup = await options.cleanup(result.value.actorId, result.value.authorToken);
      if (cleanup === "owner_transfer_required") return "owner_transfer_required";
      if (cleanup !== "cleaned") return "unavailable";
      return await options.adminDeleter(user);
    } catch {
      return "unavailable";
    }
  };
}
