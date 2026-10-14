# How the scheduler actually works

Written to be handed to someone — or something — that has never seen this
project. The build brief says what was wanted; this says what exists.

Where it disagrees with `docs/build-brief.md`, this is right: the brief named
Vercel, and the app runs on Cloudflare.

---

## What it is

A private Instagram scheduler for Wilderpines, a photography business,
replacing Later. One account, one user, every service on a permanently free
tier.

It exists because Later produced washed-out uploads. **Colour management is the
whole point** — see the rules in `AGENTS.md`, which are binding.

---

## Where each piece runs

Nothing runs on the owner's computer. A laptop being shut is not an outage.

| Piece | Runs on | What it does |
|---|---|---|
| The website | Cloudflare Workers | Everything you look at: media, posts, ideas, settings |
| Photo processing | GitHub Actions | Resize and colour-convert uploads. Sharp cannot run on Workers |
| Publishing | GitHub Actions | Sends due posts to Instagram |
| Token refresh | GitHub Actions | Keeps the Instagram connection alive (~60-day token) |
| The clock | Cloudflare Workers | Every minute: is anything due? Wakes the publisher. Raises alerts |
| Deploying | GitHub Actions | Every push to `main` builds, deploys and checks the live site |
| Data and photos | Supabase | Postgres + Storage |

---

## How a post gets published

1. Photos are uploaded in **Media**. They are cropped to 4:5 and converted to
   sRGB by the worker in GitHub Actions, in **one Sharp pass** — resize and
   colour convert together, because each extra encode compounds loss.
2. A post is written in the composer: when, photos, caption, hashtags.
3. **When** is one of three things:
   - **Add to queue** — takes the next free weekly slot
   - **Schedule** — pinned to an exact instant; the queue works around it
   - **Save as draft** — holds its place in the grid, never publishes
4. The **clock** notices the slot has arrived, within a minute, and wakes the
   publisher.
5. The publisher claims the post, builds the carousel, sends it to Instagram,
   and posts the hashtags as the first comment if that is the chosen placement.

Weekly slots live in Settings. They are stored as (weekday, local time), not as
instants, so a 10am slot stays 10am across daylight saving.

All wall-clock scheduling is `America/Los_Angeles`. Store UTC, render Pacific,
and keep the conversion in `src/lib/time.ts`.

---

## The parts that are easy to get wrong

**A queued post has no stored date.** Its date is worked out fresh from "the
next free slot", every time anything displays it. That is why a missed post
silently becomes next week's plan — there is no "this was late" marker for
queued posts, only for pinned ones.

**Readiness, not status, decides whether a post publishes.** A post can be
`scheduled` with a pinned time and still never go out if `ready` is false. The
publisher checks readiness first, and so must anything that displays state.

**Dates belong to positions, not to posts.** Dragging the grid swaps which post
lands on which date.

**The grid reads newest-first** (like an Instagram profile); **the queue reads
next-first**. Dragging reverses before it saves. Getting that backwards turns
the schedule upside down.

**One shared function decides what is due** — `dueQueued` in `src/lib/queue.ts`,
used by the publisher *and* the clock, imported rather than copied, so they can
never disagree. It looks back six hours: a slot missed by a slow run still gets
filled; one missed by longer rolls forward rather than publishing at an hour
nobody chose.

---

## When something goes wrong

**The watchdog tells you.** The clock runs outside both the database and
GitHub, so it can report either being broken. It opens a GitHub issue, which
emails, and closes it again when things recover.

- **"The database is not answering"** — three minutes of failure. Fix:
  supabase.com/dashboard → project → Settings → General → **Restart project**.
  This has happened once, for two and a half days, and a restart cleared it.
  Queued posts are not lost; each rolls forward to the next free slot.
- **"A post is overdue"** — a finished post has been due for twenty minutes.
  Look at the repository's Actions tab, newest "Publish due posts" run; the
  reason is in its log.

An open alert always means something is wrong **now**.

---

## Checking it yourself

```bash
npm run smoke     # open every page of the live site as the owner
npm run cpu       # what the app really costs Cloudflare, and what failed
npm run cpu -- --week
```

`npm run cpu` is the honest one. Wall-clock timings say nothing useful —
Cloudflare bills processing time, not waiting. When something is slow or
failing, ask it rather than guessing.

Tests worth knowing (`npm run verify:*`): `queue` (slots, daylight saving,
what is due), `shape` (carousel aspect ratios), `shuffle` (hashtag draws),
`watchdog` (when to alert), `typography`, `retry`, `new-post`, `refresh`.

---

## Rules that are not up for renegotiation

They are in `AGENTS.md` in full. The short version:

- **No AI-generated content, ever.** No captions, hashtags, alt text — not even
  an off-by-default toggle. The hashtag shuffle draws at random from the
  owner's own curated library; nothing is invented.
- **Colour management is the point.** One Sharp pass, a real ICC gamut
  conversion, sRGB embedded, missing profiles flagged rather than assumed.
- **Platform limits are not bugs.** Carousels cap at 10. Music cannot be
  attached by any API. Location tagging needs a deprecated endpoint.
  Collaborators are not exposed. Don't try to "fix" these.
- **Everything stays on a free tier.**

---

## Account and connection

Instagram **@wilderpines.co**, a **Creator** account linked to a Facebook Page.
The app reaches it through that Page (Facebook Login). Keep the Page link: it
is how the account is found.

Creator rather than Business was chosen for music-library access **in the
Instagram app**. It changes nothing here — no API can attach music to a
scheduled post, so a post that needs a song has to be published by hand.

---

## Where secrets live

Never in the repository. The repo is public and has been checked, commit by
commit, for leaks — there are none.

- **The live app**: Cloudflare Worker secrets
- **The clock**: Cloudflare Worker secrets, plus a KV namespace for remembering
  an incident — deliberately outside the database, since surviving the database
  is the point
- **GitHub Actions**: repository secrets
- **A developer's machine**: `.env.local`, gitignored

---

## Known loose ends

- `docs/build-brief.md` describes Vercel and a few other things that changed.
- Alt text can still be stored and is published, but there is no longer a way
  to type it in — removed at the owner's request.
- The database password and Supabase service key have been pasted into
  conversations over time. Nothing has leaked, but rotating them is good
  hygiene and has not been done.
