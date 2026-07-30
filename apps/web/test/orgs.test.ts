// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { type OrgOut, OrgOutSchema } from "@brownsync/contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ClubsDirectory } from "../src/orgs/ClubsDirectory";
import {
  categoryFacets,
  classifyOrgLink,
  filterOrgs,
  normalizeOrgUrl,
  orgLinks,
  orgSearchKeys,
} from "../src/orgs/orgLinks";
import { mkEvent } from "./helpers/fixtures";
import { createServer } from "./helpers/msw";
import { renderWithHarness, searchOf, stubScrolling } from "./helpers/render";

/**
 * The directory's one non-negotiable: it never renders a link that lies.
 *
 * `OrgOut.url` / `OrgOut.instagram` are free text from a club directory, so a
 * `mailto:`, a bare `@handle`, or an empty string is always one bad row away.
 * Dropped into an `<a href>` those become RELATIVE urls — the browser resolves
 * them against the current page and the reader lands in our own 404 while
 * believing they clicked through to Instagram. Half this file exists to pin
 * that such a value produces no anchor at all.
 */

const server = createServer();
beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

const NOW = new Date(2026, 8, 15, 12, 0);
const clock = () => NOW;

function org(over: Partial<OrgOut> & { id: string; name: string }): OrgOut {
  return OrgOutSchema.parse({
    kind: "club",
    category: null,
    description: null,
    url: null,
    instagram: null,
    defaultPlaceId: null,
    ...over,
  });
}

// A directory that contains every shape the contract permits, including the
// ones that break naive rendering.
const DIRECTORY: OrgOut[] = [
  org({
    id: "brown-outing-club",
    name: "Brown Outing Club",
    category: "club",
    description: "Hiking, climbing, and paddling trips around New England.",
    url: "https://discord.gg/AbCdEf", // a Discord invite in the website field
    instagram: "@brownoutingclub", // a bare handle, not a URL
  }),
  org({
    id: "brown-university-orchestra",
    name: "Brown University Orchestra",
    category: "arts",
    description: "The university's flagship symphony orchestra.",
    url: "https://www.brown.edu/orchestra/",
    instagram: "https://instagram.com/brownorchestra?igshid=xyz",
  }),
  org({
    id: "mail-only-society",
    name: "Mail Only Society",
    // The exact broken-anchor case: neither field is a link.
    url: "mailto:mailonly@brown.edu",
    instagram: "  ",
  }),
  org({ id: "no-links-club", name: "No Links Club" }),
];

function useDirectory(orgs: OrgOut[] = DIRECTORY) {
  server.use(http.get("*/api/orgs", () => HttpResponse.json({ orgs })));
}

function useEvents(events: ReturnType<typeof mkEvent>[]) {
  server.use(http.get("*/api/events", () => HttpResponse.json({ events })));
}

function renderDirectory(pathname = "/") {
  return renderWithHarness(createElement(ClubsDirectory, { now: clock, pageSize: 500 }), {
    path: pathname,
  });
}

// ---------------------------------------------------------------------------

describe("normalizeOrgUrl — the gate every href passes through", () => {
  it("returns null for values that would become relative hrefs", () => {
    // Each of these, used verbatim as href, navigates inside brownsync.
    for (const value of ["@brownoutingclub", "brownoutingclub", "#", "", "   ", "javascript:x"]) {
      expect(normalizeOrgUrl(value), value).toBeNull();
    }
  });

  it("returns null for schemes that are not http(s)", () => {
    expect(normalizeOrgUrl("mailto:club@brown.edu")).toBeNull();
    expect(normalizeOrgUrl("tel:+14018631000")).toBeNull();
    expect(normalizeOrgUrl("ftp://files.brown.edu/x")).toBeNull();
  });

  it("returns null for null/undefined rather than throwing", () => {
    expect(normalizeOrgUrl(null)).toBeNull();
    expect(normalizeOrgUrl(undefined)).toBeNull();
  });

  it("completes a bare Instagram handle only when the field says Instagram", () => {
    expect(normalizeOrgUrl("@brownoutingclub", { instagramHandle: true })).toBe(
      "https://instagram.com/brownoutingclub",
    );
    expect(normalizeOrgUrl("brownoutingclub", { instagramHandle: true })).toBe(
      "https://instagram.com/brownoutingclub",
    );
    // Without the opt-in it stays dropped — no other field can supply a
    // namespace for a bare word.
    expect(normalizeOrgUrl("@brownoutingclub")).toBeNull();
  });

  it("does not turn a domain in the Instagram field into a fabricated profile", () => {
    // https://instagram.com/brownoutingclub.com would be a confident 404.
    expect(normalizeOrgUrl("brownoutingclub.com", { instagramHandle: true })).toBe(
      "https://brownoutingclub.com",
    );
  });

  it("adds https to a scheme-less host and never upgrades an explicit http", () => {
    expect(normalizeOrgUrl("brownwarwatch.com")).toBe("https://brownwarwatch.com");
    expect(normalizeOrgUrl("//instagram.com/x")).toBe("https://instagram.com/x");
    // A club on a certificate-less host must keep working.
    expect(normalizeOrgUrl("http://brown-kgsa.com")).toBe("http://brown-kgsa.com");
  });

  it("lowercases the host, drops the fragment, and trims trailing slashes", () => {
    expect(normalizeOrgUrl("https://WWW.Facebook.com/bikesatbrown/#about")).toBe(
      "https://www.facebook.com/bikesatbrown",
    );
  });

  it("strips campaign parameters but keeps a load-bearing query", () => {
    expect(normalizeOrgUrl("https://instagram.com/x?igshid=a&utm_source=b")).toBe(
      "https://instagram.com/x",
    );
    // Both of these are real values in the source export: the query IS the
    // page. "Strip the query" would link to the wrong thing, which loads.
    expect(normalizeOrgUrl("https://www.facebook.com/profile.php?id=61571865550828")).toBe(
      "https://www.facebook.com/profile.php?id=61571865550828",
    );
    expect(normalizeOrgUrl("https://listserv.brown.edu/cgi-bin/wa?SUBED1=FRENCH_THEORY")).toBe(
      "https://listserv.brown.edu/cgi-bin/wa?SUBED1=FRENCH_THEORY",
    );
  });
});

describe("classifyOrgLink — the host decides, not the field", () => {
  it("maps known hosts, including subdomains", () => {
    expect(classifyOrgLink("https://instagram.com/x")).toBe("instagram");
    expect(classifyOrgLink("https://www.instagram.com/x")).toBe("instagram");
    expect(classifyOrgLink("https://discord.gg/x")).toBe("discord");
    expect(classifyOrgLink("https://discord.com/invite/x")).toBe("discord");
    expect(classifyOrgLink("https://linktr.ee/x")).toBe("linktree");
    expect(classifyOrgLink("https://m.facebook.com/x")).toBe("facebook");
    expect(classifyOrgLink("https://x.com/x")).toBe("twitter");
    expect(classifyOrgLink("https://twitter.com/x")).toBe("twitter");
    expect(classifyOrgLink("https://ca.linkedin.com/company/x")).toBe("linkedin");
  });

  it("treats an unknown host as a website rather than a failure", () => {
    expect(classifyOrgLink("https://brownwarwatch.com")).toBe("website");
  });

  it("classifies a Discord invite sitting in the website field as Discord", () => {
    // Otherwise the card shows a globe that drops you into a chat server.
    const [link] = orgLinks({ name: "X", url: "https://discord.gg/AbCdEf", instagram: null });
    expect(link?.platform).toBe("discord");
  });
});

describe("orgLinks", () => {
  it("emits nothing for an org whose fields are not links", () => {
    // The Instagram field is the one place a bare handle IS resolvable, so
    // this row has to be unresolvable in both fields to prove the point.
    expect(orgLinks({ name: "X", url: "mailto:x@brown.edu", instagram: "  " })).toEqual([]);
    expect(orgLinks({ name: "X", url: "#", instagram: null })).toEqual([]);
    expect(orgLinks({ name: "X", url: null, instagram: null })).toEqual([]);
  });

  it("dedupes the same page written two ways", () => {
    const links = orgLinks({
      name: "X",
      url: "https://www.instagram.com/brownband/",
      instagram: "https://instagram.com/brownband",
    });
    expect(links).toHaveLength(1);
  });

  it("labels each link with the org name so icons have accessible names", () => {
    const [link] = orgLinks({ name: "Brown Outing Club", url: null, instagram: "@boc" });
    expect(link?.label).toBe("Brown Outing Club on Instagram");
  });

  it("every emitted url is absolute http(s)", () => {
    for (const candidate of DIRECTORY) {
      for (const link of orgLinks(candidate)) {
        expect(link.url, candidate.name).toMatch(/^https?:\/\/[^/]+/);
      }
    }
  });
});

describe("search, filter, facets", () => {
  it("derives aliases from the slug, the initialism, and the handle", () => {
    const keys = orgSearchKeys(DIRECTORY[0] as OrgOut);
    expect(keys).toContain("Brown Outing Club");
    expect(keys).toContain("brown outing club");
    expect(keys).toContain("BOC");
    expect(keys).toContain("brownoutingclub");
  });

  it("finds a club by its initialism and by its Instagram handle", () => {
    expect(filterOrgs(DIRECTORY, { query: "BOC" }).map((o) => o.id)).toEqual(["brown-outing-club"]);
    expect(filterOrgs(DIRECTORY, { query: "brownoutingclub" }).map((o) => o.id)).toEqual([
      "brown-outing-club",
    ]);
  });

  it("sorts alphabetically with no query and by match quality with one", () => {
    expect(filterOrgs(DIRECTORY, {}).map((o) => o.name)).toEqual([
      "Brown Outing Club",
      "Brown University Orchestra",
      "Mail Only Society",
      "No Links Club",
    ]);
    // "Brown Outing Club" is a prefix match; the orchestra only matches later
    // in the string, so the exact-ish hit must lead.
    expect(filterOrgs(DIRECTORY, { query: "brown outing" })[0]?.id).toBe("brown-outing-club");
  });

  it("drops uncategorized orgs when a category filter is on", () => {
    // Every seeded org has category null today, so this is the difference
    // between "filter finds nothing" and "filter silently matches all".
    expect(filterOrgs(DIRECTORY, { categories: ["arts"] }).map((o) => o.id)).toEqual([
      "brown-university-orchestra",
    ]);
  });

  it("ignores the has-events filter when counts are unknown", () => {
    // Counts null means the events API truncated. Filtering on it would hide
    // clubs for a reason we cannot substantiate.
    expect(filterOrgs(DIRECTORY, { withEvents: true }, null)).toHaveLength(DIRECTORY.length);
    const counts = new Map([["brown-outing-club", 2]]);
    expect(filterOrgs(DIRECTORY, { withEvents: true }, counts).map((o) => o.id)).toEqual([
      "brown-outing-club",
    ]);
  });

  it("offers only categories present in the data, plus whatever is selected", () => {
    expect(categoryFacets(DIRECTORY).map((f) => f.category)).toEqual(["club", "arts"]);
    // An inherited ?cats=food from the map must stay visible so it is clearable.
    const withExtra = categoryFacets(DIRECTORY, ["food"]);
    expect(withExtra.map((f) => f.category)).toEqual(["club", "arts", "food"]);
    expect(withExtra.find((f) => f.category === "food")?.count).toBe(0);
    expect(categoryFacets([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("ClubsDirectory (rendered)", () => {
  it("lists every organization as a card", async () => {
    useDirectory();
    const { container } = renderDirectory();
    await screen.findByText("Brown Outing Club");
    expect(container.querySelectorAll('[data-testid="club-card"]')).toHaveLength(4);
    await screen.findByText("4 of 4 organizations");
  });

  it("renders NO anchor with an empty, '#', or undefined href", async () => {
    useDirectory();
    const { container } = renderDirectory();
    await screen.findByText("Brown Outing Club");

    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(4); // not vacuous
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      expect(href, anchor.outerHTML).not.toBeNull();
      expect(href, anchor.outerHTML).not.toBe("");
      expect(href, anchor.outerHTML).not.toBe("#");
      expect(href, anchor.outerHTML).not.toBe("undefined");
      expect(href, anchor.outerHTML).not.toBe("null");
      expect(href ?? "", anchor.outerHTML).not.toMatch(/^\s+$/);
    }
  });

  it("opens every external link in a new tab with a safe rel", async () => {
    useDirectory();
    const { container } = renderDirectory();
    await screen.findByText("Brown Outing Club");

    const external = [...container.querySelectorAll("a")].filter((a) =>
      (a.getAttribute("href") ?? "").startsWith("http"),
    );
    // outing: discord + instagram; orchestra: instagram + website.
    expect(external).toHaveLength(4);
    for (const anchor of external) {
      expect(anchor.getAttribute("target"), anchor.outerHTML).toBe("_blank");
      const rel = anchor.getAttribute("rel") ?? "";
      expect(rel, anchor.outerHTML).toContain("noreferrer");
      expect(rel, anchor.outerHTML).toContain("noopener");
      expect(anchor.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("renders no link icons for an org whose fields are not links", async () => {
    useDirectory();
    const { container } = renderDirectory();
    await screen.findByText("Mail Only Society");
    for (const name of ["Mail Only Society", "No Links Club"]) {
      const card = [...container.querySelectorAll('[data-testid="club-card"]')].find((c) =>
        c.textContent?.includes(name),
      );
      expect(card, name).toBeDefined();
      const externals = [...(card?.querySelectorAll("a") ?? [])].filter((a) =>
        (a.getAttribute("href") ?? "").startsWith("http"),
      );
      expect(externals, `${name} rendered an external link it has no data for`).toHaveLength(0);
    }
  });

  it("links each card to the existing org page", async () => {
    useDirectory();
    const { container } = renderDirectory();
    const title = await screen.findByRole("link", { name: "Brown Outing Club" });
    expect(title.getAttribute("href")).toBe("/o/brown-outing-club");
    expect(container.querySelector('a[href="/o/mail-only-society"]')).not.toBeNull();
  });

  it("applies ?q= from the URL and writes it back as you type", async () => {
    useDirectory();
    const user = userEvent.setup();
    const { router } = renderDirectory("/?q=orchestra");
    await screen.findByText("Brown University Orchestra");
    expect(screen.queryByText("Brown Outing Club")).toBeNull();

    const input = screen.getByRole("searchbox", { name: "Search clubs" });
    await user.clear(input);
    await user.type(input, "BOC");
    await waitFor(() => expect(searchOf(router).q).toBe("BOC"));
    await screen.findByText("Brown Outing Club");
  });

  it("preserves sibling params when it edits its own", async () => {
    // ?at= belongs to the time cursor; a naive `search: {q}` would drop it and
    // silently reset the whole app's clock.
    useDirectory();
    const user = userEvent.setup();
    const { router } = renderDirectory("/?at=2026-09-15T12:00:00.000Z&cats=arts");
    await screen.findByText("Brown University Orchestra");
    await user.type(screen.getByRole("searchbox", { name: "Search clubs" }), "orch");
    await waitFor(() => expect(searchOf(router).q).toBe("orch"));
    expect(searchOf(router).at).toBe("2026-09-15T12:00:00.000Z");
    expect(searchOf(router).cats).toBe("arts");
  });

  it("applies ?cats= — the same param the map layers read", async () => {
    useDirectory();
    renderDirectory("/?cats=arts");
    await screen.findByText("Brown University Orchestra");
    expect(screen.queryByText("Brown Outing Club")).toBeNull();
    await screen.findByText("1 of 4 organizations");
  });

  it("shows only categories that exist in the data", async () => {
    useDirectory();
    renderDirectory();
    const chips = await screen.findByRole("group", { name: "Filter by category" });
    // Two of ten: rendering all ten would offer eight filters that find nothing.
    expect(within(chips).getAllByRole("button")).toHaveLength(2);
    expect(within(chips).getByRole("button", { name: /Club/ })).toBeTruthy();
  });

  it("filters by upcoming events and shows the count on the card", async () => {
    useEvents([
      mkEvent({
        id: "e1",
        title: "Trip meeting",
        start: NOW.toISOString(),
        orgId: "brown-outing-club",
        orgName: "Brown Outing Club",
      }),
      mkEvent({
        id: "e2",
        title: "Canceled trip",
        start: NOW.toISOString(),
        orgId: "brown-outing-club",
        isCanceled: true,
      }),
    ]);
    useDirectory();
    const user = userEvent.setup();
    renderDirectory();
    // The canceled one does not count — a called-off event is not activity.
    await screen.findByText("1 upcoming");

    await user.click(screen.getByRole("button", { name: "Has upcoming events" }));
    await screen.findByText("1 of 4 organizations");
    expect(screen.queryByText("No Links Club")).toBeNull();
  });

  it("hides the has-events filter when the counts cannot be trusted", async () => {
    // A saturated response (>= the API's 500-row cap) means an org's absence
    // no longer proves it has nothing on.
    useEvents(
      Array.from({ length: 500 }, (_, i) =>
        mkEvent({ id: `bulk-${i}`, title: `Event ${i}`, start: NOW.toISOString() }),
      ),
    );
    useDirectory();
    renderDirectory();
    await screen.findByText("Brown Outing Club");
    expect(screen.queryByRole("button", { name: "Has upcoming events" })).toBeNull();
    await screen.findByText(/upcoming-event counts unavailable/);
  });

  it("offers a way out of a filtered-empty result", async () => {
    useDirectory();
    const user = userEvent.setup();
    renderDirectory("/?q=zzzznotaclub");
    await screen.findByText("No clubs match");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Brown Outing Club");
  });

  it("shows the designed error state with retry, never a bare spinner", async () => {
    server.use(
      http.get("*/api/orgs", () =>
        HttpResponse.json({ error: { code: "db", message: "down" } }, { status: 503 }),
      ),
    );
    renderDirectory();
    await screen.findByText("Directory unavailable", undefined, { timeout: 8000 });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("paginates rather than dumping every card, and the count strip stays honest", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      org({ id: `club-${i}`, name: `Club ${String(i).padStart(2, "0")}` }),
    );
    useDirectory(many);
    const user = userEvent.setup();
    const { container } = renderWithHarness(
      createElement(ClubsDirectory, { now: clock, pageSize: 12 }),
    );
    await screen.findByText("Club 00");
    expect(container.querySelectorAll('[data-testid="club-card"]')).toHaveLength(12);
    await screen.findByText("30 of 30 organizations");
    await user.click(screen.getByRole("button", { name: "Show 12 more" }));
    expect(container.querySelectorAll('[data-testid="club-card"]')).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------

describe("the published seed survives the link parser", () => {
  const rows = readFileSync(
    path.resolve(__dirname, "../../../db/seeds/organizations.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) => JSON.parse(line) as { id: string; name: string; url?: string; instagram?: string },
    );

  it("carries the full directory", () => {
    expect(rows.length).toBe(457);
  });

  it("produces an absolute http(s) url for every link of every real org", () => {
    let emitted = 0;
    for (const row of rows) {
      for (const link of orgLinks({
        name: row.name,
        url: row.url ?? null,
        instagram: row.instagram ?? null,
      })) {
        expect(link.url, row.id).toMatch(/^https?:\/\/[^\s/]+/);
        expect(() => new URL(link.url)).not.toThrow();
        emitted += 1;
      }
    }
    // 445 url + 337 instagram, less the rows where both name one page.
    expect(emitted).toBeGreaterThan(700);
  });

  it("recognises the Instagram profiles the seed actually holds", () => {
    const instagram = rows.filter(
      (row) =>
        row.instagram != null &&
        classifyOrgLink(normalizeOrgUrl(row.instagram) ?? "") === "instagram",
    );
    expect(instagram).toHaveLength(337);
  });
});
