-- ============================================================================
-- Every post that is not an idea takes a place in the running order
--
-- Placement used to be a button. That made "in the queue" mean two things at
-- once — a post could be in it and still never publish — so the word stopped
-- carrying any information.
--
-- Now placement is automatic and invisible: a post joins the order when it is
-- created, and `ready` alone decides whether it publishes when its turn comes.
-- "In the queue" means what it sounds like again.
--
-- Existing drafts had no position, so without this they would keep their old
-- behaviour and never appear in the grid at a date.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

do $$
declare
  next_position integer;
begin
  select coalesce(max(queue_position), -1) + 1
    into next_position
    from posts;

  -- Oldest first, so the order they were written in becomes the order they
  -- are planned in — the only defensible guess at intent.
  update posts p
     set status = 'queued',
         schedule_mode = 'queue',
         queue_position = next_position + ordered.offset
    from (
      select id, row_number() over (order by created_at) - 1 as offset
        from posts
       where status = 'preview_draft'
         and queue_position is null
    ) as ordered
   where p.id = ordered.id;
end $$;

notify pgrst, 'reload schema';
