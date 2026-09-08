# Build Brief: Instagram Post Scheduler (v2)

## What this is
A custom scheduling and content-organization tool for Instagram, replacing Buffer/Later, for a photography business. Every service in the stack must be on a permanently free tier — no trials, no paid add-ons.

## Hard rule: no AI-generated content, ever
This app must never generate, suggest, autocomplete, or draft captions, hashtags, or any other text using AI. It is purely an organizing/scheduling tool. Do not add AI writing assistance features of any kind, even as an optional toggle.

## Platform realities to design around
- **Carousels are capped at 10 images via the API**, even though Instagram's own app now allows 20. This is a hard limit of Meta's Content Publishing API — no scheduling tool, free or paid, can exceed it. Build the carousel composer around a 10-image max and surface that limit clearly in the UI.
- **Music can't be attached to photo or carousel posts through the API.** Instagram's music/audio-sticker feature is in-app only. If a post ever needs music, add it manually afterward in the Instagram app itself.
- **No artificial post-count limit needed.** Instagram's real API ceiling is 100 published posts per rolling 24 hours — far beyond what a single account will need. Don't build in any monthly/weekly cap; just respect that real ceiling as a safety check.

## Tech stack (free tier only)
- **Frontend/dashboard:** Next.js on Vercel free tier
- **Database:** Supabase free tier (Postgres) — 500MB DB / 1GB file storage
- **Media storage:** Supabase Storage free tier
- **Scheduler:** GitHub Actions cron workflow (e.g. every 15 min) calling a publish endpoint — avoids needing an always-on server
- **Posting:** Instagram Graph API (Business/Creator account linked to a Facebook Page — the Page itself doesn't need to be actively used, linking it is just a technical requirement for API access)

## Photo quality: "highest quality" within a 1GB free storage tier, and avoiding the Later desaturation problem
Instagram caps every image it displays at 1440px max width and 8MB max file size — anything larger gets compressed by Instagram on their end regardless of what's uploaded. So the media bank should store images already optimized to that ceiling: up to 1440px wide, high-quality JPEG, minimal-but-non-destructive compression, ideally well under 8MB. This is the best quality Instagram can ever display, and it stretches the free 1GB storage to several hundred photos instead of a few dozen full-res masters. True full-res originals stay in the photographer's own separate storage/catalog — this app's media bank is only for what actually gets posted.

**Color accuracy is the priority here** — this is very likely why Later's uploads looked unsaturated/bad. The most common cause of "washed out on Instagram" is a color-profile mismatch: source files exported in a wide-gamut space (Adobe RGB, ProPhoto, Display P3) get their ICC profile stripped rather than properly converted before upload, so the color values get reinterpreted as sRGB and land in the wrong place — muted, dull, off. To avoid this:
- Every photo processed by the app must go through a true color-managed conversion to sRGB — actual gamut conversion math via a proper image library (e.g. Sharp/libvips, which handles ICC profiles correctly), never a naive strip-the-profile-and-relabel approach
- Embed the sRGB ICC profile explicitly in the final output file
- Resize and color-convert in a single high-quality pass — avoid multiple lossy round-trips, since each re-encode compounds the problem
- If an uploaded photo has no embedded color profile at all, flag it in the UI rather than silently guessing
- Show a true preview of the actual final processed file before scheduling (not a quick lossy browser-generated thumbnail), so any color shift is caught before it goes live, not after

## Core features

### Media bank
- Upload photos (single or batch), stored at the quality spec above
- Single- or multi-select when building a post (carousel = multi-select, up to 10)
- Status per photo: **Unused / Scheduled / Posted**
- Filter views: "Used" (scheduled or posted) vs. "Available" vs. "Drafted but not scheduled/posted" as its own filter

### Hashtag library
- A saved, categorized list of hashtags (e.g. by location or shoot type)
- When building a post, filter by category and select 3–7 to attach
- Live selection count shown (a soft 3–7 guide — Instagram's real cap is 30)

### Caption composer
- Live character counter against Instagram's 2,200-character caption limit
- Inline note that Instagram captions don't support bold/italic — plain text and line breaks only
- Per-post choice: append hashtags to the bottom of the caption, OR hold them back and auto-post as the first comment immediately after publish (via the Graph API's comment endpoint)
- Option to add further comments manually after a post is live

### Ideas & notes
- Lightweight "idea" entries — a caption idea alone, or an idea paired with one or more bank photos — saved outside the scheduling flow until promoted to a real draft
- A separate rich-text notepad (bold/italic/lists) for a running, freeform "idea dump," not tied to any single post

### Drafts & grid preview
- A visual mock of the Instagram grid (3-column) showing scheduled + published posts in order
- "Rough draft" posts: excluded from the grid preview entirely
- "Preview draft" posts: shown in the grid preview in their intended position, but never auto-published while still in draft/unscheduled state

### Scheduling: rolling queue + fixed posts
- Define recurring **weekly time slots** (e.g. Tue 10am, Thu 5pm, Sat 9am)
- **Rolling queue mode:** drafts added to the queue take the next open future slot. If a slot passes without its post actually publishing (worker hiccup, etc.), that post automatically rolls to the next open slot going forward — it never sits as a stale, backdated post that has to be manually rescheduled
- **Fixed mode:** posts can also be scheduled for an exact date/time outside the rolling queue, for anything genuinely time-sensitive
- *(Phase 2 idea, not v1):* pull follower-activity data from Instagram Insights to suggest which weekly slots tend to perform best — doable later via the Insights API, but adds its own permission/App Review scope, so treat as a stretch goal after the core tool is working

### Carousels & tagging
- Carousel composer, up to 10 images (see platform realities above), reorderable before scheduling
- Tag other Instagram users on photos (the API supports this: username plus x/y position on the image)

## Scheduling range
Support scheduling months in advance — no artificial cap on how far out a post or queue slot can be set.

## Explicitly out of scope for v1
- Instagram Stories (not schedulable via the native API)
- Reels/video
- Platforms beyond Instagram
- Multi-user accounts or permissions — single user only

## What I'll handle manually (not part of the build)
- Creating the Meta Developer App and submitting it for app review
- Linking my Instagram Business account to a Facebook Page
- Creating the free-tier Vercel, Supabase, and GitHub accounts

## What I need from you
Set up the project structure and implement the above. Tell me the exact manual steps I need to do in Meta's developer dashboard, in order, before the app can post live — that part can't be automated.
