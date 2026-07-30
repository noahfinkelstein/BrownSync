# Link and Behavior Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every still-active finding in the 2026-07-29 link and behavior audit, preserve the fixes already present in the dirty tree, and add behavior-level regressions for the affected user flows.

**Architecture:** Keep the existing TanStack Router, TanStack Query, campus-time, MapLibre style-spec, and feed abstractions. Fix each defect at its source: cursor parameters cross the API boundary, campus wall-clock helpers own day math, rendered links pass through existing URL gates, map controls set real style visibility, and feed rows expose honest in-app actions and degraded states.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Hono + Zod OpenAPI, MapLibre/react-map-gl, Vitest + Testing Library/MSW, Playwright, pnpm/Turbo.

## Global Constraints

- Preserve every pre-existing dirty-tree change; the audit snapshot was taken while other work was landing.
- Do not reimplement existing helpers: use `eventsWindowFor`, `meetingsBucketFor`, `time/tz.ts`, `absoluteHttpUrl`, and `normalizeOrgUrl`.
- Every production behavior change gets a failing regression first and a focused green run afterward.
- Internal navigation uses TanStack `<Link>`/router navigation and preserves sibling search parameters.
- External anchors render only for normalized absolute `http:` or `https:` URLs.
- Campus wall-clock semantics use `America/New_York` regardless of the viewer or test-runner timezone.
- Do not turn incomplete controls into clickable affordances; disabled/static states must look and read disabled/static.
- Keep one final all-inclusive commit, as requested by the user; do not create per-task commits.

---

### Task 1: Make all event lists honor the global cursor and campus timezone

**Files:**
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/routes.test.ts`
- Modify: `apps/api/test/validation.test.ts`
- Regenerate: `packages/contract/openapi.json`
- Modify: `apps/web/src/data/orgs.ts`
- Modify: `apps/web/src/data/places.ts`
- Modify: `apps/web/src/browse/useBrowseEvents.ts`
- Modify: `apps/web/src/browse/ListView.tsx`
- Modify: `apps/web/src/browse/format.ts`
- Modify: `apps/web/src/browse/grouping.ts`
- Modify: `apps/web/src/pages/OrgPage.tsx`
- Modify: `apps/web/src/pages/PlacePage.tsx`
- Modify: `apps/web/test/pages.test.tsx`
- Modify: `apps/web/test/browse-grouping.test.ts`
- Modify or create: `apps/web/test/browse-events.test.tsx`

**Interfaces:**
- Consumes: `AtQuerySchema`, `eventsWindowFor(cursor)`, `meetingsBucketFor(cursor)`, `useCursorDate()`, `localParts`, `isSameLocalDay`, `addLocalDays`, `startOfLocalDay`.
- Produces: `useOrg(id: string, at: string)`, `usePlaceWeekEvents(id: string, cursor: Date)`, and `useBrowseEvents(bbox, categories, cursor)` whose query keys and requests change with cursor buckets. The campus-week query remains shared across place IDs; place filtering moves out of TanStack `select` into `useMemo`.

- [ ] **Step 1: Add failing API cursor tests**

Add a route test that captures the pivot passed to `eventsByOrg`:

```ts
it("splits organization events at the requested cursor", async () => {
  let captured: Date | undefined;
  const app = createApp(
    fakeQueries({
      eventsByOrg: async (_id, pivot) => {
        captured = pivot;
        return { upcoming: [], past: [] };
      },
    }),
  );
  const res = await app.request(
    `/api/orgs/${orgRow.id}?at=2026-09-20T12:30:00-04:00`,
  );
  expect(res.status).toBe(200);
  expect(captured?.toISOString()).toBe("2026-09-20T16:30:00.000Z");
});
```

Add `/api/orgs/${orgRow.id}?at=noonish` to the validation rejection table. Run:

```bash
pnpm --filter @brownsync/api test -- routes.test.ts validation.test.ts
```

Expected before implementation: the captured pivot is wall-clock now and malformed `at` is accepted or ignored.

- [ ] **Step 2: Accept and use `at` on the organization API**

Give `orgByIdRoute.request` both params and `query: AtQuerySchema`. In the handler:

```ts
const { at } = c.req.valid("query");
const pivot = at !== undefined ? new Date(at) : new Date();
const { upcoming, past } = await queries.eventsByOrg(id, pivot);
```

Run the focused API tests and expect green.

- [ ] **Step 3: Regenerate and verify the OpenAPI document**

Run:

```bash
pnpm --filter @brownsync/api openapi
pnpm --filter @brownsync/api typecheck
```

Verify `/api/orgs/{id}` exposes optional `at` with the same ISO datetime schema as meetings/place activity.

- [ ] **Step 4: Add failing web request/cursor tests**

Add tests proving:

```ts
expect(requestedOrgUrl.searchParams.get("at")).toBe(meetingsBucketFor(cursor));
expect(browseRequest.searchParams.get("from")).toBe(eventsWindowFor(cursor).from);
expect(browseRequest.searchParams.get("to")).toBe(eventsWindowFor(cursor).to);
```

Render two place IDs against one query client and assert each page filters its own events while the identical campus window is fetched only once. This records the actual TanStack behavior: observer-local selectors do not leak results, but an inline selector re-filters on unrelated renders.

- [ ] **Step 5: Wire cursor windows through the web queries**

Implement:

```ts
export function useOrg(id: string, at: string) {
  return useQuery({
    queryKey: ["org", id, at],
    queryFn: () =>
      getJson(`/api/orgs/${encodeURIComponent(id)}`, OrgDetailOutSchema, { at }),
    enabled: id !== "",
    retry: retryUnlessNotFound,
  });
}
```

`usePlaceWeekEvents` must key the shared campus payload on `window.from`, send `from`/`to`, and filter `query.data` for `id` in `useMemo([query.data, id])` rather than an inline TanStack `select`. `useBrowseEvents` must include `window.from` in its key and send `bbox`, `from`, and `to`. `ListView` passes its injected/current cursor to the hook.

- [ ] **Step 6: Add failing cross-timezone formatting tests**

Use fixed ISO instants, not host-local constructors:

```ts
const cursor = new Date("2026-07-30T19:00:00Z"); // 15:00 EDT
expect(formatClock(new Date("2026-07-30T23:04:00Z"))).toBe("19:04");
expect(bucketOf(mkEvent({ start: "2026-07-30T23:04:00Z" }), cursor)).toBe("tonight");
```

Run the file under at least `TZ=America/Los_Angeles` and `TZ=Europe/London`; the current local-time implementation must fail.

- [ ] **Step 7: Move browse day math onto campus-time helpers**

`formatClock` delegates to `time/format.ts`. `isSameDay` delegates to `isSameLocalDay`. `formatDayLabel` uses `addLocalDays` plus `localParts`/`localWeekday`. `bucketOf` uses campus-local hour and a campus-local next midnight for all-day event end semantics.

In `OrgPage` and `PlacePage`:

```ts
const { cursor } = useCursorDate();
const at = meetingsBucketFor(cursor);
const org = useOrg(id, at);
const now = cursor;
```

Pass `cursor` to `usePlaceWeekEvents`.

- [ ] **Step 8: Run focused Task 1 checks**

```bash
pnpm --filter @brownsync/api test
pnpm --filter @brownsync/web test -- browse-grouping.test.ts pages.test.tsx browse-events.test.tsx
pnpm --filter @brownsync/api typecheck
pnpm --filter @brownsync/web typecheck
```

Expected: all commands exit 0, and the request assertions show the cursor bucket/window.

---

### Task 2: Make every navigation and external link truthful and safe

**Files:**
- Preserve/verify: `apps/web/src/panels/Header.tsx`
- Preserve/verify: `apps/web/src/panels/ics.ts`
- Preserve/verify: `apps/web/test/ics.test.ts`
- Modify: `apps/web/src/panels/EventDetailPanel.tsx`
- Modify: `apps/web/src/pages/OrgPage.tsx`
- Modify: `apps/web/src/data/search.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/test/pages.test.tsx`
- Modify: `apps/web/test/browse-search.test.tsx`
- Modify or create: `apps/web/test/link-integrity.test.tsx`
- Modify: `apps/web/e2e/smoke.e2e.ts`
- Modify or create: `apps/web/e2e/navigation.e2e.ts`

**Interfaces:**
- Consumes: TanStack `<Link>`, `router.matchRoutes`, `absoluteHttpUrl`, `normalizeOrgUrl`.
- Produces: normalized-or-null event/org URLs, navigable-only course search results, and browser-level proof that header navigation preserves `at`, `cats`, and `layers`.

- [ ] **Step 1: Add failing external-link rendering tests**

Render an org/detail response with:

```ts
{ url: "brownoutingclub.com", instagram: "instagram.com/brownoutingclub" }
```

and assert the rendered `href`s are `https://brownoutingclub.com` and `https://instagram.com/brownoutingclub`. Render `mailto:`/`#` values and assert no corresponding anchor exists. Render an event with `url: "#"` and assert “open source” is absent.

- [ ] **Step 2: Normalize every contract-derived anchor at the call site**

In `OrgPage`, compute:

```ts
const websiteUrl = normalizeOrgUrl(detail.url);
const instagramUrl = normalizeOrgUrl(detail.instagram, { instagramHandle: true });
```

In `EventDetailPanel`, compute:

```ts
const sourceUrl = absoluteHttpUrl(event.url);
const orgUrl = normalizeOrgUrl(org?.url);
```

Render anchors only when the normalized value is non-null.

- [ ] **Step 3: Add a failing search test for unresolved course locations**

Return two matching meetings, one with `placeId: null`, and assert `groups.courses` contains only the resolvable meeting. The production break this catches is an interactive result whose selection closes the palette without navigation.

- [ ] **Step 4: Filter courses before deduplication/ranking**

Start the course pipeline with:

```ts
const courseRows = (meetings.data?.meetings ?? []).filter(
  (meeting): meeting is MeetingOut & { placeId: string } => meeting.placeId !== null,
);
```

Then dedupe and rank as before. The existing `goCourse` guard remains defense in depth.

- [ ] **Step 5: Add title and navigation regressions**

In Playwright, assert:

```ts
await expect(page).toHaveTitle(
  "BrownSync — everything happening at Brown, on one live map",
);
```

Navigate from `/?at=...&cats=club,arts&layers=-buildings` through BrownSync, Events, and Clubs. Assert pathname changes without a document reload and all three sibling parameters remain.

For the primary nav route guard, enumerate the header targets once and assert `router.matchRoutes(target)` is non-empty.

- [ ] **Step 6: Remove the boot-time title overwrite and verify existing fixes**

Delete:

```ts
document.title = "BrownSync";
```

Keep the current `<Link>` header implementation and the single octet-aware `foldIcsLine`. Run the navigation/title tests and existing ICS/calendar suites. For the already-present header/calendar changes, mutation-check once by temporarily restoring the broken anchor/UTF-16 behavior, observing the regression fail, then restoring the fixed implementation.

- [ ] **Step 7: Run focused Task 2 checks**

```bash
pnpm --filter @brownsync/web test -- pages.test.tsx browse-search.test.tsx link-integrity.test.tsx ics.test.ts calendar.test.ts
pnpm --filter @brownsync/web e2e --grep "title|navigation"
pnpm --filter @brownsync/web typecheck
```

Expected: all commands exit 0; malformed URLs do not render anchors; title/nav browser assertions pass.

---

### Task 3: Make Buildings and Greens controls change real map visibility

**Files:**
- Modify: `apps/web/src/map/LiveMap.tsx`
- Modify: `apps/web/src/map/CampusBuildingLayers.tsx`
- Modify: `apps/web/src/map/CampusLandmarkLayers.tsx`
- Modify: `apps/web/src/map/campusBuildings.ts`
- Modify: `apps/web/src/map/campusLandmarks.ts`
- Modify: `apps/web/test/campusBuildings.test.ts`
- Modify or create: `apps/web/test/campusLandmarks.test.ts`

**Interfaces:**
- Consumes: `layers.state.buildings`, `layers.state.greens`.
- Produces: `CampusBuildingLayers({ enabled })` and `CampusLandmarkLayers({ enabled })`; every owned MapLibre layer emits `layout.visibility` as `"visible"` or `"none"`.

- [ ] **Step 1: Add failing style-spec visibility tests**

For every result from `campusLayers(false)` and the landmark equivalent:

```ts
expect(layer.layout?.visibility, layer.id).toBe("none");
```

Repeat for `true` expecting `"visible"`. Ensure the symbol-layer layout retains its text fields and sort key when visibility is added.

- [ ] **Step 2: Thread enabled state through the pure style builders**

Each builder accepts `enabled = true` and merges:

```ts
layout: {
  ...existingLayout,
  visibility: enabled ? "visible" : "none",
}
```

`campusLayers(enabled)` forwards the value to all building layers; add the matching landmark group helper if one does not exist.

- [ ] **Step 3: Thread the URL layer state into map components**

Add `enabled?: boolean` to both component prop types, recompute layer specs when it changes, and mount:

```tsx
<CampusLandmarkLayers enabled={layers.state.greens} />
<CampusBuildingLayers
  enabled={layers.state.buildings}
  activities={activities}
  classesEnabled={toggles.classes}
/>
```

- [ ] **Step 4: Run focused Task 3 checks**

```bash
pnpm --filter @brownsync/web test -- campusBuildings.test.ts campusLandmarks.test.ts layerRegistry.test.ts
pnpm --filter @brownsync/web typecheck
```

Expected: every owned style layer changes visibility while retaining its other layout properties.

---

### Task 4: Give feed, amenity, dining, and static-data states honest behavior

**Files:**
- Modify: `apps/web/src/feed/FeedPanel.tsx`
- Modify: `apps/web/src/pages/IndexPage.tsx`
- Modify: `apps/web/src/pages/PlaceAmenities.tsx`
- Create: `apps/web/src/pages/PlaceLibraryHours.tsx`
- Modify: `apps/web/src/pages/PlacePage.tsx`
- Modify: `apps/web/src/dining/DiningPanel.tsx`
- Create or modify: `apps/web/test/feed-panel.test.tsx`
- Create or modify: `apps/web/test/place-amenities.test.tsx`
- Create or modify: `apps/web/test/place-library-hours.test.tsx`
- Create or modify: `apps/web/test/dining-panel.test.tsx`

**Interfaces:**
- Consumes: `FeedItem` discriminated union, IndexPage’s `openEvent`, TanStack `<Link>`.
- Produces: event rows as in-app buttons, dining rows as place links, article rows as external anchors, visible degraded/error states, and cursor-aware library hours on matching place pages.

- [ ] **Step 1: Add failing feed affordance tests**

Render one row of each kind and assert:

```ts
expect(screen.getByRole("button", { name: /event title/i })).toBeVisible();
expect(screen.getByRole("link", { name: /blue room/i })).toHaveAttribute(
  "href",
  "/p/blue-room",
);
expect(screen.getByRole("link", { name: /news title/i })).toHaveAttribute(
  "target",
  "_blank",
);
```

Click the event and assert the supplied `onSelectEvent` receives the real `EventOut`.

- [ ] **Step 2: Render feed rows by kind**

`FeedPanel` accepts `onSelectEvent?: (event: EventOut) => void`; `IndexPage` passes its `openEvent`. `FeedRow` switches on `item.kind`:

- `event`: `<button type="button" onClick={() => onSelectEvent(item.event)}>`
- `dining` with a place: `<Link to="/p/$id" params={{ id: item.placeId }}>`
- `article`: safe external `<a target="_blank" rel="noreferrer noopener">`
- no destination: a non-interactive `<div>` with no “open” affordance

- [ ] **Step 3: Add failing degraded/error tests**

Mock publications/dining/amenities failures. Assert the feed shows an alert containing “some feed sources unavailable” even when rows remain, and does not present “Nothing to show” as the only explanation. Assert `PlaceAmenities` renders “Building amenities are unavailable right now.”

- [ ] **Step 4: Surface degraded feed and amenity state**

Read `eventsQuery.isError`, `publications.isError`, and `dining.isError`; render one role-alert banner above the list/empty state when any is true. `PlaceAmenities` reads `isError` and returns a one-line role-alert before the empty-data `null` path.

- [ ] **Step 5: Add a failing no-service dining-row test**

Render a hall with no service on the cursor’s campus date. Assert its control is disabled, its label says “no service today,” and its classes include a visible disabled treatment.

- [ ] **Step 6: Make unavailable dining rows visibly unavailable**

Keep the safe disabled gate and add:

```tsx
disabled:cursor-not-allowed disabled:opacity-60
```

Pass `today.length === 0` to the status label and render `no service today` instead of the ambiguous `closed`.

- [ ] **Step 7: Add a failing cursor-aware library-hours test**

Render `PlaceLibraryHours` for `john-d-rockefeller-jr-library` with a cursor on `2026-07-29`. Mock `/data/library-hours.json` with the real document shape and assert the rendered rows include Rockefeller Library, Library Services, and Brown ID Swipe Access with that campus date’s times. Move the cursor to a different campus date and assert the displayed hours change. Return no section for a non-library place, and render an alert when the artifact fails.

- [ ] **Step 8: Consume the existing library-hours artifact on place pages**

Create a typed static-artifact query keyed as `["library-hours"]`. Index the document by `placeId`, select the cursor’s campus-local `YYYY-MM-DD` record, and render one compact row per schedule:

```tsx
<span>{library.name}</span>
<span>{hours.note ?? `${formatClock(open)}–${formatClock(close)}`}</span>
```

Use the existing global cursor and campus-time formatter. Mount the component beside `PlaceAmenities` in `PlacePage`. Keep `apps/web/public/data/library-hours.json`: it is manifest-managed, refreshed daily, and now has a real consumer.

- [ ] **Step 9: Run focused Task 4 checks**

```bash
pnpm --filter @brownsync/web test -- feed-panel.test.tsx place-amenities.test.tsx place-library-hours.test.tsx dining-panel.test.tsx feed.test.ts dining.test.ts
pnpm --filter @brownsync/web typecheck
```

Expected: row roles/destinations and degraded/disabled copy match the assertions, and the dead symlink is absent.

---

### Task 5: Integrated verification, review, and one final commit

**Files:**
- Review: every changed file and the complete working tree.

**Interfaces:**
- Consumes: all Task 1–4 changes plus the pre-existing dirty-tree feature wave.
- Produces: a fully verified all-inclusive commit on `main`, without pushing.

- [ ] **Step 1: Run the full automated verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @brownsync/web e2e
```

Read every exit code and failure count; do not infer one check from another.

- [ ] **Step 2: Run clean browser QA**

Using the gstack `/browse` workflow against the fixture app, verify:

- Header navigation preserves `at`, `cats`, and `layers`.
- Buildings and Greens toggle visibly off/on.
- A feed event opens BrownSync detail; a dining row opens its place; an article stays external.
- Org/place timelines change around a scrubbed cursor.
- Malformed optional links are absent rather than dead.
- The basemap loading overlay clears on a quiet tree.

- [ ] **Step 3: Review audit coverage line by line**

Mark P0-1, P0-2 guard, P1-1 through P1-6, and P2-1 through P2-7 as fixed or already-fixed-and-verified. Record the suspected map overlay as not reproducible with the clean Playwright and browser runs.

- [ ] **Step 4: Review the complete diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Inspect audit-related diffs for scope and check that no pre-existing change was lost.

- [ ] **Step 5: Commit the complete working tree once**

```bash
git add -A
git commit -m "fix: complete BrownSync behavior audit"
```

Verify the commit exists and `git status --short --branch` is clean.
