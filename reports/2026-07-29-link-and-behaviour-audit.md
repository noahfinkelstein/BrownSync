# Link & behaviour audit — dead hrefs and UI that lies

**Date:** 2026-07-29, snapshot taken 22:46 EDT (route tree re-verified 22:48 EDT)
**Scope:** `apps/web/src`, `packages/ui/src`, `apps/web/public`, static artifacts under `db/seeds`
**Method:** static analysis of every `href=` / `to=` / `fetch(` / `useQuery`, `curl` of every referenced
static asset, `node` reproductions of the pure functions, and live checks against the fixtures dev
server on `http://localhost:5199` (`VITE_USE_FIXTURES=1`).

> **The tree was moving under this audit.** Other agents were writing to `apps/web/src/events`,
> `apps/web/src/orgs`, `apps/web/src/panels`, `apps/web/src/time`, `apps/web/src/router.tsx` and
> `packages/ui/src/components` throughout. Every line number below was re-read at 22:46 EDT.
> See **§ Churn** at the end for what specifically changed mid-audit and what must be re-checked.

---

## P0 — breaks a core flow

### P0-1 · Every header link is a raw `<a href>`, so it hard-reloads and destroys all URL state

**`apps/web/src/panels/Header.tsx:56, 66, 69`**

```tsx
<a href="/"       …>BrownSync</a>
<a href="/events" …>Events</a>
<a href="/clubs"  …>Clubs</a>
```

These are plain anchors inside a TanStack Router app. TanStack only intercepts clicks on its own
`<Link>` component, so all three trigger a **full document navigation**: the JS bundle re-downloads,
React re-boots, MapLibre re-initialises, and the 4.9 MB `providence.pmtiles` plus ~1.0 MB of campus
GeoJSON are re-requested.

Worse, the URL state is silently thrown away. `?at=` (time cursor, `time/urlSync.ts`), `?cats=`
(category chips, `browse/filter.ts`) and `?layers=` (`map/useLayerState.ts`) are all sibling search
params that every other navigation in the app deliberately preserves via functional `search:`
updates. A bare `href="/"` drops all of them.

**Reproduction:** open `http://localhost:5199/?at=2026-08-01T18:00Z&cats=club,arts`, then click
**BrownSync** in the header. You land on `/` with no `?at=` and no `?cats=` — the time machine snaps
back to NOW and the chips clear — and the map reloads from scratch. The identical click through
`PageShell`'s `<Link to="/">` (`apps/web/src/pages/PageShell.tsx:14`) keeps them.

**Smallest fix:** replace all three with `<Link to="…">` from `@tanstack/react-router` (the file
already sits next to `PageShell.tsx`, which does it correctly).

---

### ~~P0-2 · `/events` and `/clubs` in the primary nav go to the not-found screen~~ — FIXED DURING THE AUDIT

Recorded because it demonstrates the exact defect class and because the guard against it is still
missing.

**`apps/web/src/panels/Header.tsx:66, 69`** point at `/events` and `/clubs`. At **22:30 EDT** the
route tree held only `/`, `/p/$id`, `/o/$id` — **both links were dead**. Reproduced live at the time:
`http://localhost:5199/events` and `http://localhost:5199/clubs` both rendered `NotFoundScreen`
("Nothing lives at this address — `/events` doesn't match the map, a place, or an org").

A concurrent agent landed `/events` at ~22:43 and `/clubs` at ~22:48. **Both links resolve as of
22:48 EDT** — verified against `router.tsx:45,56,68,79,90`.

**Still worth doing:** add a test that walks every `href`/`to` string literal in `apps/web/src` and
asserts it matches an entry in `router.routeTree`. The nav links shipped ahead of their routes by
~18 minutes here; without a guard, the next reordering of that work ships a 404 to users.

---

## P1 — visible wrong behaviour

### P1-1 · The "Buildings" and "Greens & fields" layer toggles do nothing

**`apps/web/src/map/layerRegistry.ts:91-92`** declares them; **`apps/web/src/map/LiveMap.tsx:63-75`**
never reads them.

```tsx
const layers = useLayerState();
const toggles: LayerToggles = useMemo(() => ({
  events: layers.state.events,
  classes: layers.state.classes,
  athletics: layers.state.athletics,   // ← buildings / greens absent
}), [layers.state]);
const amenityKinds = useMemo(() => amenityKindsFor(layers.state) as AmenityKind[], [layers.state]);
```

`amenityKindsFor` only returns layers that carry an `amenityKind`, which is `dining` alone.
`<CampusBuildingLayers>` (LiveMap.tsx:174) receives `activities` and `classesEnabled` — no visibility
prop. `<CampusLandmarkLayers />` (LiveMap.tsx:172) takes **no props at all**.

Grep for consumers is conclusive:

```
$ grep -rn 'state\.buildings\|state\.greens' apps/web/src
NONE — no consumer
```

Unlike genuinely unwired layers, these two are *not* marked `pending: true`, so `LayerPanel` renders
them enabled, focusable, with `aria-pressed` and a live colour dot — the full "this is a working
control" vocabulary.

**Reproduction (performed, live):** load `/`, open the **Campus** group in the layer panel, click
**Buildings**, then **Greens & fields**. The URL becomes
`http://localhost:5199/?layers=-buildings%2C-greens`, both rows flip to `aria-pressed="false"` and go
grey — and nothing whatsoever changes on the map. Copying that URL to someone else reproduces the
same lie: the panel claims two layers are off that were never off.

**Smallest fix:** either pass `enabled={layers.state.buildings}` /
`enabled={layers.state.greens}` down to `CampusBuildingLayers` / `CampusLandmarkLayers` and set
`visibility: "none"` on the corresponding style layers, or — if the work is not scheduled — mark
both `pending: true` in the registry, which `LayerPanel` and `useLayerState` already honour with a
disabled row, a "soon" tag and a second gate against programmatic/URL toggling.

---

### P1-2 · The list and the detail panel print different clock times for the same event

**`apps/web/src/browse/format.ts:1-5, 26-28`** vs **`apps/web/src/data/format.ts:8-15, 29-31`**

`browse/format.ts` says so in its own docstring — *"All math is in the viewer's local timezone
(campus wall time in practice)"* — and uses `d.getHours()`. `data/format.ts` pins everything to
`America/New_York` via `Intl` and the UI appends a literal `ET`. `time/tz.ts:1-8` states the project
rule outright: *"wall-clock semantics (day boundaries, 'tonight', 'this weekend') are computed in
campus time regardless of where the viewer is."* `browse/` does not follow it.

Surfaces on `browse/format.ts` (viewer-local): the Events-tab `ListView`, `PlacePage` and `OrgPage`
timeline rows, the ⌘K palette metadata column, `browse/grouping.ts`'s `Tonight` / `Today` /
`Tomorrow` buckets. Surfaces on `data/format.ts` (campus time): `EventDetailPanel`,
`EventHoverCard`, `EventsDirectory`.

**Reproduction (performed):**

```
$ TZ=America/Los_Angeles node tzcheck.mjs      # event start 2026-07-30T23:04:00Z
list  (browse/format.formatClock):  16:04
panel (data/format.fmtTime + ' ET'): 19:04 ET
grouping local getHours(): 16  -> tonight? false

$ TZ=Europe/London node tzcheck.mjs
list  (browse/format.formatClock):  00:04
panel (data/format.fmtTime + ' ET'): 19:04 ET
grouping local getHours(): 0  -> tonight? false
```

A prospective student browsing from California sees `16:04` in the list, clicks the row, and the
panel says `19:04 ET`. The list carries no timezone suffix, so there is nothing to reconcile them.
The bucket header is wrong too: a 19:04 ET event is not "Tonight" for that viewer, and a 21:00 ET
event lands in *tomorrow's* bucket for a London viewer.

**Smallest fix:** re-implement `browse/format.ts`'s `formatClock` / `isSameDay` and
`browse/grouping.ts`'s day/evening comparisons on top of the existing `time/tz.ts` helpers
(`localParts`, `isSameLocalDay`, `startOfLocalDay`) with `CAMPUS_TZ`. All of them are pure and
already unit-tested.

---

### P1-3 · `App.tsx` documents a cursor guarantee the org page does not honour

**`apps/web/src/App.tsx:11-14`**

> *"The dock is shell-level, not index-level, because the cursor is global: **the place and org
> pages list events at the same cursor**…"*

`apps/web/src/pages/OrgPage.tsx:35-36`:

```tsx
const org = useOrg(id);      // data/orgs.ts:25 — GET /api/orgs/:id, no `at` param
const now = new Date();      // wall clock, not the cursor
```

`data/orgs.ts:22-28` never sends `at`, so the server (and `mocks/fixtureApi.ts:139-156`, which *does*
accept `atIso`) splits `upcoming` / `past` around wall-clock now. Every relative label on the page
(`formatRelative(now, start)`, `formatDayLabel(…, now)`) is likewise computed from `new Date()`.

Note `PlacePage` was fixed for exactly this in commit `cd0967d` ("sync place activity with time
cursor") — `PlacePage.tsx:60` passes `meetingsBucketFor(cursor)`. `OrgPage` was left behind. And
`PlacePage` is only half-fixed: line 62 still does `const now = new Date()` and
`usePlaceWeekEvents(id)` (`data/places.ts:53-60`) sends no `at`, so the "This week" section and every
"in 3 h" label on that page are still wall-clock.

**Reproduction:** scrub the time machine to `+5d` (URL gains `?at=…`), then open any `/o/<id>`.
Events that are already over relative to the cursor still sit under **Upcoming**, and their rows read
`in 4 d` rather than the elapsed time at the cursor. The dock at the bottom of the very same screen
says the cursor is five days out.

**Smallest fix:** `useOrg(id, at)` → forward `at` to the query (key it on the bucket, mirroring
`meetingsBucketFor`), and replace `const now = new Date()` with `useCursorDate().cursor` in both
`OrgPage.tsx:36` and `PlacePage.tsx:62`.

---

### P1-4 · The Events-tab list never refetches on the cursor, so it disagrees with the map

**`apps/web/src/browse/useBrowseEvents.ts:26-27`**

```tsx
queryKey: ["browse-events", bboxStr],
queryFn: () => getJson("/api/events", EventsEnvelope, { bbox: bboxStr }),   // no from / to
```

The map, the NowBar and the Feed all read `useEventsWindow()` (`data/queries.ts:39-50`), which is
keyed on the cursor and fetches `[cursor − 12 h, cursor + 8 d]`. The list fetches the server default
`[now, now + 7 d]` — forever — and only *re-groups* the result at the cursor
(`ListView.tsx:45-46`).

This is precisely the failure `NowBar.tsx:14-17` says must not happen: *"a bar that says '47 events'
while the map draws four is worse than no bar."*

**Reproduction:** scrub the cursor **back** one day. The map redraws with yesterday's events and the
NowBar counts them; the Events tab cannot show a single one of them, because they are outside its
fixed `[now, +7 d]` fetch. Everything still in the list gets re-bucketed against yesterday, so the
"Happening now" and "Next hour" headers disappear and the whole list collapses into **This week**.
The pane header keeps saying `N events in view`.

**Smallest fix:** give `useBrowseEvents` the same window `useEventsWindow` uses — take
`eventsWindowFor(cursor)` and put `window.from` in the query key alongside `bboxStr`.

---

### P1-5 · `panels/ics.ts` line folding corrupts non-ASCII and violates RFC 5545

**`apps/web/src/panels/ics.ts:31-41`** — this is the module behind the **"Add to calendar"** button in
`EventDetailPanel.tsx:140`, the app's primary add-to-calendar affordance.

```ts
parts.push(rest.slice(0, 74));      // slices by UTF-16 code unit
…
parts.push(` ${rest.slice(0, 73)}`);
```

RFC 5545 §3.1 limits a content line to 75 **octets**. `String#slice` counts UTF-16 code units.

**(a) Octet overflow — reproduced against the real seed drop.** Replaying `db/seeds/events.ndjson`
(1 106 events) through the exact `escapeIcsText` + `foldIcsLine` pair produces **151 folded segments
over the 75-octet limit**, worst case 80 octets. Example:

```
SUMMARY:Chemistry Colloquium • Ioannis Spanopoulos • USF • When Pore and F   (80 octets, 74 chars)
```

147 event titles in the current drop are >66 chars *and* contain non-ASCII (`’`, `—`, `•`,
`“ ”`). Note the `LOCATION:` builder (`ics.ts:48`) inserts an em-dash itself:
`[placeName, locationRaw].join(" — ")`.

**(b) Surrogate-pair split — reproduced.** A title containing an emoji at the fold boundary is cut
mid-surrogate:

```
$ node icscheck.mjs
folded: "SUMMARY:AAAA…AAA\ud83c\r\n \udf89🎉🎉🎉"
contains lone surrogate: true
utf8 round-trip contains U+FFFD replacement char: true
```

The emoji arrives in the user's calendar as `��`. No event in today's seed has an emoji in its title,
so **(b) is latent, not currently reproducible with the shipped data** — but LiveWhale student-group
titles routinely carry them, and `EventOut.title` is unvalidated free text.

**Smallest fix:** this is already solved elsewhere in the tree — `apps/web/src/events/calendar.ts`
ships an octet-correct, code-point-iterating `foldIcsLine` and its docstring names both failure modes
verbatim. Delete `panels/ics.ts#foldIcsLine` and re-export the one from `events/calendar.ts` (or move
`eventToIcs` onto `events/calendar.ts#eventsToIcs`, which already handles all-day `VALUE=DATE` and
multi-event calendars correctly). Keeping two divergent folders is how this regresses.

---

### P1-6 · `href` is built from unvalidated contract strings on the org page and the detail panel

**`apps/web/src/pages/OrgPage.tsx:92, 95-99`** and **`apps/web/src/panels/EventDetailPanel.tsx:129, 194`**

The contract (`packages/contract/src/api.ts:27, 58-59`) types these as `z.string().nullable()` — no
URL validation at all. Both files drop the raw value straight into `href`.

`apps/web/src/orgs/orgLinks.ts:12-21` (written during this audit, by another agent) documents the
exact hazard:

> *"…every one of those becomes a relative href when dropped into an `<a>`: the browser resolves it
> against the current page and navigates the reader into our own 404 instead of telling them the link
> is missing."*

`normalizeOrgUrl` exists and is correct. Neither `OrgPage` nor `EventDetailPanel` calls it.

**Reproduction (computed against `OrgPage`'s exact expression, base `/o/brown-outing-club`):**

| `OrgOut` field value | rendered `href` | browser resolves to |
|---|---|---|
| `url: "brownoutingclub.com"` | `brownoutingclub.com` | `http://localhost:5199/o/brownoutingclub.com` → **our own not-found screen** |
| `instagram: "instagram.com/brownoutingclub"` | `https://instagram.com/instagram.com/brownoutingclub` | **Instagram 404** |
| `url: "mailto:club@brown.edu"` | `mailto:club@brown.edu` | opens a mail client from a link labelled "website ↗" |

The second row is a straight bug in the `startsWith("http")` guard at `OrgPage.tsx:96` — it only
catches values that already have a scheme, and blindly prefixes everything else.

Today's `db/seeds/organizations.ndjson` is clean (457 orgs; 0 scheme-less `url`, 337/337 `instagram`
values are full `https://instagram.com/...` URLs), so **this is latent against the current drop** —
but it is one upstream edit away, and the ingest side already tolerates the messy shapes
(`ingest/brownsync_ingest/clubs/links.py`).

**Smallest fix:** route all four call sites through
`normalizeOrgUrl(value, { instagramHandle: true })` / `absoluteHttpUrl(value)` and render nothing on
`null` — exactly what `events/EventsDirectory.tsx:218` already does for `event.url`.

---

## P2 — papercuts

### P2-1 · Selecting a "Courses in session" hit in ⌘K silently does nothing

**`apps/web/src/browse/SearchPalette.tsx:86-89`**

```tsx
const goCourse = (meeting: MeetingOut) => {
  close();
  if (meeting.placeId) void navigate({ to: "/p/$id", params: { id: meeting.placeId } });
};
```

The palette footer advertises `↵ open` and the row is a normal `Command.Item`. When `placeId` is
null, the palette closes and nothing happens — no navigation, no message.

**Reproduction:** `106 of 1755` rows in `db/seeds/course_meetings.ndjson` have `place_id: null`
(verified). Open ⌘K, type a course code whose meeting has no resolved place while it is in session,
press Enter: the palette shuts and you are still on the map.

**Smallest fix:** don't render un-navigable course rows (filter `courses` to
`m.placeId != null` in `data/search.ts:213`), or keep them and show the room string as
non-interactive metadata.

---

### P2-2 · The default Feed tab has no in-app destination for any row

**`apps/web/src/feed/FeedPanel.tsx:131-142`**

```tsx
return item.url ? (
  <a href={item.url} target="_blank" rel="noreferrer noopener" …>{body}</a>
) : (
  <div className="px-3 py-2.5">{body}</div>
);
```

Feed is the default pane (`IndexPage.tsx:26-30`: *"Feed leads and is the default"*). Every event row
carries `event.url` (`feed/model.ts:151`), so clicking an **event** in the app's landing surface takes
the reader **off BrownSync** to the LiveWhale page — it does not open the detail panel, does not fly
the map, does not visit the place. The neighbouring Events tab does all three for the same event
(`IndexPage.tsx:138` → `LiveMap#handleSelect`). Dining rows carry `url: null`
(`feed/model.ts:224`), so they render as an inert `<div>` — the one row type that visibly *is* a hall
you might want to look up is the one that isn't a link.

**Smallest fix:** make `FeedRow` a button for `kind === "event"` wired to the same `openEvent`
callback the Events tab uses, and route `kind === "dining"` rows to `/p/$id` via `item.placeId`;
keep the external anchor for `kind === "article"` only.

---

### P2-3 · Feed and publications failures render as "nothing is happening"

**`apps/web/src/feed/FeedPanel.tsx:13-24, 54-59`**

`usePublications` throws on a non-OK response, but `buildFeed` treats `publications.data ===
undefined` as "no articles" (`feed/rank.ts:326`, deliberately — the docstring explains why). Nothing
ever reads `publications.isError`. If `/data/publications.json` 404s and the event window is empty,
the pane renders:

> *Nothing to show at this time.*

which is a lie: a source is down. Same shape for `useAmenityIndex` (`pages/PlaceAmenities.tsx:41-65`)
— on fetch failure `PlaceAmenities` returns `null` and the "what's in this building" section vanishes
with no trace. Contrast `DiningPanel.tsx:37-42`, which does surface its own failure, and
`SearchPalette.tsx:120-124`, which renders a `degraded` banner. The pattern exists; two call sites
skip it.

**Smallest fix:** thread `publications.isError` (and `dining.isError`) into a one-line `degraded`
banner above the feed, mirroring the palette's.

---

### P2-4 · `usePlaceWeekEvents` closes over `id` but leaves it out of the query key

**`apps/web/src/data/places.ts:53-60`**

```tsx
queryKey: ["events", "week"],                                  // no id
select: (d) => d.events.filter((e) => e.placeId === id),        // closes over id
```

Correct today only because the inline `select` gets a fresh identity every render, defeating
TanStack's `select` memoisation — i.e. it works by accident and re-filters ≤500 rows on every render.
Any future `useCallback` around `select`, or a `select` hoisted to module scope, turns this into a
place page showing another building's events from cache.

**Smallest fix:** `queryKey: ["events", "week"]` stays (the fetch really is shared), but move the
filter out of `select` into a `useMemo` in the component, or key on `["events","week",id]`.

---

### P2-5 · `main.tsx` overwrites the SEO `<title>` on boot

**`apps/web/src/main.tsx:12`** — `document.title = "BrownSync";`

`apps/web/index.html:9` carefully sets
`BrownSync — everything happening at Brown, on one live map`, and `vite.config.ts` has a whole
build-time plugin (`brownsync:canonical-og`) devoted to getting the social card right. The first line
of app JS throws the title away. Verified live: `curl` returns the long title, `document.title` after
boot is `"BrownSync"`.

**Smallest fix:** delete line 12.

---

### P2-6 · `db/seeds/library_hours.json` is symlinked into `public/data/` and served, but nothing reads it

`apps/web/public/data/library-hours.json` → `../../../../db/seeds/library_hours.json`, resolves,
returns `200` / 48 449 bytes / `application/json`. `grep -rn 'library-hours\|libraryHours' apps/web/src`
returns nothing. Dead 48 KB in the deploy artifact and a data contract nobody consumes.

**Smallest fix:** drop the symlink, or wire the hours into `PlacePage`.

---

### P2-7 · Dining hall rows with no service today are `disabled` with no visual signal

**`apps/web/src/dining/DiningPanel.tsx:74-92`** — `disabled={today.length === 0}` on a button whose
class list carries no disabled styling. The row looks identical to an expandable one and simply does
not respond. Minor, but it is the same "control that isn't" pattern as P1-1.

---

## Checked and clean (negative results worth recording)

- **Static assets.** Every `/data/*.json`, `/data/*.geojson`, `/tiles/*` and `/icons/*` referenced in
  source or `manifest.webmanifest` returns `200` with the right content type and parses. All six
  `apps/web/public/data/` symlinks into `db/seeds/` resolve — **no dangling symlink**.
  `providence.pmtiles` is 4 883 218 bytes and served.
- **`href="#"`.** Zero occurrences anywhere in `apps/web/src` or `packages/ui/src`.
- **`target="_blank"` safety.** Every external anchor carries `rel` with `noreferrer`
  (`EventDetailPanel.tsx:131,196`, `OrgPage.tsx:186`, `FeedPanel.tsx:135`,
  `EventsDirectory.tsx:199,202,305`). `noreferrer` implies `noopener` in every current browser, so
  the ones missing an explicit `noopener` are not a defect.
- **`data-testid` cross-check.** No orphans in either direction. `health-row-clubs` resolves from
  `HealthStrip.tsx:146`'s `health-row-${source.source}` template against the `clubs` source in
  `mocks/fixtures.ts:555`; `place-probe` / `org-probe` / `states-gallery` are defined in the test
  harnesses (`test/helpers/render.tsx:54,59`, `e2e/harness/health-strip-entry.tsx:23`).
- **`to=` route targets.** All four (`PageShell.tsx:14`, `routeStates.tsx:64`,
  `PlaceMiniMap.tsx:171,187`, `EventsDirectory.tsx:278,288`) match real routes.
- **Google Calendar basic-format hazard.** `events/calendar.ts:169-198` already gets this right —
  `googleDatesParam` uses `toIcsUtc` (basic `YYYYMMDDTHHMMSSZ`), never `toISOString()`, and the
  docstring names the "Google silently drops the param and opens at now" failure. All-day ranges are
  end-exclusive. No defect found here.
- **`?ll=` round-trip.** `PlaceMiniMap.formatLl` / `parseLl` (lines 26-41) round-trip exactly, junk
  values are dropped and the param is cleaned (`IndexPage.tsx:69-100`).

---

## Churn — what moved under this audit, re-check before acting

Other agents were writing continuously between 22:30 and 22:46 EDT. Specifically observed:

| Area | What changed mid-audit |
|---|---|
| `apps/web/src/router.tsx` | `/events` route **added** at ~22:43, `/clubs` at ~22:48. Neither existed at 22:30, when both header nav links rendered the not-found screen (reproduced live). |
| `apps/web/src/panels/Header.tsx` | Rewritten at least twice — brown brand bar, the new `<nav aria-label="Directories">` block, `onBrown` props added then removed. The three raw `<a href>` (P0-2) survived both rewrites. |
| `apps/web/src/events/` | New: `EventsDirectory.tsx`, `calendar.ts`, `index.ts`. Contains a **correct** octet-safe `foldIcsLine` that supersedes `panels/ics.ts`'s. |
| `apps/web/src/orgs/` | New: `orgLinks.ts`, then `ClubsDirectory.tsx` (~22:45), then the `/clubs` route (~22:48). **Not audited** — it landed after the snapshot. |
| `apps/web/src/panels/` | New: `HappeningNow.tsx` / `happeningNow.ts` (mounted in `LiveMap.tsx:188`), `NowBar.tsx`, `nowSummary.ts`, `LayerPanel.tsx`. |
| `apps/web/src/time/` | New: `TimeStepper.tsx`, `TimeMachineDock.tsx`; `TimeMachineBar.tsx` deleted. |
| `packages/ui/src/components/` | All 13 components modified (light-theme repaint). `TimelineRow.tsx` hot-reloaded three times during the audit. |

Transient in-flight errors observed in the browser console — **not reported as findings**, both were
half-saved states that self-healed within a minute:

- `SyntaxError: The requested module '/src/panels/HappeningNow.ts' does not provide an export named 'HappeningNow'`
- `ReferenceError: Fragment is not defined` in `time/TimeStepper.tsx` (the `import { Fragment }` landed shortly after)

**One observation I could not attribute, flagged as suspected/unverified:** the map stayed on the
`Loading basemap…` overlay for the whole session. `window.__brownsyncMap` reported
`isStyleLoaded() === true`, `isSourceLoaded('protomaps') === true`, `queryRenderedFeatures` returning
787 `buildings-3d` features, glyphs fetching `200` from `protomaps.github.io` — yet `map.loaded()`
never became `true`, so `MapView.tsx:73-98`'s `markReady` never fired and the overlay never cleared.
Given that Vite was force-reloading the page every ~30 s and react-map-gl `<Source>`/`<Layer>`
children were being torn down and re-added on each HMR pass (`map.getStyle().sources` dropped from 5
entries to 1 between two consecutive evaluations), this is most likely an HMR artefact rather than a
product defect — `map.loaded()` is false whenever `_sourcesDirty` is set. **Worth one clean re-test
on a quiet tree**: if it reproduces without HMR churn, it is a P0, because the map is the product.
