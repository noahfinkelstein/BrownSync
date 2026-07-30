import type { Category, OrgOut } from "@brownsync/contract";
import { CATEGORY_IDS } from "@brownsync/contract";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { matchScore } from "../data/search";

/**
 * The clubs directory, as data: link normalisation, search, faceting, and
 * the URL state the view binds to. Pure except for the two hooks at the
 * bottom, which follow `browse/filter.ts` exactly.
 *
 * WHY A WHOLE MODULE FOR LINKS. `OrgOut.url` and `OrgOut.instagram` are
 * `string | null` — free text from a club directory, not validated URLs. The
 * seed happens to hold clean `https://instagram.com/...` today, but the
 * contract permits `@brownoutingclub`, `instagram.com/foo`, and
 * `mailto:club@brown.edu`, and every one of those becomes a *relative* href
 * when dropped into an `<a>`: the browser resolves it against the current
 * page and navigates the reader into our own 404 instead of telling them the
 * link is missing. So nothing reaches the DOM without passing
 * `normalizeOrgUrl`, which returns `null` rather than something plausible.
 * `null` renders NOTHING — never `href="#"`, which is a link that lies.
 *
 * The platform is decided by the HOST, never by the field it arrived in:
 * in the source export 7 Facebook pages and 2 Instagram profiles sit in the
 * `website_url` column, because clubs paste whatever link they hand out.
 * (Mirrors `ingest/brownsync_ingest/clubs/links.py`, deliberately: the same
 * rule has to hold on both sides of the API or the icons disagree with the
 * data.)
 */

export type OrgLinkPlatform =
  | "instagram"
  | "discord"
  | "linktree"
  | "facebook"
  | "twitter"
  | "linkedin"
  | "website";

export type OrgLink = {
  readonly platform: OrgLinkPlatform;
  /** Absolute http(s) URL. Guaranteed — this is the type's whole job. */
  readonly url: string;
  /** Accessible name, e.g. "Brown Outing Club on Instagram". */
  readonly label: string;
};

/** Host suffix → platform. Suffix-matched so `m.facebook.com` still lands. */
const HOST_PLATFORMS: readonly (readonly [string, OrgLinkPlatform])[] = [
  ["instagram.com", "instagram"],
  ["discord.gg", "discord"],
  ["discord.com", "discord"],
  ["discordapp.com", "discord"],
  ["linktr.ee", "linktree"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["x.com", "twitter"],
  ["twitter.com", "twitter"],
  ["linkedin.com", "linkedin"],
];

export const PLATFORM_LABELS: Readonly<Record<OrgLinkPlatform, string>> = {
  instagram: "Instagram",
  discord: "Discord",
  linktree: "Linktree",
  facebook: "Facebook",
  twitter: "X",
  linkedin: "LinkedIn",
  website: "Website",
};

/** Looks like a hostname (`brownwarwatch.com`) rather than a handle (`@bo`). */
const HOSTLIKE = /^[A-Za-z0-9._~-]+\.[A-Za-z]{2,24}(?::\d+)?(?:[/?#].*)?$/;
/** Instagram usernames: letters, digits, dot, underscore, ≤30 chars. */
const HANDLE = /^@?[A-Za-z0-9._]{1,30}$/;
/** Campaign parameters only — a denylist. `facebook.com/profile.php?id=…` is
 *  real data in the export, and stripping the query loses the page. */
const TRACKING = /^(?:utm_|fbclid$|gclid$|igshid$|igsh$|mc_cid$|mc_eid$|ref_src$)/i;

export type NormalizeOptions = {
  /**
   * Treat a scheme-less, dot-less value as an Instagram handle and complete
   * it into a profile URL. Only ever true for `OrgOut.instagram`: that field
   * supplies the namespace the value is missing. Anywhere else a bare word is
   * unresolvable and must be dropped, not guessed into a link.
   */
  readonly instagramHandle?: boolean;
};

/**
 * A raw contract string → an absolute http(s) URL, or `null`.
 *
 * `null` is the important return: it is what stops a broken anchor from
 * rendering. Lowercases the host, drops the fragment and campaign params, and
 * trims trailing slashes so two spellings of one page dedupe. The scheme is
 * never upgraded — http→https changes where the reader lands.
 */
export function normalizeOrgUrl(
  raw: string | null | undefined,
  options: NormalizeOptions = {},
): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;

  let candidate = value;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined && !scheme.includes(".")) {
    // A dotted "scheme" is really `host:port` (`brown.edu:8080/x`), so only an
    // undotted one counts. mailto:/tel:/javascript: are links that do
    // something other than open a page — never rendered.
    if (scheme !== "http" && scheme !== "https") return null;
  } else if (value.startsWith("//")) {
    candidate = `https:${value}`; // protocol-relative: a URL missing a scheme
  } else if (HOSTLIKE.test(value)) {
    candidate = `https://${value}`;
  } else if (options.instagramHandle && HANDLE.test(value)) {
    candidate = `https://instagram.com/${value.replace(/^@/, "")}`;
  } else {
    return null; // a bare word; nothing can be inferred
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  const query = url.searchParams.toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}${query === "" ? "" : `?${query}`}`;
}

/** Platform of an absolute URL, from its host. Unknown hosts are websites. */
export function classifyOrgLink(url: string): OrgLinkPlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "website";
  }
  if (host.startsWith("www.")) host = host.slice(4);
  let best: OrgLinkPlatform = "website";
  let bestLength = 0;
  for (const [suffix, platform] of HOST_PLATFORMS) {
    if ((host === suffix || host.endsWith(`.${suffix}`)) && suffix.length > bestLength) {
      best = platform;
      bestLength = suffix.length;
    }
  }
  return best;
}

export type LinkableOrg = Pick<OrgOut, "name" | "url" | "instagram">;

/**
 * Every renderable link for an org, deduped, in a stable order.
 *
 * Order is by platform rather than by field so a row of icons reads the same
 * on every card — a link row that shuffles is a link row nobody scans.
 */
export function orgLinks(org: LinkableOrg): OrgLink[] {
  const found = new Map<string, OrgLink>();
  const add = (raw: string | null, options?: NormalizeOptions): void => {
    const url = normalizeOrgUrl(raw, options);
    if (url === null) return;
    // Fold `www.` for the dedupe key only; the emitted href keeps it, since
    // a handful of hosts still 404 without it.
    const key = url.toLowerCase().replace(/^(https?:\/\/)www\./, "$1");
    if (found.has(key)) return;
    const platform = classifyOrgLink(url);
    found.set(key, { platform, url, label: `${org.name} on ${PLATFORM_LABELS[platform]}` });
  };
  add(org.instagram, { instagramHandle: true });
  add(org.url);

  const order: readonly OrgLinkPlatform[] = [
    "instagram",
    "discord",
    "linktree",
    "website",
    "facebook",
    "twitter",
    "linkedin",
  ];
  return [...found.values()].sort(
    (a, b) => order.indexOf(a.platform) - order.indexOf(b.platform) || a.url.localeCompare(b.url),
  );
}

// ---------------------------------------------------------------------------
// Search & filtering

/**
 * Everything a person might type to mean this org.
 *
 * `OrgOut` has no aliases field, so they are derived: the slug read as words
 * (`brown-outing-club` → "brown outing club" — what someone copies out of a
 * URL), the initialism (BOC), and the Instagram handle, which is frequently
 * the only name a club is actually known by.
 */
export function orgSearchKeys(org: Pick<OrgOut, "id" | "name" | "instagram">): string[] {
  const keys = [org.name, org.id.replace(/-/g, " ")];
  const words = org.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length > 1) keys.push(words.map((w) => w[0]).join(""));
  const instagram = normalizeOrgUrl(org.instagram, { instagramHandle: true });
  if (instagram !== null && classifyOrgLink(instagram) === "instagram") {
    const handle = new URL(instagram).pathname.replace(/^\//, "");
    if (handle !== "") keys.push(handle);
  }
  return keys;
}

export type OrgFilter = {
  readonly query?: string;
  readonly categories?: readonly Category[];
  /** Keep only orgs with ≥1 upcoming event. Ignored when counts are unknown. */
  readonly withEvents?: boolean;
};

/**
 * Upcoming-event tallies by org id, or `null` when they are not known.
 *
 * `null` is not "zero everywhere": the events API truncates at 500 rows, so
 * once it saturates, an org's absence stops being evidence that it has
 * nothing on. The view hides the counts and the "has events" filter rather
 * than publishing a number it cannot stand behind.
 */
export type OrgEventCounts = ReadonlyMap<string, number> | null;

/** Filter + rank. With a query, best match first; without, alphabetical. */
export function filterOrgs(
  orgs: readonly OrgOut[],
  filter: OrgFilter,
  counts: OrgEventCounts = null,
): OrgOut[] {
  const categories = filter.categories ?? [];
  const query = filter.query?.trim() ?? "";
  const ranked = query === "" ? null : new Map<string, number>();

  const kept = orgs.filter((org) => {
    if (categories.length > 0 && (org.category === null || !categories.includes(org.category))) {
      return false;
    }
    if (filter.withEvents && counts !== null && (counts.get(org.id) ?? 0) === 0) return false;
    if (ranked !== null) {
      const score = matchScore(query, orgSearchKeys(org));
      if (score === 0) return false;
      ranked.set(org.id, score);
    }
    return true;
  });

  return kept.sort((a, b) => {
    if (ranked !== null) {
      const diff = (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
}

export type CategoryFacet = { readonly category: Category; readonly count: number };

/**
 * Categories actually present in the data, with counts, in taxonomy order.
 *
 * Data-driven on purpose: every seeded org currently has `category: null`
 * (the ingest refuses to guess one from a club's name), so rendering all ten
 * taxonomy chips would offer ten filters that each return nothing. `extra`
 * carries whatever `?cats=` already holds, so a selection arriving from the
 * map is still visible and, more importantly, still clearable.
 */
export function categoryFacets(
  orgs: readonly OrgOut[],
  extra: readonly Category[] = [],
): CategoryFacet[] {
  const counts = new Map<Category, number>();
  for (const org of orgs) {
    if (org.category !== null) counts.set(org.category, (counts.get(org.category) ?? 0) + 1);
  }
  for (const category of extra) if (!counts.has(category)) counts.set(category, 0);
  return CATEGORY_IDS.filter((c) => counts.has(c)).map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// URL state — same idiom as browse/filter.ts (functional `search` updates that
// preserve sibling params, `undefined` to remove, replace + no scroll reset).

export const Q_PARAM = "q";
export const EVENTS_PARAM = "events";

export function parseQ(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `?events=1` only; anything else is "off", so a junk param can't strand. */
export function parseWithEvents(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

export type DirectoryQueryState = {
  readonly query: string;
  readonly withEvents: boolean;
  readonly setQuery: (next: string) => void;
  readonly setWithEvents: (next: boolean) => void;
  readonly clear: () => void;
};

/** `?q=` + `?events=` bound to the URL, siblings (`?cats=`, `?at=`) intact. */
export function useDirectoryQuery(): DirectoryQueryState {
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const navigate = useNavigate();
  const query = parseQ(search[Q_PARAM]);
  const withEvents = parseWithEvents(search[EVENTS_PARAM]);

  const patch = useCallback(
    (next: Record<string, string | undefined>) => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
      } as never);
    },
    [navigate],
  );

  const setQuery = useCallback(
    (next: string) => patch({ [Q_PARAM]: next === "" ? undefined : next }),
    [patch],
  );
  const setWithEvents = useCallback(
    (next: boolean) => patch({ [EVENTS_PARAM]: next ? "1" : undefined }),
    [patch],
  );
  const clear = useCallback(
    () => patch({ [Q_PARAM]: undefined, [EVENTS_PARAM]: undefined }),
    [patch],
  );

  return useMemo(
    () => ({ query, withEvents, setQuery, setWithEvents, clear }),
    [query, withEvents, setQuery, setWithEvents, clear],
  );
}
