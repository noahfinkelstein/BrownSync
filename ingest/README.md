# brownsync-ingest

Python 3.12 ingestion package for BrownSync: recorded source evidence in,
validated `db/seeds/**` files (or Postgres upserts) out. Managed with
[uv](https://docs.astral.sh/uv/); all commands below run from `ingest/`.

## Runtime and layout

```
ingest/
  brownsync_ingest/
    contract.py          # strict DB-row models (DATA_CONTRACT.md v1 wins)
    policy.py            # slug/coordinate/confidence/CAB-time validators
    output.py            # deterministic, per-file atomic NDJSON publication
    common/              # CachedHttpClient, CheckpointStore, identifiers
    repository.py        # PostgresRepository upserts + source-run lifecycle SQL
    run_log.py           # NDJSON source-run log + SourceRunRecorder
    gazetteer/           # catalog, aliases.yaml, geometry, resolver, places job
    cab/                 # Fall 2026 course meetings job (user-provided CSV)
    clubs/               # organizations + LiveWhale sidecar job (user-provided CSV)
    events/              # LiveWhale + registrar events bootstrap (user-provided CSVs)
    mappings/            # source-native vocabularies -> contract §4 taxonomy
    athletics_venues.py  # SIDEARM venue -> place sidecar job
    brown_owned_buildings.py  # Brown-owned buildings map-tint sidecar job
    dining/              # NOTES.md: documented discovery block (no job)
    seeds_manifest.py    # db/seeds/manifest.json publisher + validator
    cli.py               # `ingest run <job> --out ndjson|postgres`
  fixtures/
    recorded/            # captured through CachedHttpClient, hash-pinned
    user_provided/       # user-delivered CSVs (hash-pinned, kind user_provided):
                         #   Fall 2026 CAB export + the 2026-07-29 Codex pack
    manifest.json        # fixture integrity manifest (gates the suite)
  tests/                 # offline; `postgres`-marked tests need TEST_DATABASE_URL
```

```sh
uv sync            # install runtime + dev dependencies
uv run pytest -q   # offline suite
uv run ingest run all --out ndjson
```

## Running and rerunning jobs

`uv run ingest run <job> --out ndjson|postgres` where `<job>` is `places`,
`cab`, `clubs`, `athletics`, `buildings`, `events`, or `all`. The registry
also carries `dining` as a **declared blocked gap**: naming it exits 2 with
the documented reason (never a silent skip), and `run all` runs the
existing jobs in bundle order (places → cab → clubs → athletics →
buildings → events) after loudly reporting that gap. `events` runs after
`clubs` deliberately: its organization lookup reads the freshly published
`organization_livewhale_groups.json` sidecar.

- Exit 0: every invoked job published (or upserted).
- Exit 1: a gate failed closed (source run `partial`) or a job raised
  (`error`). Existing outputs are untouched.
- Exit 2: usage-level refusal — unknown or blocked job, unsupported output
  combination, missing `DATABASE_URL`, invalid `--contact`.

Jobs are rerunnable at will: outputs are staged under `reports/tmp/`,
validated, then atomically replace their destination file, so a rerun either
fully replaces an artifact or leaves the previous one intact. The CAB job
logs every discovered term `srcdb` loudly, pass or fail, and renders
`reports/cab_fall_2026_place_resolution.md` on every run.

`--contact you@brown.edu` (or `BROWNSYNC_CONTACT`) records the contact email
for the polite UA `BrownSync/1.0 (+<email>)`. The registered jobs run
offline from recorded evidence, so it is validated and echoed, not required.

## Cache and checkpoints

All live acquisition goes through `common/http.py::CachedHttpClient`: exact
UA above, at least one second between same-host requests, tenacity
retry/backoff on transient errors, and an on-disk cache keyed by request
fingerprint that stores only HTTP 200 responses (non-200 metadata is never
replayed). LiveWhale responses additionally carry a ten-minute freshness
gate. `common/checkpoint.py::CheckpointStore` gives long jobs fingerprinted
atomic checkpoints so an interrupted acquisition resumes equivalently.
The offline jobs on this branch read the hash-pinned fixtures instead; the
fixture integrity test rejects any silent synthetic substitution.

## Gates (all fail closed; nothing partial is published)

| Job | Gate | Threshold |
|---|---|---|
| places | validated rows | >= 120 |
| places | canonical dining places (`kind="dining"`) | Ratty, Andrews Commons, V-Dub, Blue Room, Ivy Room, Jo's |
| cab | distinct subjects | >= 50 |
| cab | meeting rows | >= 1,500 (revised from 2,000; see below) |
| cab | section-level place resolution | >= 90% |
| clubs | distinct validated organizations | >= 400 |
| clubs | unknown source vocabulary values | 0 (drift fails loudly) |
| athletics | home venues mapped / place ids known | every one (no threshold) |
| buildings | export rows / classification / operator conflicts / catalog drift | >= 2,000 / non-empty / 0 / 0 |
| events | non-canceled LiveWhale rows with coords | >= 300 (app handoff §4 DoD) |
| events | LiveWhale rows | >= 900 (0.9 × the 1,000-row pinned export) |
| events | registrar admin rows | >= 100 |
| events | unknown `online_type` values | 0 (drift fails loudly; unknown `event_types` are *reported* but categorized by poller fall-through — see below) |

**1,500-row revision (Task 6B, signed off):** the plan's 2,000-row gate was
calibrated for a live CAB scrape; the user-provided Fall 2026 export
physically schedules at most 1,828 rows (3,328 of 5,275 records are
arranged/TBA). The orchestrator's sign-off is recorded verbatim in
`reports/sdd/brownsync-ingestion/task-6b-brief.md`, the task 6B report, and
the `cab/job.py` docstring. The 90% resolution gate is unchanged.

## Seed bundle and manifest

`run all --out ndjson` replaces each artifact individually-atomically, then
publishes `db/seeds/manifest.json` **last** with a generation ID, UTC
timestamp, and SHA-256 + byte size per artifact (`places.ndjson`,
`course_meetings.ndjson`, `organizations.ndjson`,
`organization_livewhale_groups.json`, `athletics_venues.json`,
`brown_owned_buildings.json`, `events.ndjson`). The
validator rejects a
mixed set — any artifact whose on-disk hash disagrees with the manifest —
so an interrupted bundle run is detectable and the previous manifest stays
authoritative until a full rerun repairs every artifact. Single-job runs
never advance the manifest and say so. App-side manifest enforcement is a
declared blocking dependency (`reports/app_side_dependencies.md`).

## Source-run extension log

Every invoked job runs inside exactly one source-run lifecycle
(`run_log.py::SourceRunRecorder`), finalized `ok`, `partial` (gate reasons),
or `error` even when the job raises; `run all` records one lifecycle per
constituent job. In ndjson mode runs append to `db/seeds/source_runs.ndjson`
— the handoff's atomic append/merge extension log with monotonically
increasing integer IDs. It is *not* a seed artifact and stays outside the
manifest; it is not claimed as a contract §6 loader input until the
app-side loader accepts it. In postgres mode the lifecycle writes to the
`source_runs` table instead.

## Sidecars and their consumer dependency

`db/seeds/athletics_venues.json` (schema v1:
`{schema_version, generated_at, mappings: [{source_name, place_id}]}`) maps
SIDEARM venue strings to canonical place ids because contract v1 has no
database target for them. `db/seeds/organization_livewhale_groups.json`
(schema v1: `{schema_version, generated_at, mappings: [{organization_id,
livewhale_group, match_method, score}]}`) links organization slugs to
LiveWhale publisher-group names; the Task 7 measured outcome is an EMPTY
`mappings` list — the 218 recorded LiveWhale groups are departments and
offices, and no student group is a publisher, so the file existing with
`[]` is the explicit statement that no link is claimed. App-side
consumption of both sidecars is a blocking cross-workstream dependency in
`reports/app_side_dependencies.md`; ingestion does not claim the TS poller
consumes them until a consumer test passes in the app lane.
`db/seeds/brown_owned_buildings.json` (schema v1: ODbL attribution +
`osm_way_ids` + `place_ids`, enrichment round) tints Brown-owned OSM
footprints; its `buildings` CLI registration and manifest entry landed in
the events-bootstrap round, closing the register §5 follow-up.

## Events bootstrap and poller parity

`events` publishes `db/seeds/events.ndjson` from two hash-pinned
user-provided exports: `brown_upcoming_events.csv` (1,000 LiveWhale event
instances, 2026-07-29 → 2026-11-03, `source="livewhale"`) and
`brown_academic_calendar_2026_2027.csv` (registrar entries,
`source="registrar"`, `category="admin"`, weekday-validated year
derivation). This is a BOOTSTRAP snapshot: post-deploy the app lane's TS
poller (`services/poller/src/livewhale/`) refreshes live and upserts on
`(source, source_id)`, so the seed derivation is poller-IDENTICAL —
`source_id = "{id}:{epoch of start}"` (the feed's `date_ts`), the same
entity decoding, the same category tables (`mappings/categories.py`, a
verbatim port of the poller's `categories.ts` including its
fall-through-on-unknown behavior), and the same org-sidecar lookup
(measured truth: zero attributions). Ten sampled ids are pinned against
the poller's recorded-fixture derivation in
`tests/events/test_livewhale.py` — do not "fix" those pins without
re-deriving them from the poller. Ingestion-side extras that the poller
does not compute: `place_id` via the gazetteer resolver where coordinates
are absent (never for `online_type="Online only"` rows), and `raw`
carrying the CSV row minus the published-contact columns
(`contact`/`contact_emails` are dropped with counts — no contract field
consumes them).

## Blocked source: dining

`dining.brown.edu` answers a Pantheon-edge HTTP 403 to the declared UA;
bypassing bot detection is forbidden, so no discovery requests were sent.
Dining discovery is documented in `dining/NOTES.md` (contract v1 has no
dining-hours row, and the six fixed dining places are already seeded).
Unblock paths: an OIT allowlist for the declared UA, or user-exported
pages. (`studentactivities.brown.edu` answers the same 403; the clubs job
runs from the user-provided 2026-07-29 export instead of a scrape.)

## Postgres prerequisites

`--out postgres` requires the `DATABASE_URL` environment variable and is
fail-closed: absent credentials exit 2 and are reported, never treated as a
successful database verification. `run all --out postgres` is the
documented **hybrid**: contract rows (`places`, `course_meetings`,
`organizations`) and source runs upsert via psycopg 3 (WKT through
`ST_Multi(ST_GeomFromText(%s, 4326))`); the athletics and organization
sidecars and dining notes still publish as files, and the NDJSON manifest
is not advanced. Explicit `run athletics --out postgres` is rejected as
unsupported (its only artifact is a file); `run clubs --out postgres`
upserts the organization rows and still publishes the sidecar file.
`postgres`-marked integration tests (PostgreSQL 15 + PostGIS + pg_trgm) run
only when `TEST_DATABASE_URL` is set.

## Gazetteer data attribution

The campus gazetteer merges a curated catalog
(`brownsync_ingest/gazetteer/aliases.yaml`) with building footprints,
centroids, addresses, and element ids extracted from OpenStreetMap via the
Overpass API (recorded offline fixture:
`fixtures/recorded/overpass/college-hill-buildings.json`).

Building footprints and addresses are © OpenStreetMap contributors and are
licensed under the Open Database License (ODbL) 1.0 —
<https://www.openstreetmap.org/copyright>. Rows derived from OSM carry
`source="osm"` and an `osm_id` of the form `way/<id>` or `relation/<id>`;
the same attribution string is exposed programmatically as
`CatalogBuild.attribution`. Any redistribution of the generated
`places.ndjson` seed must preserve this attribution.

Curated-only entries (outdoor spaces, dining venues inside larger
buildings, and off-bbox athletic venues) carry `source="curated"` with
hand-maintained coordinates.
