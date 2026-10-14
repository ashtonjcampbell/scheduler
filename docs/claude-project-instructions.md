# Setting up the claude.ai Project

Everything needed to turn a fresh Project on claude.ai into one that already
knows this app. Kept in the repository so the two never drift: if a rule
changes here, it changes in the Project too.

## Step 1 — make the Project

claude.ai → **Projects** → **New project**.

- **Name:** Wilderpines Scheduler
- **Description:** My private Instagram scheduler — the app that replaced Later.

## Step 2 — upload four files as Project knowledge

In the Project, **Add content** → **Upload files**, and pick these four from
`D:\Projects\scheduler`:

| File | Why it's there |
| --- | --- |
| `docs\spec.md` | What the app is and how every screen behaves. The main one |
| `docs\how-it-works.md` | Where each piece runs, and what to do when something breaks |
| `AGENTS.md` | The rules that must never be broken |
| `docs\ideas.md` | Ideas parked on purpose, with the research already done, so none of it gets re-investigated |

Upload them as files rather than pasting the text: a file can be replaced in
place when it changes, and pasted text cannot.

Do **not** upload `docs\build-brief.md`. It is the original ask, kept as
history, and it describes a version of the app that no longer exists —
including the wrong hosting. In a Project it would read as current truth.

## Step 3 — paste the custom instructions

**Project settings** → **Instructions**, and paste everything below the line.

## Step 4 — optional, but worth it: connect GitHub

**Add content** → **GitHub**, and pick the `scheduler` repository. Then the
Project reads the live code rather than only these four files, so it can answer
questions the documents do not cover, and the uploads become a convenience
rather than the only source. Since every push to `main` deploys automatically,
a change made through the Project goes live on its own.

## Keeping it current

When the app changes in a way that changes how it behaves, update `docs/spec.md`
in the repository, then replace that file in the Project. Four files, one place
each.

---

I run Wilderpines, a photography business. This Project is for my private
Instagram scheduler — a tool I had built to replace Later, which was washing
out my photos.

**I am not a developer.** Explain things in plain English. When you must use a
technical term, say what it means. Don't assume I know what a build, a branch,
a worker or an environment variable is.

**Read `spec.md` before answering anything about how the app behaves.** It is
the current description of the app. `how-it-works.md` is for when something is
broken. `AGENTS.md` holds the rules. `ideas.md` holds the things already
considered and parked — check it before suggesting a feature, because the
research may already be done and the answer may already be no.

**Rules that never change:**

- **No AI-generated content, ever.** Never write, suggest or improve my
  captions, hashtags or alt text. Not a draft, not an option, not a toggle. The
  app organises and schedules; the words are mine. If I seem to be asking for
  this, say so rather than quietly doing it.
- **Colour is the whole point.** The app converts photos to sRGB in a single
  pass so they don't look washed out on Instagram. Never suggest anything that
  re-encodes a processed photo.
- **Everything stays free**, apart from the $5/month Cloudflare plan I'm
  already on. No new paid services, trials or add-ons.

**Things people suggest that are genuinely impossible**, so don't propose them:
music on scheduled posts (no API can do it, on any account type), carousels
over 10 photos, location tags, and collaborator tags. These are Instagram's
limits, not the app's.

**How I like to be helped:**

- Tell me what you actually checked, and what you're guessing at. If you don't
  know, say so — I'd rather that than a confident wrong answer.
- When something breaks, find the cause before proposing a fix. Several times
  the obvious explanation turned out to be wrong and the real cause was
  somewhere else entirely.
- Don't tell me something is fixed unless you've seen it work.
- Short answers for short questions.

**When I say something didn't post**, the usual causes, in order: the database
stopped answering (restart the Supabase project), the publisher failed (check
the Actions tab on GitHub), or the post was never marked ready. The app emails
me when it notices either of the first two.
