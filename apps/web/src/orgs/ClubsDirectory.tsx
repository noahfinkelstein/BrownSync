import { CATEGORY_BY_ID, EventOutSchema, type OrgOut } from "@brownsync/contract";
import {
  Badge,
  Button,
  CategoryIcon,
  Chip,
  cn,
  EmptyState,
  FOCUS_RING,
  SearchInput,
  Skeleton,
} from "@brownsync/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useCategoryFilter } from "../browse/filter";
import { useOrgs } from "../data/orgs";
import { getJson, retryUnlessNotFound } from "../data/search";
import {
  categoryFacets,
  filterOrgs,
  type OrgEventCounts,
  type OrgLink,
  type OrgLinkPlatform,
  orgLinks,
  useDirectoryQuery,
} from "./orgLinks";

/**
 * The clubs directory — a browsable surface for all 457 organizations, so
 * finding a club does not require knowing where on the map it meets.
 *
 * Route wiring lives with the integrator; this exports a component and takes
 * no route params. State that a person would want to share (`?q=`, `?cats=`,
 * `?events=`) lives in the URL through the same functional-update idiom as
 * `browse/filter.ts`, and `?cats=` is literally the same param the map layers
 * read — the directory and the map cannot disagree about what is filtered.
 *
 * Two data realities shape the design and are not worked around:
 *
 * 1. Every seeded org has `category: null` — the ingest refuses to guess a
 *    category from a club's name. So the category chips are DATA-DRIVEN: they
 *    render only for categories that exist (plus anything `?cats=` already
 *    holds, so an inherited selection stays clearable). Ten dead chips would
 *    be ten filters that each return nothing.
 * 2. Upcoming-event counts come from `/api/events`, which truncates at 500
 *    rows. Past that, an org's absence stops meaning "nothing on", so counts
 *    and the "has upcoming events" filter disappear rather than lie.
 */

const HOUR = 3_600_000;
const UPCOMING_DAYS = 7;
/** db/migrations/0002_api.sql: `api_events` ends in `limit 500`. */
const EVENTS_CAP = 500;
/** Cards revealed before "show more". 457 cards at once is a scroll, not a
 *  directory; the count strip always reports the true total. */
const PAGE_SIZE = 48;

const EventsEnvelope = z.object({ events: z.array(EventOutSchema) });

/**
 * Upcoming events per org id, or `null` when the answer is not trustworthy.
 *
 * Bucketed to the hour so the cache key does not rotate on every render, and
 * to a 7-day window (the contract's own default) to stay well clear of the
 * 500-row cap. Canceled events are not "upcoming" — a club whose only event
 * is called off should not be advertised as active.
 */
function useUpcomingCounts(now: () => Date): { counts: OrgEventCounts; isPending: boolean } {
  const from = new Date(Math.floor(now().getTime() / HOUR) * HOUR).toISOString();
  const to = new Date(Date.parse(from) + UPCOMING_DAYS * 24 * HOUR).toISOString();
  const query = useQuery({
    queryKey: ["orgs", "upcoming", from],
    queryFn: () => getJson("/api/events", EventsEnvelope, { from, to }),
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
  });

  const counts = useMemo<OrgEventCounts>(() => {
    const events = query.data?.events;
    if (!events) return null;
    if (events.length >= EVENTS_CAP) return null; // truncated — absence proves nothing
    const tally = new Map<string, number>();
    for (const event of events) {
      if (event.orgId === null || event.isCanceled) continue;
      tally.set(event.orgId, (tally.get(event.orgId) ?? 0) + 1);
    }
    return tally;
  }, [query.data]);

  return { counts, isPending: query.isPending };
}

export type ClubsDirectoryProps = {
  /** Clock injection for tests; defaults to the wall clock. */
  now?: () => Date;
  /** Cards revealed per page. Tests pass a large value to render everything. */
  pageSize?: number;
  className?: string;
};

export function ClubsDirectory({ now, pageSize = PAGE_SIZE, className }: ClubsDirectoryProps) {
  const orgs = useOrgs();
  const { selected, toggle, clear: clearCategories } = useCategoryFilter();
  const { query, withEvents, setQuery, setWithEvents, clear: clearQuery } = useDirectoryQuery();
  const { counts, isPending: countsPending } = useUpcomingCounts(now ?? (() => new Date()));

  const all = orgs.data ?? [];
  const facets = useMemo(() => categoryFacets(all, selected), [all, selected]);
  const matches = useMemo(
    () => filterOrgs(all, { query, categories: selected, withEvents }, counts),
    [all, query, selected, withEvents, counts],
  );

  // Reveal resets whenever the result set changes meaning — otherwise typing a
  // narrower query leaves you scrolled past the end of the new results.
  // Derived-state-during-render rather than an effect: no extra paint.
  const signature = `${query}|${selected.join(",")}|${withEvents}`;
  const [reveal, setReveal] = useState({ signature, count: pageSize });
  if (reveal.signature !== signature) setReveal({ signature, count: pageSize });
  const shown = matches.slice(0, reveal.count);

  const hasFilters = query !== "" || selected.length > 0 || withEvents;
  const clearAll = () => {
    clearQuery();
    clearCategories();
  };

  return (
    <div className={cn("h-full overflow-y-auto bg-bg-base", className)}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4">
        <Link
          to="/"
          className={cn(
            "inline-block font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
            FOCUS_RING,
          )}
        >
          ← map
        </Link>

        <header className="mt-4 border-b-2 border-brand-brown pb-4">
          <h1 className="text-30 font-medium tracking-tight text-text-primary">
            Clubs &amp; organizations
          </h1>
          <p className="max-w-[62ch] pt-1.5 text-16 text-text-secondary">
            Every recognized student group at Brown, undergraduate and graduate. Search by name,
            nickname, or Instagram handle.
          </p>
        </header>

        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-bg-base px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              density="comfortable"
              aria-label="Search clubs"
              placeholder={all.length > 0 ? `Search ${all.length} clubs…` : "Search clubs…"}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onClear={() => setQuery("")}
              className="w-full sm:w-80"
            />
            {/* Present while the counts load (disabled, so the toolbar does
                not jump), and gone for good if they come back untrustworthy —
                a filter that silently does nothing is worse than no filter. */}
            {(counts !== null || countsPending) && (
              <button
                type="button"
                aria-pressed={withEvents}
                disabled={countsPending}
                onClick={() => setWithEvents(!withEvents)}
                className={cn(
                  "inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-4 border px-2.5 text-14 transition-colors duration-150 ease-out",
                  withEvents
                    ? "border-accent/50 bg-bg-overlay text-text-primary"
                    : "border-line text-text-secondary hover:border-text-faint hover:text-text-primary",
                  countsPending && "opacity-50",
                  FOCUS_RING,
                )}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                  style={{ opacity: withEvents ? 1 : 0.4 }}
                />
                Has upcoming events
              </button>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={clearAll}
                className={cn(
                  "shrink-0 px-1 font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
                  FOCUS_RING,
                )}
              >
                clear all
              </button>
            )}
          </div>

          {facets.length > 0 && (
            <fieldset
              aria-label="Filter by category"
              className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
            >
              {facets.map((facet) => (
                <Chip
                  key={facet.category}
                  category={facet.category}
                  selected={selected.includes(facet.category)}
                  count={facet.count}
                  onToggle={toggle}
                />
              ))}
            </fieldset>
          )}

          <p className="pt-2.5 font-mono text-12 text-text-secondary">
            {orgs.isPending
              ? "loading directory…"
              : `${matches.length} of ${all.length} organization${all.length === 1 ? "" : "s"}`}
            {!orgs.isPending && counts === null && !countsPending && (
              <span className="pl-2">· upcoming-event counts unavailable</span>
            )}
          </p>
        </div>

        {orgs.isPending ? (
          <DirectorySkeleton />
        ) : orgs.isError ? (
          <EmptyState
            title="Directory unavailable"
            body="The read API is unreachable. The map still works — try again in a minute."
            action={<Button onClick={() => void orgs.refetch()}>Retry</Button>}
          />
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<CategoryIcon category="club" size={24} />}
            title="No clubs match"
            body={
              hasFilters
                ? "Nothing in the directory matches these filters. Try a shorter search — many clubs are listed under their full formal name."
                : "The directory came back empty, which should not happen. Reload, or try again shortly."
            }
            action={hasFilters ? <Button onClick={clearAll}>Clear filters</Button> : undefined}
          />
        ) : (
          <>
            <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((org) => (
                <li key={org.id} data-testid="club-card">
                  <OrgCard org={org} upcoming={counts?.get(org.id) ?? null} />
                </li>
              ))}
            </ul>
            {shown.length < matches.length && (
              <div className="mt-6 flex justify-center">
                <Button
                  onClick={() =>
                    setReveal((prev) => ({ ...prev, count: prev.count + Math.max(pageSize, 1) }))
                  }
                >
                  Show {Math.min(matches.length - shown.length, Math.max(pageSize, 1))} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ClubsDirectory;

function OrgCard({ org, upcoming }: { org: OrgOut; upcoming: number | null }) {
  const links = orgLinks(org);
  const meta = org.category === null ? null : CATEGORY_BY_ID[org.category];
  // Uncategorized falls back to Brown's seal brown rather than a grey: the
  // accent stripe is structure, and 457 grey stripes read as a broken build.
  const accent = meta ? `var(${meta.colorToken})` : "var(--brand-brown)";

  return (
    <article
      className={cn(
        "relative flex h-full flex-col gap-2 overflow-hidden rounded-6 border border-line bg-bg-raised py-4 pl-5 pr-4",
        "transition-colors duration-150 ease-out hover:border-text-faint",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent }}
      />

      <div className="flex items-start gap-2">
        {meta && (
          <CategoryIcon
            category={meta.id}
            size={16}
            className="mt-0.5 shrink-0"
            style={{ color: accent }}
          />
        )}
        <h2 className="min-w-0 text-16 font-medium leading-snug tracking-tight text-text-primary">
          {/* Stretched link: the whole card is the target. The link row below
              lifts itself out with z-10 so an Instagram click is not eaten. */}
          <Link
            to="/o/$id"
            params={{ id: org.id }}
            className={cn(
              "after:absolute after:inset-0 after:content-[''] hover:text-accent",
              FOCUS_RING,
            )}
          >
            {org.name}
          </Link>
        </h2>
      </div>

      {org.description !== null && (
        <p className="line-clamp-3 text-14 text-text-secondary">{org.description}</p>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div className="relative z-10 flex items-center gap-1">
          {links.map((link) => (
            <PlatformLink key={link.url} link={link} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {meta && <Badge>{meta.label}</Badge>}
          {upcoming !== null && upcoming > 0 && (
            <Badge variant="accent" className="font-mono">
              {upcoming} upcoming
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * One external link. `link.url` is absolute http(s) by construction
 * (`normalizeOrgUrl` returns `null` otherwise and `orgLinks` drops it), so
 * this component never renders a placeholder href — a missing link renders
 * nothing at all.
 */
function PlatformLink({ link }: { link: OrgLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={link.label}
      title={link.label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-4 text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-overlay hover:text-text-primary",
        FOCUS_RING,
      )}
    >
      <PlatformGlyph platform={link.platform} />
    </a>
  );
}

/** 16-grid, 1.5 stroke, butt caps — the same family as @brownsync/ui icons. */
const PLATFORM_PATHS: Readonly<Record<OrgLinkPlatform, string>> = {
  instagram:
    "M3.25 6.25 A3 3 0 0 1 6.25 3.25 L9.75 3.25 A3 3 0 0 1 12.75 6.25 L12.75 9.75 A3 3 0 0 1 9.75 12.75 L6.25 12.75 A3 3 0 0 1 3.25 9.75 Z M5.75 8 A2.25 2.25 0 1 0 10.25 8 A2.25 2.25 0 1 0 5.75 8 M10.3 5.5 L10.8 5.5",
  discord:
    "M4.5 3.75 L11.5 3.75 A2.25 2.25 0 0 1 13.75 6 L13.75 9.25 A2.25 2.25 0 0 1 11.5 11.5 L8.25 11.5 L5.25 13.5 L5.25 11.5 L4.5 11.5 A2.25 2.25 0 0 1 2.25 9.25 L2.25 6 A2.25 2.25 0 0 1 4.5 3.75 Z M5.75 7.5 L6.25 7.5 M9.75 7.5 L10.25 7.5",
  linktree: "M3.5 5.75 L12.5 5.75 M8 5.75 L8 12.75 M4.75 2.75 L8 5.75 L11.25 2.75",
  facebook:
    "M3.25 3.25 L12.75 3.25 L12.75 12.75 L3.25 12.75 Z M9.75 5.75 L8.75 5.75 A1.5 1.5 0 0 0 7.25 7.25 L7.25 12.75 M5.75 8.5 L9.5 8.5",
  twitter: "M4 4 L12 12 M12 4 L4 12",
  linkedin:
    "M3.25 3.25 L12.75 3.25 L12.75 12.75 L3.25 12.75 Z M5.75 7 L5.75 10.75 M5.5 5.25 L6 5.25 M8.25 10.75 L8.25 7 M8.25 8.5 A1.25 1.25 0 0 1 10.5 9.25 L10.5 10.75",
  website:
    "M2.25 8 A5.75 5.75 0 1 0 13.75 8 A5.75 5.75 0 1 0 2.25 8 M2.4 8 L13.6 8 M8 2.25 A3 5.75 0 0 1 8 13.75 A3 5.75 0 0 1 8 2.25",
};

function PlatformGlyph({ platform }: { platform: OrgLinkPlatform }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d={PLATFORM_PATHS[platform]}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** §6.4: card-shaped placeholders, never a bare spinner. */
function DirectorySkeleton() {
  return (
    <div
      aria-hidden
      data-testid="directory-skeleton"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
          key={i}
          className="flex flex-col gap-2 rounded-6 border border-line bg-bg-raised py-4 pl-5 pr-4"
        >
          <Skeleton className="h-4 w-2/3" style={{ animationDelay: `${i * 60}ms` }} />
          <Skeleton className="h-3 w-full" style={{ animationDelay: `${i * 60}ms` }} />
          <Skeleton className="h-3 w-4/5" style={{ animationDelay: `${i * 60}ms` }} />
          <Skeleton className="mt-2 h-5 w-24" style={{ animationDelay: `${i * 60}ms` }} />
        </div>
      ))}
    </div>
  );
}
