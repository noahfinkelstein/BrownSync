import type { AccountDeleter } from "./auth";
import { type BoardIdentity, isBoardActorIdentity } from "./board-identity";

export type BoardAccountCleanupResult = "cleaned" | "unavailable";
export type BoardAccountCleaner = (
  actorId: string,
  authorToken: string,
) => Promise<BoardAccountCleanupResult>;

export type BoardAwareAccountDeleterOptions =
  | Readonly<{
      adminDeleter: AccountDeleter;
      launchState: "not_launched";
    }>
  | Readonly<{
      adminDeleter: AccountDeleter;
      cleanup: BoardAccountCleaner;
      identity: BoardIdentity;
      launchState: "launched";
    }>;

export function createBoardAwareAccountDeleter(
  options: BoardAwareAccountDeleterOptions,
): AccountDeleter {
  if (options.launchState === "not_launched") {
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
      if (cleanup !== "cleaned") return "unavailable";
      return await options.adminDeleter(user);
    } catch {
      return "unavailable";
    }
  };
}
