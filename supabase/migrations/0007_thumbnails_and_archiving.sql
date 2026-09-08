-- ============================================================================
-- Thumbnails, and archiving the full file once a post is old
--
-- Two storage problems, one migration.
--
-- 1. The media bank grid was loading full 1440px files into 200px cells —
--    roughly 20x more bandwidth than the grid needs. Each photo now also gets
--    a small thumbnail. The grid uses it; anywhere colour actually matters
--    still shows the real processed file.
--
-- 2. Once a post has been live for a while, its full-size file is dead weight:
--    Instagram holds its own copy, and the only thing this app still needs is
--    something to draw in the grid preview. After a retention window the full
--    file is removed and the thumbnail kept, which is about a 95% saving on a
--    photo that has done its job.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table photos
  -- Small JPEG for grids and pickers. Same colour-managed pass as the full
  -- file, so it is a faithful miniature rather than a browser-made guess.
  add column if not exists thumb_path text,
  -- When the full-size file was removed. The photo is still usable as a
  -- record and still shows in the grid; it just cannot be posted again.
  add column if not exists full_removed_at timestamptz;

create index if not exists photos_archivable_idx
  on photos (processed_at) where storage_path is not null and full_removed_at is null;

-- ---------------------------------------------------------------------------
-- How long to keep the full file after a post goes live.
--
-- Configurable because it is a judgement call, not a fact: 0 disables
-- archiving entirely and keeps every full file forever.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists archive_published_after_days smallint not null default 14;

notify pgrst, 'reload schema';
