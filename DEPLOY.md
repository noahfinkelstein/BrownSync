# BrownSync — Deploy Runbook

Everything below is scaffolded and merged; no step here writes code. This is
the exact remaining sequence, in order. Nothing deploys or writes to prod
until you perform these steps — every workflow is gated on the secrets you
set in step 2 and no-ops (green, with a warning) before then.

**Topology**

| Piece | Where | Config |
|---|---|---|
| Database | Supabase Postgres, project `hkrxahzdqqxxovvilalm` ([dashboard](https://supabase.com/dashboard/project/hkrxahzdqqxxovvilalm)) | `supabase/` (already linked locally) |
| API | Cloudflare Worker `brownsync-api` + Hyperdrive → Supabase | `apps/api/wrangler.toml`, entry `apps/api/src/worker.ts` |
| Web | Cloudflare Pages project `brownsync` | `.github/workflows/deploy.yml` |
| Pollers | GitHub Actions cron | `.github/workflows/poll.yml` |
| Seed load | GitHub Actions, on demand | `.github/workflows/seed-load.yml` |

**Connection strings — read this first.** Use the **Session pooler** URI from
the dashboard (Connect button → "Session pooler", port `5432`), shaped like
`postgresql://postgres.hkrxahzdqqxxovvilalm:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
Why: GitHub Actions runners are IPv4-only and Supabase's direct
`db.<ref>.supabase.co` host is IPv6-only (without the IPv4 add-on), so the
direct string fails from Actions. Session mode (5432) also supports prepared
statements, which postgres.js uses; do **not** use the transaction pooler
(port `6543`). The same session-pooler URI works for Hyperdrive in step 4.

---

## 1. Push the schema

The project is already linked (`supabase/.temp` exists). From the repo root:

```sh
supabase db push
```

Enter the database password when prompted (reset it in the
[dashboard](https://supabase.com/dashboard/project/hkrxahzdqqxxovvilalm) under
Settings → Database if lost). This applies `supabase/migrations/` (mirrors
`db/migrations/`: schema + read-API views).

Verify: dashboard → Table Editor shows `places`, `organizations`, `events`,
`course_meetings`, `source_runs`.

## 2. Set GitHub secrets and variables

Cloudflare prerequisites (dashboard → cloudflare.com):

- **Account ID**: dashboard home, right sidebar.
- **API token**: My Profile → API Tokens → Create Token, custom with
  permissions **Workers Scripts: Edit**, **Cloudflare Pages: Edit**,
  **Hyperdrive: Edit** on your account.

Then, from the repo root (`gh` is already authenticated):

```sh
# Secrets — paste values at the prompt, they never touch the shell history.
gh secret set DATABASE_URL          # session-pooler URI from the box above
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID

# Variables (plain, non-secret build inputs).
gh variable set VITE_API_ORIGIN --body "https://brownsync-api.<your-workers-subdomain>.workers.dev"
gh variable set VITE_CANONICAL_ORIGIN --body "https://brownsync.pages.dev"

# Optional:
# gh variable set CLOUDFLARE_PAGES_PROJECT --body "brownsync"   # defaults to brownsync
# gh variable set VITE_PMTILES_URL --body "https://<r2-public-host>/providence.pmtiles"
# gh secret  set VITE_POSTHOG_KEY
# gh variable set VITE_POSTHOG_HOST --body "https://us.i.posthog.com"
```

You can set `VITE_API_ORIGIN` now with a guess and correct it after step 4
prints the real Worker URL — Pages just needs a rebuild (step 5) to pick it up.

## 3. Load the seeds

```sh
gh workflow run seed-load.yml -f confirm=load
gh run watch
```

Upserts `db/seeds/` (166 places, 1,755 course meetings, athletics sidecar)
into prod and runs the seed QA check. Idempotent — safe to re-run whenever
seeds change.

## 4. Deploy the API worker (one-time Hyperdrive, then deploy)

Cloudflare is not authenticated locally yet, so first:

```sh
cd apps/api
npx wrangler login          # or: export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...

# One-time: create the Hyperdrive pointing at Supabase (session-pooler URI).
npx wrangler hyperdrive create brownsync-db \
  --connection-string="postgresql://postgres.hkrxahzdqqxxovvilalm:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Paste the returned `id` over the placeholder in `apps/api/wrangler.toml`
(`[[hyperdrive]] id = "…"`, currently all zeros), commit that change, then:

```sh
npx wrangler deploy
curl https://brownsync-api.<your-workers-subdomain>.workers.dev/api/health
```

If the printed Worker URL differs from what you set in step 2, update
`VITE_API_ORIGIN` now (`gh variable set VITE_API_ORIGIN --body "…"`).

### Account-deletion secret and smoke prerequisite

The authenticated account-deletion route fails closed with sanitized `503`
until its server-only Supabase service-role secret is provisioned. From
`apps/api`, set it through Wrangler's prompt, then redeploy:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

Never place or print the secret value in configuration, logs, commands, or
documentation. After deployment, smoke the route only with a disposable Brown
Google test account:

- [ ] Do not rely on token refresh or a newly issued JWT `iat`: current
      Supabase Auth source persists session AMR across refresh and does not
      advance the OAuth authentication timestamp.
- [ ] Sign in and complete a fresh Google OAuth authentication.
- [ ] Call `DELETE /api/account` with that account's bearer token and confirm
      an empty `204`.
- [ ] Confirm the disposable Auth user and its dependent application records
      are gone.

The AMR behavior above is verified from the official Supabase JWT
documentation and `supabase/auth` commit `163ab6f`, but hosted smoke remains
required to verify the deployed project's actual claims and configuration.
Deletion does not instantly invalidate an already-issued JWT; it can remain
cryptographically valid until expiry. Every future protected mutation must
also require a surviving account/profile record (or an equivalent
account-existence gate), not only a valid signature.

### Native board launch gate

The Brown-only pseudonymous board is deliberately unavailable while
`BOARD_ENABLED` is anything other than the exact string `true`. Do not flip
that infrastructure gate until all of these are complete:

- [ ] Migration `0015_board.sql` and its semantic/race checks passed on the
      exact release revision.
- [ ] An initial verified owner was inserted into `board_moderators` through
      the owner database connection. There is intentionally no public
      self-bootstrap route.
- [ ] A dedicated Cloudflare `BOARD_WRITE_LIMITER` binding exists at
      **30 writes/minute**. Add it to `wrangler.toml` with a real, unused
      namespace ID supplied by the Cloudflare account; do not copy or invent
      one from another binding.
- [ ] `BOARD_AUTHOR_PEPPER` was provisioned with
      `npx wrangler secret put BOARD_AUTHOR_PEPPER` using canonical unpadded
      base64url for at least 32 random bytes. Never print, log, commit, or send
      that value to PostgreSQL.
- [ ] Authenticated feed, write-limit, moderation, kill-switch, and disposable
      account-deletion smoke tests passed.

Only then change checked-in `BOARD_ENABLED` to `"true"` and deploy. That flip
is **sticky**: after the first true deployment, never set it false — the flag
gates every board route closed again. Account deletion is protected either
way: since migration `0019` board cleanup keys on the provisioned
`BOARD_AUTHOR_PEPPER` secret, not this flag, so a reverted flag can no longer
skip required board cleanup during account deletion. Use
`board_control.enabled` through the owner API as the operational kill switch.
The database switch blocks ordinary reads/writes while still allowing status,
appeals, authored deletion, and account cleanup.

Once launched, malformed/missing board identity configuration, a missing
database cleanup routine, or cleanup failure returns a sanitized `503` and
prevents Supabase Auth Admin deletion. Retrying is safe: the database keeps a
token-only deletion fence and Auth Admin `404` remains idempotent success.

The owner set can never be emptied (migration `0019`): deleting the last
`board_moderators` owner row is blocked at the database, and a sole owner's
`DELETE /api/account` returns `409 board_owner_transfer_required` until a
second owner is granted. To recover an ownerless pre-0019 state, insert a new
owner row through the owner database connection.

Local sanity checks that need no Cloudflare auth:
`pnpm --filter @brownsync/api build:worker` (bundle dry-run) and
`pnpm --filter @brownsync/api dev:worker` (runs against local supabase).

`apps/api/wrangler.toml` provisions three fail-closed native rate-limit
bindings: public reads (`120/min` by IP), authenticated writes (`20/min` by
user), and protected organization reads (`60/min` by user). Keep all three
bindings when cloning or replacing the Worker configuration. After the board
launch checklist, keep its separate `30/min` binding as well.

## 5. Deploy the web app (Pages)

Create the Pages project once, then let CI own deploys:

```sh
npx wrangler pages project create brownsync --production-branch=main
gh workflow run deploy.yml     # or just push to main
gh run watch
```

`deploy.yml` builds `apps/web` with the step-2 variables and uploads
`apps/web/dist` via wrangler-action. It runs on every push to main and skips
itself (loud warning, green) when the Cloudflare secrets are absent.

**Dashboard alternative** (instead of the CLI + CI path): Cloudflare
dashboard → Workers & Pages → Create → Pages → connect the GitHub repo; build
command `pnpm turbo run build --filter=@brownsync/web...`, output directory
`apps/web/dist`, and set `VITE_API_URL` / `VITE_CANONICAL_ORIGIN` env vars in
the Pages project settings. If you go this route, Cloudflare builds on push —
leave `deploy.yml` ungated by simply not setting the Cloudflare secrets, or
delete it to avoid double deploys.

## 6. CORS: allow the web origin on the API

Uncomment `CORS_ORIGINS` in `apps/api/wrangler.toml` `[vars]` with the real
web origin (Pages URL or custom domain), then `npx wrangler deploy` again:

```toml
CORS_ORIGINS = "https://brownsync.pages.dev"
```

## 7. Flip the pollers live

The cron is already committed in `poll.yml` (livewhale every 15 min,
athletics + bdh hourly) — it went "live" the moment `DATABASE_URL` was set in
step 2; before that every scheduled run no-ops green. Kick one off now instead
of waiting for the next tick:

```sh
gh workflow run poll.yml -f source=all
gh run watch
```

Note: GitHub disables cron on repos with 60 days of no activity — a routine
push re-enables it.

## 8. Post-deploy smoke checklist

With `API=https://brownsync-api.<subdomain>.workers.dev` and the web origin open:

- [ ] `curl $API/api/health` → 200, each source (`livewhale`, `athletics_ics`, `bdh`) with a recent `lastOkAt` after step 7
- [ ] `curl "$API/api/now"` → 200, non-empty `events` (term-time daytime: non-empty `meetings`)
- [ ] `curl "$API/api/meetings?at=2026-09-16T14:30:00Z"` → Fall-term Wednesday 10:30 ET, meetings render with `placeId`s
- [ ] Web loads: dark 2.5D map, 3D buildings, event pins with category colors
- [ ] Header health dot green; status strip shows per-source freshness ("LiveWhale ✓ N min ago")
- [ ] Click a pin → detail panel with source badge + working "open source ↗" link
- [ ] ⌘K search finds a building ("Salomon") and an org; place page lists meetings
- [ ] Time scrubber to a weekday class hour → buildings gain class-activity fill
- [ ] Browser console: no CORS errors (else revisit step 6)

## Rollback / notes

- **Worker**: `cd apps/api && npx wrangler rollback` (or redeploy a known-good commit).
- **Pages**: dashboard → the project → Deployments → "Rollback to this deployment".
- **Seeds/pollers**: all writes are upserts keyed on stable ids — re-running
  is safe; nothing hard-deletes (contract §2).
- **Secrets hygiene**: the DB password lives only in the two places set above
  (GitHub secret, Hyperdrive origin config) — never in the repo.
