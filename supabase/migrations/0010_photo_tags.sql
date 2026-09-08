-- ============================================================================
-- Tagging accounts on a photo
--
-- photo_tags pointed at a post_photos row. The composer saves a post's photos
-- by replacing the whole set — which is what keeps positions honest — so every
-- save deleted the join rows and cascaded the tags away with them. Silent, and
-- only noticeable once a post published without its tags.
--
-- Tags now hang off (post_id, photo_id), which is stable across reordering and
-- re-saving. Removing a photo from a post still takes its tags, which is
-- correct: a tag is a position on an image within a post.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

drop table if exists photo_tags;

create table if not exists photo_tags (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references posts (id)  on delete cascade,
  photo_id uuid not null references photos (id) on delete cascade,

  -- Instagram usernames: letters, numbers, dots and underscores, max 30.
  username text not null check (username ~ '^[A-Za-z0-9._]{1,30}$'),

  -- Where the tag sits on the image, as fractions of width and height. The
  -- Graph API wants exactly this.
  x numeric(5,4) not null check (x >= 0 and x <= 1),
  y numeric(5,4) not null check (y >= 0 and y <= 1),

  -- The same account twice on one image is a mistake, and Instagram rejects it.
  unique (post_id, photo_id, username)
);

create index if not exists photo_tags_post_idx on photo_tags (post_id);

-- ---------------------------------------------------------------------------
-- Instagram allows at most 20 tagged accounts per image.
-- ---------------------------------------------------------------------------

create or replace function enforce_photo_tag_limit()
returns trigger
language plpgsql
as $$
declare
  tag_count integer;
begin
  select count(*) into tag_count
  from photo_tags
  where post_id = new.post_id and photo_id = new.photo_id;

  if tag_count > 20 then
    raise exception 'Instagram allows at most 20 tagged accounts on an image';
  end if;

  return null;
end;
$$;

create constraint trigger photo_tags_limit
  after insert or update on photo_tags
  deferrable initially deferred
  for each row execute function enforce_photo_tag_limit();

alter table photo_tags enable row level security;

drop policy if exists photo_tags_owner_all on photo_tags;
create policy photo_tags_owner_all on photo_tags
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
