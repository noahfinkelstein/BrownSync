# Drafts for owner sign-off — 2026-08-07

Two documents the launch checklist owes (§6 / gates G1 and G8). **Neither has
been sent.** Both are drafts for Noah to review, edit, and send personally.

---

## 1. BDH permission email (gate G1)

To: `herald@browndailyherald.com`
Subject: Permission request — headline links to Herald coverage on BrownSync

> Hi,
>
> I'm Noah Finkelstein, a Brown undergraduate building BrownSync
> (brownsync.pages.dev), a free campus map and events app for students.
>
> I'd like to include Herald coverage in the app's news feed as
> **headlines and links only**: article title, publication date, byline
> where available, and a link that sends readers to browndailyherald.com.
> No article text, no excerpts, no images — the app's database physically
> rejects body text for Herald entries, and every item carries "Brown Daily
> Herald" attribution with a click-through.
>
> I'm writing because the Herald's terms of service prohibit automated
> indexing, and I want to do this with your permission rather than around
> it. The app reads your public RSS feed roughly every 30 minutes with a
> declared user agent (BrownSync/1.0), honoring your robots.txt crawl-delay.
>
> Happy to answer questions, adjust the presentation, or remove Herald
> content entirely if you'd prefer. If there's a syndication or linking
> policy I should follow instead, point me to it.
>
> Thanks for considering it,
> Noah Finkelstein
> noah_finkelstein@brown.edu

Notes for Noah:
- The technical claims are true today: `articles.license`/BDH CHECK
  architecture (P1, migration 0004) rejects body text at the DB layer, and
  the poller stores `description: null` with a metadata-allowlisted `raw`.
- **Caveat:** migration 0004 (the purge of previously-stored bodies) is
  written and CI-proven but NOT yet applied to prod — see the migration
  decision in today's ops notes. Apply it before sending this email so the
  claim "no article text" is true in the live database, not just the code.
- Same SNworks install covers post- magazine; if they grant permission,
  ask whether it extends to post-.

---

## 2. Reddit API access application (gate G8)

Via Reddit's data API request form (support.reddithelp.com → "Request
access to the Reddit API" / data API contact form).

**Use case description (draft):**

> BrownSync (brownsync.pages.dev) is a free, non-commercial campus map and
> events app built by and for Brown University students. We request read-only
> API access to r/BrownU to display **post titles and permalinks only** in
> the app's campus feed — no post bodies, no comments, no user data. Each
> item links back to reddit.com and is attributed to the subreddit.
>
> - Expected volume: one listing request per ~30 minutes (new/hot posts of
>   a single subreddit), well under free-tier limits (<100 QPM OAuth).
> - No content is stored beyond title, permalink, timestamp, and score.
> - No training, no resale, no ads; the app is free and unmonetized.
> - Developer: Noah Finkelstein, noah_finkelstein@brown.edu.

Notes for Noah:
- Free tier is non-commercial only — if BrownSync ever monetizes, this
  flips to the commercial tier (recorded in the v2 plan's G8 row).
- Self-service OAuth registration closed late 2025; the contact-form route
  has multi-week lead time, which is why this is drafted now while the
  r/brownu producer ships disabled behind the registry kill switch.
