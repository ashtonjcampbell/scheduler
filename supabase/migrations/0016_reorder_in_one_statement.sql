-- ============================================================================
-- Reorder the whole queue in a single statement
--
-- It used to be a loop: one round trip per post, run one after another. With
-- a dozen posts that is a dozen sequential requests for what is conceptually a
-- single edit — and dragging a tile across the grid is the one action most
-- likely to be repeated quickly, so it is the worst place to be wasteful.
-- On Cloudflare's free tier that was enough to exhaust the per-request budget
-- and fail the page outright.
--
-- One statement is also ATOMIC. The loop could stop half way and leave the
-- queue in an order nobody chose — a real risk, since the failure mode above
-- was precisely running out of budget part way through.
--
-- `security invoker` (the default) keeps row-level security applying to the
-- caller, exactly as the individual updates did.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

create or replace function reorder_queue(ids uuid[])
returns void
language sql
as $$
  update posts p
     set queue_position = ordered.position - 1
    from unnest(ids) with ordinality as ordered(id, position)
   where p.id = ordered.id
     -- Positions only mean anything for posts in the running order; a fixed
     -- time or an already-published post must not be shuffled by a drag.
     and p.status = 'queued';
$$;

grant execute on function reorder_queue(uuid[]) to authenticated;

notify pgrst, 'reload schema';
