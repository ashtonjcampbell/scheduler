-- ============================================================================
-- Being in the queue and being ready to publish become separate things
--
-- Until now a post's status answered both at once: "queued" meant both in the
-- queue AND going out. So an unfinished post could not sit in the queue at all,
-- and the grid could not show it in the place it was actually intended for —
-- which is precisely when seeing it is most useful.
--
-- Now: queue position says WHERE, `ready` says WHETHER. A draft can hold its
-- place in the queue for weeks; when its slot comes up and it still is not
-- ready, the slot goes to the next post that is, and the draft keeps its place
-- for the following one.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Hashtags go in the first comment unless told otherwise.
--
-- It is where they belong on this account: the caption stays readable and the
-- tags still count. Changing the DEFAULT rather than every existing row, so a
-- post already written to put them in the caption keeps doing that.
-- ---------------------------------------------------------------------------

alter table posts
  alter column hashtag_placement set default 'first_comment';

-- ---------------------------------------------------------------------------
-- Publish-ready.
--
-- Default false: a post has to be declared finished, never assumed to be. The
-- whole point is that nothing goes out by drifting into a slot.
-- ---------------------------------------------------------------------------

-- The backfill runs ONLY when the column is first created. A queued post can
-- legitimately be ready = false — that is the entire feature — so re-running
-- this migration must not sweep through and mark every queued post ready
-- again, undoing a decision made since.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'posts' and column_name = 'ready'
  ) then
    alter table posts add column ready boolean not null default false;

    -- Anything already committed to publishing was, by definition, ready.
    update posts
       set ready = true
     where status in ('queued', 'scheduled', 'publishing', 'published');
  end if;
end $$;

create index if not exists posts_ready_idx on posts (ready) where ready;

-- ---------------------------------------------------------------------------
-- Rough drafts are gone.
--
-- Two kinds of draft turned out to be one too many. The difference was that a
-- rough draft was hidden from the grid — exactly backwards for how this gets
-- used.
--
-- The enum VALUE stays. Dropping one from a Postgres enum means rebuilding the
-- type and every column using it, and the value costs nothing left in place;
-- what matters is that nothing creates them any more. Existing ones become
-- ordinary drafts, which is what they were always trying to be.
-- ---------------------------------------------------------------------------

update posts set status = 'preview_draft' where status = 'rough_draft';

alter table posts
  alter column status set default 'preview_draft';

notify pgrst, 'reload schema';
