# Codex — Lane C addendum: org & event CRUD, claims, and photos

**Date:** 2026-07-29
**Extends:** `handoffs/CODEX_LANE_C_SOCIAL_IOS.md` (unchanged; this adds the
product owner's new requirements)
**Depends on:** your auth work already in the tree (`apps/api/src/auth.ts`)

---

## What the product owner asked for, in their words

> "make a directory for all student organizations that allows people to create
> an organization if it doesn't already exist, as well as modify the info for
> organizations that belong to them and the same stuff with events … make sure
> clubs have links to their instagram, discord, or other stuff and club leaders
> can add links … allow orgs to have profile pictures and other photos added"

The **read** side of this is being built now and is not yours:

| Piece | Owner | State |
|---|---|---|
| `/clubs` directory (browse, search, filter) | Claude Code | in flight |
| `/events` directory + calendar export | Claude Code | in flight |
| Org social-link parsing + normalisation (`ingest/.../clubs/links.py`) | Claude Code | in flight |
| Light Brown-palette design system | Claude Code | **landed** |

**Yours is everything that requires knowing who the user is.** Nothing below
can be built without accounts, and accounts are Lane C.

---

## 1. The ownership model

Three tables, migrations `0010`–`0019` (your allocated range).

```sql
-- Who may edit which org. One row per (org, user).
create table org_admins (
  organization_id text not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner','editor')),
  granted_by      uuid references auth.users(id),
  granted_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- A request to become an admin of an existing org.
create table org_claims (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  evidence        text,
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
```

### The claim shortcut you already have data for

`db/seeds/organizations.ndjson` is built from a source CSV that carries
`contact_emails`. **If the authenticated user's `@brown.edu` address appears in
that org's `contact_emails`, grant `owner` instantly** — no human review. That
is the difference between a directory 457 clubs have to be talked into
adopting and one where the right person just signs in and it works.

Everything else goes to `org_claims` for review.

`contact_emails` is currently **dropped** by contract v1 (the events producer
logs `dropped published-contact columns: {'contact': 651, 'contact_emails':
552}`). You need it preserved on `organizations`. It is published contact
information for a recognised student group, but treat it as PII: store it, do
**not** expose it on `/api/orgs`.

---

## 2. Edits must be layered over seeds, never overwrite them

This is the design decision that matters most, and the one easiest to get
wrong.

The 457 orgs are **re-seeded from source on every `ingest run all`.** If a club
president edits their description in the app and you write it into
`organizations`, the next ingest silently reverts it. That will happen within a
week and it will destroy trust in the product.

So: keep the ingested row immutable and put user edits in a sibling table that
**overlays** it at read time.

```sql
create table org_edits (
  organization_id text primary key references organizations(id) on delete cascade,
  description     text,
  links           jsonb,     -- [{platform, url, label}]
  avatar_url      text,
  banner_url      text,
  updated_by      uuid not null references auth.users(id),
  updated_at      timestamptz not null default now()
);
```

`/api/orgs/:id` returns `coalesce(edit.field, seed.field)` field by field, and
the response says which fields were overridden so the UI can show "edited by
the club" vs "from Brown Student Activities". Same pattern the poller already
uses for place resolution:
`coalesce(excluded.place_id, resolved.place_id, events.place_id)`.

**Write a test that runs `ingest run clubs` after an edit and asserts the edit
survives.** That is the regression that will otherwise bite.

---

## 3. Student-created events

```sql
create table user_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id text references organizations(id),
  created_by      uuid not null references auth.users(id),
  title           text not null,
  description     text,
  start_ts        timestamptz not null,
  end_ts          timestamptz,
  place_id        text references places(id),
  category        text not null references … ,
  url             text,
  status          text not null default 'published'
                    check (status in ('draft','published','canceled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

- A user may create an event **for an org they administer**, or a personal one
  with `organization_id is null`.
- These must merge into the same read surface as LiveWhale events — the feed,
  the map and `/events` should not care where an event came from, beyond a
  "posted by a student" badge. `EventOut.source` already exists; add
  `'brownsync'` as a value.
- **`place_id` must resolve to a real place**, because the map draws it. Reuse
  the SQL `resolve_place()` from migration `0007` rather than free-texting a
  location.

### Rate limits and abuse

Anyone with a `@brown.edu` address can post. Before this ships publicly:
cap events per user per day, require an org affiliation or a verified email
age, and give yourself a soft-delete + an admin kill switch. A single bad
actor posting 500 events is a five-minute problem to cause and a long problem
to clean up.

---

## 4. Photos

The owner asked for org profile pictures "seeded with those you can find
online". **Do not bulk-scrape club logos.** A club's Instagram avatar is not
ours to redistribute, and the failure mode is a copyright complaint against a
student project. Instead:

1. **Upload** — Supabase Storage bucket `org-media`, RLS so only that org's
   admins may write to `org/<organization_id>/*`. This is the primary path and
   the one that scales.
2. **oEmbed** — where a club has supplied an Instagram permalink, use the
   official oEmbed endpoint (gate G7 already allows exactly this).
3. **Seed only from Brown's own directory** — `studentactivities.brown.edu`
   group pages, where Brown is the publisher. Attribute the source.

Validate on upload: MIME sniff (do not trust `Content-Type`), max dimensions,
strip EXIF (it carries GPS), and re-encode rather than storing the original
bytes. An SVG avatar is a stored-XSS vector — either reject SVG or serve media
from a separate origin.

---

## 5. RLS — the part with teeth

Migration `0010` should turn RLS **on** for every user table in the same
migration that creates it. The existing plan already calls for
`is_brown_member()` and a trigger on `auth.users` refusing non-`@brown.edu`.

Policies:

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `org_admins` | members of that org | — (server only) | — | owner of that org |
| `org_claims` | own rows | own, `status='pending'` only | — | own pending |
| `org_edits` | anyone | org admin | org admin | org admin |
| `user_events` | anyone where `status='published'`; own drafts | authenticated | creator or org admin | creator or org admin |

**The test that matters is the negative one.** Assert as a *non*-admin that an
`update` on someone else's `org_edits` affects **zero rows** — not that it
throws. A policy that silently filters to zero rows looks identical to success
from the client, and that is how people ship an open door.

`db/checks/0010_*.sql` must be rollback-safe like its predecessors.

---

## 6. Where to plug into the front end

I own `apps/web/src/router.tsx` and will wire routes. Export components; do not
edit the router.

- `/clubs` and `/events` directories exist (read-only). Add
  `/clubs/new`, `/o/$id/edit`, `/events/new`, `/e/$id/edit`.
- The org page is `apps/web/src/pages/OrgPage.tsx`.
- Design system: **light theme on Brown's palette, landed.** Read
  `packages/contract/src/tokens.ts`. `bg-bg-base` is white, `bg-brand-brown` is
  Seal Brown `#4E3629`, `text-accent` is Brown red `#C00404` and is reserved
  for live/now + primary actions.
- **Only type sizes 12/14/16/19/24/30 exist.** An off-scale `text-13`
  generates *no CSS at all* (Tailwind's stock ramp is deleted with
  `--text-*: initial`) and silently inherits the body size.
  `apps/web/test/type-scale.test.ts` scans source and will fail you.
- `--text-faint` is below AA and is **banned for text**; a source scan in
  `a11y-contrast.test.ts` enforces it.
- `Tokens.swift` codegen: `tokens.type` now carries `body` and `lineHeights`,
  and `tokens.brand` is new. Rebase `scripts/gen-swift-tokens.mjs`.

---

## 7. Two traps from this session, so you do not repeat them

- **`eventsLayer.isEventLive` is misnamed.** It means `start <= cursor + 2 h
  lookahead` — "should the map draw this" — not "is it happening". Anything
  that means *in progress* must compute it directly. See
  `apps/web/src/panels/nowSummary.ts`, which documents the trap.
- **`setFeatureState` throws** "Style is not done loading" if the style has not
  settled; it is not a silent no-op. react-map-gl materialises its `MapRef`
  well before `style.load`, so any effect touching feature state must guard on
  `map.isStyleLoaded()` and re-run on `idle`. This took the whole map down
  through the error boundary once already.

---

## Definition of done

- Migrations `0010`+ with RLS on from birth, and rollback-safe `db/checks/`.
- A club president with a `@brown.edu` address in `contact_emails` can sign in,
  land on their org, edit description + links, upload an avatar, and post an
  event — and **an `ingest run all` afterwards does not revert any of it.**
- Negative RLS tests assert zero-rows, not exceptions.
- No bulk-scraped photos.
