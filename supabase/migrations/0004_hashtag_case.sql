-- ============================================================================
-- Hashtags are case-insensitive on Instagram
--
-- #WilderPines and #wilderpines are the same tag. The original UNIQUE
-- constraint was case-sensitive, so the library would happily hold both and
-- you could attach the same hashtag to a post twice under two spellings.
--
-- Case is still preserved as typed — camel case is much easier to read in a
-- caption — it just no longer counts as a different tag.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table hashtags drop constraint if exists hashtags_tag_key;

create unique index if not exists hashtags_tag_lower_idx on hashtags (lower(tag));

-- ---------------------------------------------------------------------------
-- Instagram allows at most 30 hashtags on a post. The app guides toward 3-7,
-- but the hard ceiling belongs in the database like every other platform limit.
-- ---------------------------------------------------------------------------

create or replace function enforce_hashtag_limit()
returns trigger
language plpgsql
as $$
declare
  tag_count integer;
begin
  select count(*) into tag_count
  from post_hashtags
  where post_id = new.post_id;

  if tag_count > 30 then
    raise exception 'Instagram allows at most 30 hashtags on a post';
  end if;

  return null;
end;
$$;

do $$ begin
  if to_regclass('public.post_hashtags') is not null then
    drop trigger if exists post_hashtags_limit on post_hashtags;
  end if;
end $$;

create constraint trigger post_hashtags_limit
  after insert or update on post_hashtags
  deferrable initially deferred
  for each row execute function enforce_hashtag_limit();

notify pgrst, 'reload schema';
