-- ============================================================================
-- A draft holding a place is not "queued"
--
-- Giving every draft a position in the running order also gave it the 'queued'
-- status, because that was the only status that carried a position. So the app
-- told its owner that eleven drafts were queued when none of them were, and
-- nothing short of reading the code could show otherwise.
--
-- Status now says the plain thing:
--
--   preview_draft + a position  = planned, will NOT publish
--   queued        + a position  = in the queue, WILL publish at its turn
--
-- A position is no longer evidence of anything except a place in the order.
-- `ready` and status move together from here; `ready` stays as the guard the
-- worker checks at the moment of claiming, which status alone cannot give.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

update posts
   set status = 'preview_draft'
 where status = 'queued'
   and ready = false;

-- Keep the two from ever disagreeing in the other direction either.
update posts
   set ready = false
 where status = 'preview_draft'
   and ready = true;

-- ---------------------------------------------------------------------------
-- Reordering has to move drafts too — they are most of the running order.
-- ---------------------------------------------------------------------------

create or replace function reorder_queue(ids uuid[])
returns void
language sql
as $$
  update posts p
     set queue_position = ordered.position - 1
    from unnest(ids) with ordinality as ordered(id, position)
   where p.id = ordered.id
     -- Both halves of the running order. A fixed time or a published post is
     -- still not the queue's to shuffle.
     and p.status in ('queued', 'preview_draft');
$$;

grant execute on function reorder_queue(uuid[]) to authenticated;

notify pgrst, 'reload schema';
