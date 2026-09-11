-- ============================================================================
-- Instagram Post Scheduler - initial schema
--
-- Single-user app. Every table has RLS on; only the one authenticated account
-- can read/write. Secrets live in `app_secrets`, which has NO policies at all,
-- so it is reachable only with the service-role key (i.e. from the GitHub
-- Actions worker, never from the browser).
--
-- All wall-clock scheduling is interpreted in America/Los_Angeles.
--
-- IDEMPOTENT: safe to run repeatedly. A partial run (a truncated paste, a
-- dropped connection) is fixed by simply running it again, which is worth the
-- extra guards — a half-applied schema is otherwise painful to diagnose.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  -- Lifecycle of a photo in the media bank. A photo is only usable once its
  -- colour-managed conversion has finished ('ready').
  create type photo_status as enum ('pending', 'processing', 'ready', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  -- Lifecycle of a post.
  --   idea          - a thought, not yet a real post
  --   rough_draft   - hidden from the grid preview entirely
  --   preview_draft - shown in the grid in position, never auto-published
  --   queued        - in the rolling queue, will take the next open slot
  --   scheduled     - has a committed instant (rolling slot or fixed date)
  --   publishing    - the worker has claimed it right now
  --   published     - live on Instagram
  --   failed        - publishing failed, needs attention
  create type post_status as enum (
    'idea', 'rough_draft', 'preview_draft',
    'queued', 'scheduled', 'publishing', 'published', 'failed'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  -- Rolling queue (takes the next open weekly slot) vs a pinned date/time.
  create type schedule_mode as enum ('queue', 'fixed');
exception when duplicate_object then null;
end $$;

do $$ begin
  -- Hashtags either go on the end of the caption, or get posted as the first
  -- comment immediately after publishing.
  create type hashtag_placement as enum ('caption', 'first_comment');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Media bank
-- ---------------------------------------------------------------------------

create table if not exists photos (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  original_filename text not null,

  -- Temp home of the untouched upload. Cleared once processing succeeds so
  -- full-res masters never eat into the 1GB free tier.
  upload_path       text,
  -- Final colour-managed JPEG in the public `media` bucket. This is the file
  -- Instagram is handed, and the file the UI previews.
  storage_path      text,

  status            photo_status not null default 'pending',
  processing_error  text,
  processed_at      timestamptz,
  -- When the worker took this photo. Used to spot a run that died mid-photo
  -- and hand the row back to the queue; must be the claim time, not the
  -- upload time, or a freshly claimed old photo would be released mid-flight.
  claimed_at        timestamptz,

  -- Facts about the delivered file.
  width             integer,
  height            integer,
  bytes             integer,

  -- Colour-management audit trail. `source_color_profile` records what the
  -- upload actually carried (e.g. 'Display P3', 'Adobe RGB (1998)').
  -- `missing_color_profile` means we refuse to guess - the UI flags it
  -- instead of silently assuming sRGB.
  source_color_profile  text,
  missing_color_profile boolean not null default false,

  alt_text          text,
  notes             text
);

create index if not exists photos_status_idx     on photos (status);
create index if not exists photos_created_at_idx on photos (created_at desc);
-- Lets the worker find its next batch of work cheaply.
create index if not exists photos_pending_idx    on photos (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Hashtag library
-- ---------------------------------------------------------------------------

create table if not exists hashtag_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists hashtags (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references hashtag_categories (id) on delete set null,
  -- Stored WITHOUT the leading '#'.
  tag         text not null unique check (tag ~ '^[A-Za-z0-9_]{1,138}$'),
  created_at  timestamptz not null default now()
);

create index if not exists hashtags_category_idx on hashtags (category_id);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table if not exists posts (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  title             text,  -- internal label only, never sent to Instagram
  -- Instagram's hard caption ceiling is 2,200 characters.
  caption           text not null default '' check (char_length(caption) <= 2200),
  hashtag_placement hashtag_placement not null default 'caption',

  status            post_status not null default 'rough_draft',
  schedule_mode     schedule_mode not null default 'queue',

  -- The committed publish instant. Always UTC in the database; the UI renders
  -- it in America/Los_Angeles.
  scheduled_for     timestamptz,
  -- Which weekly slot filled this, when it came from the rolling queue.
  slot_id           uuid,
  -- Ordering within the rolling queue before slots are assigned.
  queue_position    integer,

  -- Worker bookkeeping.
  claimed_at        timestamptz,  -- set while 'publishing', cleared afterwards
  attempt_count     integer not null default 0,
  last_error        text,

  -- Results from Instagram.
  published_at      timestamptz,
  ig_media_id       text,
  ig_permalink      text,
  -- True when this post went through a dry run instead of the real API.
  was_dry_run       boolean not null default false,

  -- A post about to go live must know when it is going live.
  constraint committed_posts_need_a_time
    check (status not in ('scheduled', 'publishing') or scheduled_for is not null)
);

create index if not exists posts_status_idx    on posts (status);
create index if not exists posts_scheduled_idx on posts (scheduled_for);
create index if not exists posts_queue_idx     on posts (queue_position) where status = 'queued';
-- The worker's hot path: what is due right now?
create index if not exists posts_due_idx       on posts (scheduled_for)
  where status in ('scheduled', 'publishing');

-- ---------------------------------------------------------------------------
-- Post <-> photo (carousel members, ordered, max 10)
-- ---------------------------------------------------------------------------

create table if not exists post_photos (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references posts (id)  on delete cascade,
  photo_id uuid not null references photos (id) on delete restrict,
  -- 0-9. Instagram's Content Publishing API caps carousels at 10 items,
  -- even though the Instagram app itself now allows 20.
  position smallint not null check (position between 0 and 9),

  unique (post_id, position),
  unique (post_id, photo_id)
);

create index if not exists post_photos_post_idx  on post_photos (post_id);
create index if not exists post_photos_photo_idx on post_photos (photo_id);

-- ---------------------------------------------------------------------------
-- User tags (username + relative x/y on one image of the post)
-- ---------------------------------------------------------------------------

create table if not exists photo_tags (
  id            uuid primary key default gen_random_uuid(),
  post_photo_id uuid not null references post_photos (id) on delete cascade,
  username      text not null check (username ~ '^[A-Za-z0-9._]{1,30}$'),
  -- Fractions of the image, 0.0-1.0, as the Graph API expects.
  x             numeric(5,4) not null check (x >= 0 and x <= 1),
  y             numeric(5,4) not null check (y >= 0 and y <= 1),

  unique (post_photo_id, username)
);

-- Guarded because 0010 replaces this table with a different shape. An early
-- migration must survive being re-run against a schema a later one has
-- superseded, or `npm run db:apply` stops working the moment anything is
-- restructured.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'photo_tags' and column_name = 'post_photo_id'
  ) then
    create index if not exists photo_tags_post_photo_idx on photo_tags (post_photo_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Post <-> hashtag
-- ---------------------------------------------------------------------------

create table if not exists post_hashtags (
  post_id    uuid not null references posts (id)    on delete cascade,
  hashtag_id uuid not null references hashtags (id) on delete cascade,
  position   smallint not null default 0,

  primary key (post_id, hashtag_id)
);

create index if not exists post_hashtags_post_idx on post_hashtags (post_id);

-- ---------------------------------------------------------------------------
-- Weekly recurring slots (the rolling queue's timetable)
-- ---------------------------------------------------------------------------

create table if not exists schedule_slots (
  id         uuid primary key default gen_random_uuid(),
  -- 0 = Sunday ... 6 = Saturday, in America/Los_Angeles.
  weekday    smallint not null check (weekday between 0 and 6),
  -- Local wall-clock time, e.g. 10:00. Kept as wall-clock rather than an
  -- instant so 10am stays 10am across daylight-saving changes.
  local_time time not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),

  unique (weekday, local_time)
);

do $$ begin
  alter table posts
    add constraint posts_slot_fk
    foreign key (slot_id) references schedule_slots (id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Ideas notepad (freeform rich text, not tied to any post)
-- ---------------------------------------------------------------------------

create table if not exists notes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled',
  -- Rich text: bold/italic/lists. Stored as editor JSON, with an HTML copy
  -- for cheap read-only rendering.
  content      jsonb not null default '{}'::jsonb,
  content_html text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Publish log (every worker decision, for debugging a missed post)
-- ---------------------------------------------------------------------------

create table if not exists publish_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  post_id uuid references posts (id) on delete set null,
  level   text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text not null,
  detail  jsonb
);

create index if not exists publish_log_at_idx   on publish_log (at desc);
create index if not exists publish_log_post_idx on publish_log (post_id);

-- ---------------------------------------------------------------------------
-- Settings (safe to read in the browser) and secrets (never)
-- ---------------------------------------------------------------------------

create table if not exists app_settings (
  -- Enforces exactly one row.
  id                    boolean primary key default true check (id),
  timezone              text not null default 'America/Los_Angeles',

  -- Master switch. While true, the worker simulates publishing and writes a
  -- full log entry instead of calling Instagram. Ships ON.
  dry_run               boolean not null default true,

  ig_username           text,
  ig_user_id            text,
  ig_token_expires_at   timestamptz,
  ig_connected_at       timestamptz,

  -- Soft guide for the hashtag picker; Instagram's real cap is 30.
  hashtag_min           smallint not null default 3,
  hashtag_max           smallint not null default 7,

  updated_at            timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

-- No RLS policies are ever created for this table, so PostgREST will refuse
-- every anon/authenticated request. Only the service-role key can touch it.
create table if not exists app_secrets (
  id                boolean primary key default true check (id),
  ig_app_id         text,
  ig_app_secret     text,
  ig_access_token   text,
  updated_at        timestamptz not null default now()
);

insert into app_secrets (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger posts_touch_updated_at
  before update on posts
  for each row execute function touch_updated_at();

create or replace trigger notes_touch_updated_at
  before update on notes
  for each row execute function touch_updated_at();

create or replace trigger app_settings_touch_updated_at
  before update on app_settings
  for each row execute function touch_updated_at();

create or replace trigger app_secrets_touch_updated_at
  before update on app_secrets
  for each row execute function touch_updated_at();

-- Belt and braces on the carousel cap. The `position` check already bounds
-- each row to 0-9, but this also catches a post with duplicate-free positions
-- that somehow exceeds ten members.
create or replace function enforce_carousel_limit()
returns trigger
language plpgsql
as $$
declare
  member_count integer;
begin
  select count(*) into member_count
  from post_photos
  where post_id = new.post_id;

  if member_count > 10 then
    raise exception
      'Instagram carousels are capped at 10 images by the Content Publishing API';
  end if;

  return null;
end;
$$;

-- CREATE OR REPLACE does not support CONSTRAINT triggers, so this one keeps
-- its drop — guarded, because `drop trigger if exists ... on <table>` still
-- errors outright when the table itself is absent.
do $$ begin
  if to_regclass('public.post_photos') is not null then
    drop trigger if exists post_photos_carousel_limit on post_photos;
  end if;
end $$;
create constraint trigger post_photos_carousel_limit
  after insert or update on post_photos
  deferrable initially deferred
  for each row execute function enforce_carousel_limit();

-- A photo that is live on Instagram, or committed to going live, must not be
-- deleted out from under the post. `on delete restrict` covers the hard case;
-- this makes the failure legible.
create or replace function guard_photo_deletion()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from post_photos pp
    join posts p on p.id = pp.post_id
    where pp.photo_id = old.id
      and p.status in ('scheduled', 'publishing', 'published')
  ) then
    raise exception
      'This photo belongs to a scheduled or published post and cannot be deleted';
  end if;

  return old;
end;
$$;

create or replace trigger photos_guard_deletion
  before delete on photos
  for each row execute function guard_photo_deletion();

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------

-- The media bank's Unused / Drafted / Scheduled / Posted filter. Derived
-- rather than stored, so it can never drift out of sync with the posts.
create or replace view photo_usage
with (security_invoker = true)
as
select
  ph.id as photo_id,
  case
    when exists (
      select 1 from post_photos pp join posts p on p.id = pp.post_id
      where pp.photo_id = ph.id and p.status = 'published'
    ) then 'posted'
    when exists (
      select 1 from post_photos pp join posts p on p.id = pp.post_id
      where pp.photo_id = ph.id
        and p.status in ('queued', 'scheduled', 'publishing')
    ) then 'scheduled'
    when exists (
      select 1 from post_photos pp join posts p on p.id = pp.post_id
      where pp.photo_id = ph.id
        and p.status in ('idea', 'rough_draft', 'preview_draft', 'failed')
    ) then 'drafted'
    else 'unused'
  end as usage
from photos ph;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- One human uses this app. Sign-ups are disabled in the Supabase dashboard and
-- the proxy allowlists a single address, so "is authenticated" is the correct
-- and sufficient test here.
-- ---------------------------------------------------------------------------

alter table photos             enable row level security;
alter table hashtag_categories enable row level security;
alter table hashtags           enable row level security;
alter table posts              enable row level security;
alter table post_photos        enable row level security;
alter table photo_tags         enable row level security;
alter table post_hashtags      enable row level security;
alter table schedule_slots     enable row level security;
alter table notes              enable row level security;
alter table publish_log        enable row level security;
alter table app_settings       enable row level security;
alter table app_secrets        enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'photos', 'hashtag_categories', 'hashtags', 'posts', 'post_photos',
    'photo_tags', 'post_hashtags', 'schedule_slots', 'notes', 'app_settings'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_owner_all', t
    );
  end loop;
end;
$$;

-- The log is written by the worker (service role) and only read in the UI.
drop policy if exists publish_log_read on publish_log;
create policy publish_log_read on publish_log
  for select to authenticated using (true);

-- Deliberately no policies on app_secrets: service role only.
