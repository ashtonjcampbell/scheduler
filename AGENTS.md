<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project rules

## Absolute rule: no AI-generated content

This app must never generate, suggest, autocomplete, or draft captions,
hashtags, alt text, or any other user-facing copy using AI — not even as an
optional, off-by-default toggle. It is purely an organising and scheduling
tool. Do not propose such features.

## Colour management is the point

The whole reason this app exists is that Later produced washed-out uploads.
Any change touching the image pipeline must preserve:

- one single Sharp pass (resize + colour convert together — each extra
  encode compounds loss)
- a real ICC gamut conversion via `withIccProfile("srgb")`, never a
  strip-and-relabel
- the sRGB profile embedded in the output
- missing-profile uploads flagged, never silently assumed to be sRGB
- previews generated from the actual processed file, not a browser thumbnail

Do not add `next/image` optimisation to processed photos: they are already
exactly the file we intend to deliver, and re-encoding would undo the work.

## Platform limits — do not "fix" these

- Carousels: 10 images max (Meta API limit, not ours)
- Captions: 2,200 characters, plain text only
- Music: cannot be attached via the API at all
- No artificial post-count caps; the real ceiling is 100 per rolling 24h
- **Location tagging**: not achievable. Publishing takes a `location_id`, but
  that is a Facebook Page id and the only way to find one is the Place Search
  API, which Meta deprecated for third parties in v8.0 — verified, it returns
  "deprecated for third parties effective v8.0". `pages/search` is the other
  route and needs Page Public Content Access, a reviewed feature;
  `pages_read_engagement` is NOT enough despite the error message saying so, as
  it only covers Pages you administer (verified against this app's own token,
  which has it). Do not re-attempt without that feature being granted.
- **Collaborators / co-authors**: not exposed. `coauthor_producers` is not a
  readable field on IG media and there is no publishing parameter for it.
- Tagging accounts IN a photo *is* supported, and is built — see `photo_tags`
  and the tag editor. Not the same feature as collaborators.

## Architecture constraints

- Everything must stay on a permanently free tier. No trials, no paid add-ons.
- Sharp cannot run on Cloudflare Workers. Image processing belongs in
  `worker/`, which runs in GitHub Actions.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It belongs in
  `worker/` and in strictly server-side app code — the OAuth routes and the
  settings page need it, because `app_secrets` has no read policy and that is
  exactly what keeps Instagram tokens out of the browser. Reach it only via
  `src/lib/supabase/admin.ts`, which imports `server-only` so a client
  component importing it is a BUILD error rather than a leak found later.
  Never return a token from a server component or action.
- All wall-clock scheduling is `America/Los_Angeles`. Store UTC, render Pacific,
  and keep the conversion in `src/lib/time.ts`.
- Weekly slots are stored as (weekday, local_time), not as instants, so a 10am
  slot stays 10am across daylight-saving changes.

## Gotchas already hit

- Supabase row types must be `type` aliases, not `interface`. An interface has
  no implicit index signature, so it fails the `Record<string, unknown>`
  constraint and every query silently resolves to `never`.
- Next 16 renamed the `middleware` convention to `proxy` (`src/proxy.ts`,
  exporting `proxy`).
- `npm run typecheck` runs `next typegen` first — Next generates the global
  route types that `tsc` needs.

## Deletion is soft

Photos are trashed (`deleted_at`), not destroyed. Files are removed only on
"Delete forever", "Empty trash", or the 30-day sweep in `process-media`.

Any new query over `photos` must filter `deleted_at is null`, or trashed
photos leak back into counts and pickers. `photo_usage` already excludes them.

The retention window is duplicated in `worker/src/process-media.ts` and
`src/app/(app)/media/actions.ts` — the second is what the UI promises the
user. Change both together.
