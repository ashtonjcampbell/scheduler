-- ============================================================================
-- How every post actually performed
--
-- Kept separate from `instagram_media`, which is a cache of the 36 most recent
-- posts complete with signed image URLs that expire and must be refreshed
-- constantly. This table is the opposite: no URLs, years of history, and rows
-- that stop changing once a post is a month old. Mixing the two would mean
-- re-fetching hundreds of images to answer a question about numbers.
--
-- Metrics are nullable throughout. Instagram does not return every metric for
-- every media type, and a post whose insights call failed should be a row with
-- gaps rather than an absent row — otherwise a transient error silently biases
-- the analysis by dropping posts.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

create table if not exists media_performance (
  -- Instagram's own media id.
  id                 text primary key,
  posted_at          timestamptz not null,
  media_type         text,
  permalink          text,

  -- Visible without the insights permission.
  like_count         integer,
  comments_count     integer,

  -- Requires instagram_manage_insights.
  reach              integer,
  views              integer,
  saved              integer,
  shares             integer,
  total_interactions integer,
  profile_visits     integer,
  follows            integer,

  -- A post's numbers keep moving for weeks, so a row's age decides whether it
  -- is worth re-fetching.
  fetched_at         timestamptz not null default now()
);

create index if not exists media_performance_posted_idx
  on media_performance (posted_at desc);

-- Finding which rows are stale enough to refresh is the query the sync runs
-- every time.
create index if not exists media_performance_fetched_idx
  on media_performance (fetched_at);

alter table media_performance enable row level security;

drop policy if exists media_performance_owner_all on media_performance;
create policy media_performance_owner_all on media_performance
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- When the numbers were last brought up to date, so the page can say so rather
-- than presenting something stale as current.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists performance_synced_at timestamptz;

notify pgrst, 'reload schema';
