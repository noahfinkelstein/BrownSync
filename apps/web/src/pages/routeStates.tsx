import { cn, EmptyState, FOCUS_RING } from "@brownsync/ui";
import { Link, useLocation } from "@tanstack/react-router";
import { ListSkeleton, PanelSkeleton } from "../ops/states";
import { PageShell } from "./PageShell";

/**
 * Router-level async + not-found states (§6.4): every navigation paints a
 * DESIGNED state. The profile pages are lazy route chunks (Phase 3 P3B), so
 * without these the chunk fetch rendered literally nothing — these are the
 * content-shaped skeletons (ops states library, never spinners) that hold
 * the frame instead.
 *
 * Flash control: Suspense fallbacks ignore `defaultPendingMs`, so the
 * `bs-route-pending` class (styles.css) holds the skeleton invisible for the
 * first ~150 ms — a warm-cache chunk load swaps the real page in before
 * anything paints. Loader-driven pendings additionally respect the router's
 * `defaultPendingMs`/`defaultPendingMinMs` (router.tsx).
 */

/** /p/:id + /o/:id pending: PageShell chrome + §6.4 profile-shaped skeletons. */
export function ProfilePagePending() {
  return (
    <PageShell>
      <div className="bs-route-pending mt-4" data-testid="route-pending">
        <PanelSkeleton />
        <ListSkeleton className="mt-6" />
      </div>
    </PageShell>
  );
}

/** Router backstop for any future route without its own pending design. */
export function RoutePendingFallback() {
  return (
    <div
      aria-busy="true"
      data-testid="route-pending"
      className="bs-route-pending mx-auto w-full max-w-2xl px-4 pt-6"
    >
      <PanelSkeleton />
      <ListSkeleton className="mt-6" />
    </div>
  );
}

/**
 * Designed not-found (§6.4: real copy + the action that fixes it) — unrouted
 * URLs previously fell through to the router's unstyled default paragraph.
 */
export function NotFoundScreen() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center bg-bg-base px-4 text-text-primary">
      <EmptyState
        title="Nothing lives at this address"
        body={
          <>
            <span className="font-mono text-12">{pathname}</span> doesn’t match the map, a place, or
            an org — the link may be stale or mistyped. Everything on campus starts at the map.
          </>
        }
        action={
          <Link
            to="/"
            className={cn(
              "inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-4 border border-line bg-transparent px-2.5 text-13 font-medium text-text-primary transition-colors duration-150 ease-out hover:bg-bg-overlay",
              FOCUS_RING,
            )}
          >
            ← back to the map
          </Link>
        }
      />
    </div>
  );
}
