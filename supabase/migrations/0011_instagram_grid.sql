-- ============================================================================
-- A local copy of what is already on the Instagram grid
--
-- So the preview can show posts that are still to come sitting above the ones
-- already live — which is the only way to judge how the grid will actually
-- look, rather than imagining the join.
--
-- Cached rather than fetched on page load for two reasons: Instagram's media
-- URLs are signed and short-lived, so they need periodic refreshing anyway,
-- and hitting the API on every render would burn rate limit for no benefit.
-- The worker refreshes it.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

create table if not exists instagram_media (
  -- Instagram's own media id.
  id            text primary key,
  permalink     text,
  media_type    text,
  -- Signed CDN URL. Expires, which is why fetched_at matters.
  media_url     text,
  thumbnail_url text,
  caption       text,
  posted_at     timestamptz,
  fetched_at    timestamptz not null default now()
);

create index if not exists instagram_media_posted_idx
  on instagram_media (posted_at desc);

alter table instagram_media enable row level security;

drop policy if exists instagram_media_owner_all on instagram_media;
create policy instagram_media_owner_all on instagram_media
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- When the grid was last brought up to date, so the UI can say so rather than
-- silently showing something stale.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists grid_synced_at timestamptz;

notify pgrst, 'reload schema';
