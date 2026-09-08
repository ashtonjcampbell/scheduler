-- ============================================================================
-- A post records the hashtags it actually used
--
-- post_hashtags pointed at library rows, which meant a post's hashtags could
-- change retroactively — rename a tag and last month's published post would
-- claim it used the new spelling; delete one and the post would lose it
-- entirely. For a record of what was published, that is wrong.
--
-- It now stores the literal tag text, with an OPTIONAL link back to the
-- library entry it came from. That also makes one-off tags first-class: type
-- a tag that isn't in the library, use it once, and never have it clutter the
-- library.
--
-- Safe to run: no posts exist yet, and the old shape is dropped outright.
-- IDEMPOTENT.
-- ============================================================================

drop table if exists post_hashtags;

create table if not exists post_hashtags (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts (id) on delete cascade,

  -- What will actually be published, without the leading '#'.
  tag        text not null check (tag ~ '^[A-Za-z0-9_]{1,138}$'),

  -- Where it came from, when it came from the library. Null for a one-off.
  -- `on delete set null` so retiring or deleting a library tag never rewrites
  -- history.
  hashtag_id uuid references hashtags (id) on delete set null,

  position   smallint not null default 0,

  unique (post_id, position)
);

create index if not exists post_hashtags_post_idx on post_hashtags (post_id);

-- The same tag twice in one caption is a mistake, not a choice — and
-- Instagram treats case as irrelevant, so #MtBaker and #mtbaker collide.
create unique index if not exists post_hashtags_unique_tag_idx
  on post_hashtags (post_id, lower(tag));

-- ---------------------------------------------------------------------------
-- Instagram's 30-hashtag ceiling, re-attached to the new table.
-- ---------------------------------------------------------------------------

create or replace function enforce_hashtag_limit()
returns trigger
language plpgsql
as $$
declare
  tag_count integer;
begin
  select count(*) into tag_count from post_hashtags where post_id = new.post_id;

  if tag_count > 30 then
    raise exception 'Instagram allows at most 30 hashtags on a post';
  end if;

  return null;
end;
$$;

create constraint trigger post_hashtags_limit
  after insert or update on post_hashtags
  deferrable initially deferred
  for each row execute function enforce_hashtag_limit();

alter table post_hashtags enable row level security;

drop policy if exists post_hashtags_owner_all on post_hashtags;
create policy post_hashtags_owner_all on post_hashtags
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- The soft guide, corrected to how these posts are actually written: 3-10
-- hashtags rather than the 3-7 in the original brief.
-- ---------------------------------------------------------------------------

alter table app_settings alter column hashtag_max set default 10;
update app_settings set hashtag_max = 10 where hashtag_max = 7;

notify pgrst, 'reload schema';
