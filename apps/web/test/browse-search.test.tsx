// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { matchScore, normalizeQuery, rankByMatch, useSearch } from "../src/data/search";
import { createServer, resetSeenRequests, seenRequests } from "./helpers/msw";
import { makeQueryClient } from "./helpers/render";

const server = createServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => resetSeenRequests());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

describe("matchScore (client ranking for places/orgs/courses)", () => {
  it("ranks exact > prefix > word prefix > substring > miss", () => {
    expect(matchScore("sayles", ["Sayles"])).toBe(100);
    expect(matchScore("say", ["Sayles Hall"])).toBe(80);
    expect(matchScore("hall", ["Sayles Hall"])).toBe(70);
    expect(matchScore("yle", ["Sayles Hall"])).toBe(60);
    expect(matchScore("ratty", ["Sayles Hall"])).toBe(0);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(normalizeQuery("B&H")).toBe("b h");
    expect(matchScore("b&h", ["B&H"])).toBe(100);
    expect(matchScore("SALOMON", ["Salomon Center"])).toBe(80);
  });

  it("takes the best score across aliases", () => {
    expect(matchScore("bh", ["Barus & Holley", "BH"])).toBe(100);
  });

  it("rankByMatch sorts by score, drops misses, and caps", () => {
    const items = [
      { name: "Sayles Hall" },
      { name: "Salomon Center" },
      { name: "Andrews Commons" },
      { name: "Say" },
    ];
    const ranked = rankByMatch("say", items, (i) => [i.name], 2);
    // "Say" exact (100) beats "Sayles Hall" prefix (80); the misses drop out.
    expect(ranked.map((i) => i.name)).toEqual(["Say", "Sayles Hall"]);
  });
});

describe("useSearch fan-out (no /search route in the contract)", () => {
  it("stays inactive below the minimum query length", () => {
    const { result } = renderHook(() => useSearch("s"), { wrapper });
    expect(result.current.active).toBe(false);
    expect(result.current.total).toBe(0);
    expect(seenRequests).toHaveLength(0);
  });

  it("fans a query across events (server q), places, orgs", async () => {
    const { result } = renderHook(() => useSearch("salomon"), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false));
    // Events came back server-filtered via ?q=.
    expect(result.current.groups.events.map((e) => e.id)).toEqual(["e-salomon-lecture"]);
    const eventsRequest = seenRequests.find((u) => u.pathname === "/api/events");
    expect(eventsRequest?.searchParams.get("q")).toBe("salomon");
    // Places ranked client-side.
    expect(result.current.groups.places.map((p) => p.id)).toEqual(["salomon-center"]);
    expect(result.current.groups.orgs).toEqual([]);
    expect(result.current.degraded).toBe(false);
  });

  it("matches orgs by name and places by alias", async () => {
    const { result } = renderHook(() => useSearch("outing"), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.groups.orgs.map((o) => o.id)).toEqual(["brown-outing-club"]);

    const alias = renderHook(() => useSearch("b&h"), { wrapper });
    await waitFor(() => expect(alias.result.current.pending).toBe(false));
    expect(alias.result.current.groups.places.map((p) => p.id)).toEqual(["barus-holley"]);
  });

  it("searches courses via /meetings and dedupes weekly patterns", async () => {
    const { result } = renderHook(() => useSearch("csci"), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.groups.courses).toHaveLength(1);
    expect(result.current.groups.courses[0]?.courseCode).toBe("CSCI 0150");
  });

  it("flags degraded results when a source fails", async () => {
    const { HttpResponse, http } = await import("msw");
    server.use(
      http.get("*/api/orgs", () =>
        HttpResponse.json({ error: { code: "db", message: "down" } }, { status: 503 }),
      ),
    );
    const { result } = renderHook(() => useSearch("salomon"), { wrapper });
    // The failing source retries (1 s + 2 s backoff) before surfacing.
    await waitFor(() => expect(result.current.degraded).toBe(true), { timeout: 8000 });
    // Partial results still usable.
    expect(result.current.groups.places.map((p) => p.id)).toEqual(["salomon-center"]);
  });
});
