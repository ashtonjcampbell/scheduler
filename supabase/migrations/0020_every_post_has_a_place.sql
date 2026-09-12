-- Give a place in the running order to the posts that never got one.
--
-- Starting a post from photos chosen in the media bank did not set a queue
-- position, so those posts appeared in the grid and then refused to be
-- dragged: a tile can only move if it has a position to move from. The owner
-- described it exactly right — "all the ones I started earlier work, new ones
-- don't" — because the broken path was the one they had switched to using.
--
-- The code is fixed; this is for the posts already made. They go to the END of
-- the order, oldest first, which is where they would have landed had they been
-- given a position when they were created.

with missing as (
  select
    id,
    row_number() over (order by created_at) as n
  from posts
  where queue_position is null
    and status in ('preview_draft', 'queued')
    and removed_from_instagram_at is null
),
top as (
  select coalesce(max(queue_position), -1) as highest from posts
)
update posts
set queue_position = top.highest + missing.n,
    schedule_mode = coalesce(schedule_mode, 'queue')
from missing, top
where posts.id = missing.id;
