// @vitest-environment jsdom
import type { EventDetailOut } from "@brownsync/contract";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { queryKeys } from "../src/data/queries";
import { EventDetailPanel } from "../src/panels/EventDetailPanel";
import { mkEvent, ORGS, PLACES } from "./helpers/fixtures";
import { makeQueryClient, stubScrolling } from "./helpers/render";

beforeAll(() => stubScrolling());
afterEach(() => cleanup());

function renderEventDetail({
  eventUrl,
  orgUrl,
}: {
  eventUrl: string | null;
  orgUrl: string | null;
}) {
  const event = mkEvent({
    id: "event-with-contract-links",
    title: "Link integrity event",
    start: "2026-09-20T20:00:00.000Z",
    url: eventUrl,
    orgId: "brown-outing-club",
    orgName: "Brown Outing Club",
  });
  const org = ORGS[0];
  const place = PLACES[0];
  if (!org || !place) throw new Error("missing detail fixtures");
  const detail: EventDetailOut = {
    ...event,
    org: { ...org, url: orgUrl },
    place,
  };
  const queryClient = makeQueryClient();
  queryClient.setQueryData(queryKeys.eventDetail(event.id), detail);

  return render(
    <QueryClientProvider client={queryClient}>
      <EventDetailPanel
        open
        onOpenChange={() => {}}
        eventId={event.id}
        seed={event}
        cursor={new Date("2026-09-20T19:00:00.000Z")}
      />
    </QueryClientProvider>,
  );
}

describe("EventDetailPanel contract-derived links", () => {
  it("keeps a valid absolute event source link usable", () => {
    renderEventDetail({
      eventUrl: "https://events.brown.edu/event/link-integrity",
      orgUrl: null,
    });

    expect(screen.getByRole("link", { name: /open source/i }).getAttribute("href")).toBe(
      "https://events.brown.edu/event/link-integrity",
    );
  });

  it("normalizes a scheme-less event source link before rendering it", () => {
    renderEventDetail({
      eventUrl: "events.brown.edu/event/link-integrity",
      orgUrl: null,
    });

    expect(screen.getByRole("link", { name: /open source/i }).getAttribute("href")).toBe(
      "https://events.brown.edu/event/link-integrity",
    );
  });

  it("does not render an open-source anchor for a non-http event URL", () => {
    renderEventDetail({ eventUrl: "#", orgUrl: null });

    expect(screen.queryByRole("link", { name: /open source/i })).toBeNull();
  });

  it("normalizes a scheme-less organizer website before rendering it", () => {
    renderEventDetail({ eventUrl: null, orgUrl: "brownoutingclub.com" });

    expect(screen.getByRole("link", { name: "brownoutingclub.com" }).getAttribute("href")).toBe(
      "https://brownoutingclub.com",
    );
  });

  it("does not render an organizer anchor for a non-http scheme", () => {
    renderEventDetail({ eventUrl: null, orgUrl: "mailto:club@brown.edu" });

    expect(screen.queryByRole("link")).toBeNull();
  });
});
