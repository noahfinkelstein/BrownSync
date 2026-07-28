# @brownsync/poller

Single responsibility: scheduled TS workers for *structured* feeds — LiveWhale JSON, athletics
ICS, BDH RSS — normalizing into the canonical `events` table per `DATA_CONTRACT.md` §2/§5.
Fixture-recorded tests; never hits Brown servers in CI. Python scrapers (CAB, clubs, OSM) are
the Codex workstream in `ingest/` — not here.
