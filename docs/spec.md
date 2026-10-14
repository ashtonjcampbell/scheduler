# Specification

What this app is and how it behaves, as built. One document, kept current.

Companions, and what each is for:

- **`AGENTS.md`** — the rules that are not up for renegotiation. Binding.
- **`docs/how-it-works.md`** — where each piece runs, and what to do when
  something breaks. For the person on the end of an alert.
- **`README.md`** — setting it up on a machine.
- **`docs/build-brief.md`** — the original ask, kept as history. It describes a
  version that no longer exists; where it disagrees with this, this is right.

---

## 1. What it is

A private Instagram scheduler for Wilderpines, an elopement photography
business. One Instagram account, one person using it, every service on a free
tier or close to it.

It replaced Later, which washed out uploaded photos. **Colour handling is the
reason it exists**, not a feature of it.

It is an organising and scheduling tool. **It never writes anything.** No
captions, no hashtags, no alt text, not as a suggestion or an option. The
hashtag shuffle draws at random from a library the owner wrote themselves.

---

## 2. The screens

Four in the sidebar: **Media**, **Posts**, **Ideas**, **Settings**. The hashtag
library sits inside Settings — set up once, then left alone.

### Media

The photo bank. Upload by dropping files; they are processed in the background
(§5) and appear when ready.

Filters: **All**, **Available** (the default — nothing already spoken for),
**In drafts**, **Used**, **Needs a look**, **Trash**. Shown a page at a time,
two to four across depending on the width of the window, every thumbnail in 4:5
— the shape Instagram will use, so the library never disagrees with the grid
about what a photo looks like.

Each photo offers only what you do with it: **crop**, **move to trash**, and a
circle to select it. Select any number and either **make a post from them** (up
to 10, Instagram's carousel limit) or **move them all to the trash**. A photo in
a scheduled or published post is protected: the database refuses to trash it,
and bulk actions skip it and say how many were kept.

Two things appear only when they matter: a photo whose **colour profile had to
be guessed** says so over the image and offers to be told what it really is, and
a photo that **failed to process** offers a retry.

Deletion is soft. Trashed photos can be restored, and are destroyed only by
"Delete forever", "Empty trash", or the 30-day sweep.

### Posts

One page, three views of the same thing.

**Grid** — a mock of the Instagram profile: newest first, 4:5 tiles, three
across. Posts still to come run from the top; what is already on the account
carries on below in the same grid, mid-row if that is where it falls, so the
join can be judged. Tiles are dragged to rearrange. Beside the grid, **Up next**
lists the same posts soonest-first with their dates — the question the grid
cannot answer, since the grid reads newest-first and the queue runs the other
way.

**Schedule** — what is going out and when.

**Drafts** — only what is unfinished, each saying what it is waiting for
("Needs no caption, no hashtags"). Posts that failed to publish appear here too,
since the grid does not draw them and the schedule has moved past them.

### The composer

One column, in the order the work happens.

1. **When** — three choices, decided first (§4).
2. **Photos** — five across, up to ten. Each already cropped to 4:5, with the
   crop editor one click away. Drag to reorder; the first is the cover and sets
   the shape for the whole carousel.
3. **Caption** — plain text, 2,200 characters, counted live. Instagram strips
   formatting, and the box says so by having none.
4. **Hashtags** — the tags chosen, a **Shuffle** button, and a pin on each tag
   to keep it through a redraw. Placement reads as a sentence ("Going in the
   first comment") with a link to change it. The per-category mix and the full
   library fold away behind **Mix & library**.

Saving is deliberate — a Save button, not autosave — so there is something to
discard. Leaving with unsaved changes warns first.

**The strip**: a panel pulled out from the left edge, holding either the grid or
the two notebooks, beside whatever you are doing. Click a line from a notebook
and it drops into the caption at the cursor. It lives in the app's frame, so it
is fetched once and survives moving between screens. Closed by default and
remembered.

Typing `--` gives an em dash and `-->` an arrow, in captions and notebooks.

### Ideas

Two notebooks, and only two: **Strategy** (what you are trying to say) and
**Idea bank** (the pile). Rich text with a formatting bar, saved as you type.
The database enforces exactly one of each — neither can be created or deleted.

### Settings

Instagram connection, posting times, preferences (hashtags per post, how long
originals are kept, whether full-size files are dropped after posting), and a
link to the hashtag library.

Alongside the connection sits **dry run**. With it on, everything runs end to
end and the publisher logs exactly what it *would* post without contacting
Instagram. It is on until the account is connected, and switched back on
automatically if the account is ever disconnected — so a half-finished
reconnection cannot publish by accident.

### Hashtag library

Tags grouped into categories, each with a volume. Add, edit, retire (a retired
tag stays for reference but is never offered), delete, and act on many at once.
The saved "how many from each category" mix is what Shuffle draws against.

---

## 3. Photos

Processing happens outside the app, in GitHub Actions, because the image library
cannot run on Cloudflare. An upload is converted **in a single pass**: resized
to 1440px and colour-converted to sRGB together, because each extra encode
compounds loss. The sRGB profile is embedded in the output. A file arriving with
no colour profile is flagged, never silently assumed.

Photos are auto-cropped to **4:5** on upload — the shape that takes the most
room on an Instagram feed — and the crop can be adjusted afterwards without
re-compressing, as long as the original is still kept.

Previews are generated from the processed file, never from a browser thumbnail,
so what you see is what will be sent.

---

## 4. Scheduling

**Weekly slots** are set in Settings as a weekday and a local time, not as
instants, so a 10am slot stays 10am across daylight saving. All times are
`America/Los_Angeles`. Stored as UTC, shown as Pacific.

Every post is one of three things:

| | What it means |
|---|---|
| **In the queue** | Takes the next free slot. If a slot is missed it rolls forward rather than publishing at an odd hour |
| **Scheduled** | Pinned to an exact instant. The queue works around it |
| **Draft** | Holds its place in the grid, and is passed over when its slot arrives |

**A queued post has no stored date.** Its date is worked out fresh from "the
next free slot" every time anything shows it. This is why a missed queued post
quietly becomes next week's plan with no "this was late" marker — only pinned
posts get one.

**Readiness decides whether a post publishes**, not status. An unfinished post
is skipped and the next finished one takes the slot, so a ready post behind
three drafts goes out next, not in four weeks.

**Dates belong to positions, not posts.** Dragging the grid swaps which post
lands on which date.

Before a post can go out it needs saved changes, at least one photo, a caption,
and photo shapes Instagram will not mangle. The shape check is a **refusal**:
the cost of getting it wrong is a published carousel with every landscape
centre-cropped, which cannot be repaired, only deleted. Publishing with no
hashtags asks once rather than refusing.

**Publishing** is woken within a minute of a slot arriving. A post is claimed
before it is sent, so two runs cannot publish it twice, and the claim records
the slot it is going out for. Hashtags go in the caption unless the post says
otherwise, in which case they are posted as the first comment straight after.

---

## 5. What runs where

| Piece | Runs on |
|---|---|
| The website | Cloudflare Workers |
| Photo processing, publishing, token refresh | GitHub Actions |
| The clock and watchdog | Cloudflare Workers, every minute |
| Deploying | GitHub Actions, on every push to `main` |
| Data and photos | Supabase (Postgres + Storage) |

Nothing runs on the owner's computer.

The **clock** asks every minute whether anything is due and wakes the publisher
when it is. GitHub's own fifteen-minute schedule is still there as a backstop,
but it is best-effort and has been measured running hours late, which is why the
clock exists.

The clock also **watches**: if the database stops answering for three minutes,
or a finished post is overdue by twenty, it opens a GitHub issue — which arrives
as an email — and closes it again when things recover, so an open alert always
means something is wrong now. It runs outside both the database and GitHub,
which is what lets it report either of them being broken.

---

## 6. The data, in plain terms

- **photos** — the bank. Soft-deleted via `deleted_at`; any query over photos
  must exclude trashed ones or they leak back into counts and pickers.
- **posts** — one row per post, whatever its state. An idea, a draft, something
  queued and something already on Instagram are all posts.
- **post_photos** — which photos are on a post, and in what order.
- **post_hashtags** — the tags chosen for a post, stored as literal text
  alongside the library id they came from, so renaming a library entry later
  cannot rewrite what was published.
- **photo_tags** — accounts tagged in a photo.
- **hashtags** / **hashtag_categories** — the library.
- **schedule_slots** — the weekly posting times.
- **notes** — exactly two rows, Strategy and Idea bank.
- **publish_log** — what the publisher did.
- **app_settings** — preferences and connection state.
- **app_secrets** — Instagram tokens. **No access rules at all**, deliberately:
  that is what keeps tokens out of the browser. Only server-side code with the
  service key can read it.

---

## 7. Limits that are Instagram's, not the app's

Do not try to work around these:

- **Carousels: 10 images.** The Instagram app itself allows 20; the publishing
  API does not, for any tool, free or paid.
- **Music: impossible.** No API can attach a library track to a scheduled post,
  on any account type. A post that needs a song must be published by hand.
- **Location tags: impossible.** Needs an endpoint deprecated for third parties.
- **Collaborators: impossible.** Not exposed by the API at all.
- **Tagging accounts in a photo: possible**, and built. Different feature.
- **100 posts per rolling 24 hours** is the real publishing ceiling.
- Captions are 2,200 characters, plain text; 30 hashtags maximum.

---

## 8. Deliberately not built

- **Anything that writes copy.** See §1. Not negotiable.
- **Insights and analytics.** Cut to keep the app small and cheap. The data
  sync still exists but nothing displays it.
- **Writing alt text.** Removed at the owner's request. Existing alt text is
  still stored and still published.
- **Multiple accounts, multiple users, teams.** One of each, on purpose.

Ideas considered and parked, with the research already done, are in
`docs/ideas.md`.
