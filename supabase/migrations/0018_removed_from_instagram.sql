-- ============================================================================
-- Posts deleted on Instagram stop counting as published here
--
-- The grid mirrors the profile. When a post is deleted on Instagram and the
-- record stays, the mirror starts showing something that is not there — which
-- is worse than showing nothing, because it is quietly wrong.
--
-- Marked rather than deleted. The row still holds the caption, the photo set
-- and the hashtags that went out, which is the only copy of a post that has
-- been taken down — and losing that to a tidy-up would be its own small
-- disaster. It simply stops appearing anywhere that means "live".
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table posts
  add column if not exists removed_from_instagram_at timestamptz;

-- The reconciler looks for published posts it has not already marked, so this
-- is the shape of the query it runs every time.
create index if not exists posts_live_published_idx
  on posts (status)
  where status = 'published' and removed_from_instagram_at is null;

notify pgrst, 'reload schema';
