# Instagram Post Scheduler

A private, single-user scheduling and content-organisation tool for one
photography business's Instagram account. Replaces Buffer/Later. Every service
it runs on is on a permanently free tier.

**It never generates, suggests, or autocompletes captions, hashtags, or any
other text using AI.** It is purely an organising and scheduling tool. That is a
deliberate product rule, not an omission.

## How the pieces fit together

| Piece | Runs on | Does what |
| --- | --- | --- |
| Dashboard | Cloudflare Workers | Everything you interact with |
| Database + photo storage | Supabase | Photos, posts, hashtags, schedule |
| Background jobs | GitHub Actions | Photo processing and publishing |

Photo processing lives in GitHub Actions rather than in the dashboard because
it needs [Sharp](https://sharp.pixelplumbing.com/), a compiled image library
that Cloudflare Workers cannot load. Every free-tier alternative that *does*
run on Workers strips ICC profiles instead of converting them — which is the
exact cause of the washed-out colours this app exists to avoid. The cost of the
split is that an uploaded photo shows as "Processing" for 30–60 seconds.

## Colour handling

Instagram displays at most 1440px wide and 8MB, so photos are stored already
optimised to that ceiling. True full-resolution masters stay in the
photographer's own catalogue; this media bank only holds what gets posted.

Each upload goes through **one** Sharp pass that reads the embedded ICC
profile, performs real gamut conversion into sRGB, resizes to 1440px, encodes
with mozjpeg at 4:4:4 chroma, and embeds the sRGB profile. Single pass matters:
every extra decode/encode cycle compounds loss.

Verified against libvips 8.17 / lcms 2.17 — sRGB (30,170,90) encodes to P3 as
(81,168,98) and converts back to exactly (30,170,90). Real colour maths, not a
relabel. A file that arrives with *no* profile is flagged in the UI rather than
silently assumed to be sRGB.

## Platform limits this design respects

- **Carousels max out at 10 images** via Meta's Content Publishing API, even
  though the Instagram app allows 20. No tool, free or paid, can exceed this.
- **Music cannot be attached** to photo or carousel posts through the API. Add
  it by hand in the Instagram app afterwards.
- **100 published posts per rolling 24 hours** is the real API ceiling. There is
  no artificial weekly or monthly cap in this app.
- Captions max out at **2,200 characters**, plain text only — no bold or italic.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Worker jobs are a separate project with their own dependencies:

```bash
cd worker && npm install
```

### Checks

```bash
npm run check
```

### Running it the way Cloudflare will

`npm run dev` is the fast loop, but it is not the real runtime. To exercise the
actual Worker build:

```bash
npm run cf:preview
```

**Stop `npm run dev` first.** `initOpenNextCloudflareForDev()` in
`next.config.ts` starts a `workerd` process to supply Cloudflare bindings
during development, and it holds a handle on `.open-next/`. With the dev server
running, a Cloudflare build fails with a bare `EPERM ... .open-next`, which
gives no hint that the dev server is the cause. Killing `workerd` alone does
not help — the dev server immediately spawns another.

## Deploying

Two of the four settings are needed at **build** time, because Next.js bakes
`NEXT_PUBLIC_*` values into the browser bundle. Set these as build environment
variables in the Cloudflare dashboard:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The other two are read at run time and are set as Worker secrets:

```bash
npx wrangler secret put ALLOWED_EMAIL
npx wrangler secret put APP_URL
```

Two more are optional. They let an upload start processing immediately rather
than waiting for the next 20-minute sweep — set `GITHUB_REPO` (as
`owner/repo`) and `GITHUB_DISPATCH_TOKEN`, a fine-grained token needing only
**Contents: read and write** on this one repository.

GitHub Actions needs its own two secrets, under Settings → Secrets and
variables → Actions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses all row-level security. Treat it like
  a password. It belongs here and nowhere else.

## Why the repo is public

GitHub gives public repositories unlimited free Actions minutes; private ones
get 2,000/month, and a 15-minute publishing cron alone costs about 2,880. No
credentials, tokens, or photos live in this repository — they are in GitHub
Secrets, Cloudflare secrets, and Supabase.

## Why the cron also keeps the database alive

Supabase pauses a free project after 7 days with no database activity. The
publishing job queries the database every 15 minutes and the media sweep every
20, so once this is deployed the project can never go idle long enough to be
paused — whether or not anyone opens the app.

Before deployment nothing touches the database between sessions, so it will
pause. Unpause it from the Supabase dashboard; no data is lost and nothing
needs re-running, though the API can take a few minutes to catch up afterwards.
`notify pgrst, 'reload schema'` hurries that along — until it runs, every table
reports as missing from the API while being perfectly present in the database.

## Two things to know about the scheduler

**GitHub's cron is best-effort.** Scheduled runs can be delayed under load. The
rolling queue is built for this: a post whose slot passes without publishing
rolls forward to the next open slot rather than sitting stale and backdated.

**Scheduled workflows are disabled after 60 days of no repository activity.**
If you stop committing for two months, GitHub will pause the cron and email
you.

## Deleting photos

Deleting moves a photo to the trash, where it can be put back. Files are only
removed when the trash is emptied by hand or by the 30-day sweep in
`process-media`, so a trashed photo keeps using storage until then.

A photo belonging to a scheduled or published post cannot be trashed or
deleted at all — enforced by database triggers, not by the UI, so no code path
can get around it.

## Database changes

Migrations live in `supabase/migrations/` and are applied in filename order.
Every one is idempotent, so re-running is safe and is how you repair a
half-applied schema.

```bash
DATABASE_URL="postgresql://..." npm run db:apply
```

The connection string is in Supabase under Settings -> Database -> Connection
string. Do NOT apply them by pasting into the SQL editor: a large paste can
silently truncate, leaving a partial schema that reports success.

After changing a migration, regenerate the types rather than editing them by
hand:

```bash
npm run types:db
```

## Layout

```
src/app/(app)/     signed-in dashboard
src/app/login/     magic-link sign-in
src/app/privacy/   public - required by Meta for API access
src/lib/           Supabase clients, timezone helpers, database types
worker/            GitHub Actions jobs (Sharp lives here)
supabase/          SQL migrations
```

## Build status

- **Phase 1 — foundations: done.** Database schema, auth, app shell, Cloudflare
  deploy path, worker scaffold, CI. Verified running on the Cloudflare runtime.
- **Phase 2 — media bank and the photo pipeline: done.** Direct-to-storage
  upload in overlapping batches, the colour-managed worker, filters, the
  profile warning, and a 30-day trash.
  `cd worker && npm run verify-pipeline` proves the colour maths.
- **Phase 3 — composer: mostly done.** Caption with a live counter that knows
  whether hashtags land in the caption or the first comment, photo picker with
  the 10-image carousel cap and reordering, the hashtag library, and the
  shuffle that replaced the spreadsheet. Still to do: tagging other accounts
  on a photo.
- Phase 4 — scheduling: slots, rolling queue, fixed posts
- Phase 5 — grid preview, ideas, notepad
- Phase 6 — publishing worker, token refresh, Meta connection

The app ships with **dry run on**. The whole thing — queue, worker, publishing
— runs end to end and logs exactly what it *would* post, without contacting
Instagram. Turn it off in Settings once the account is connected.
