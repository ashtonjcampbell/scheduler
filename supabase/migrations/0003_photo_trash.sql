-- ============================================================================
-- Photo trash
--
-- Deleting a photo used to remove the row and its stored files immediately.
-- Now it sets `deleted_at` and the photo moves to a trash view it can be
-- restored from. Files are only actually removed when the trash is emptied,
-- by hand or by the 30-day sweep.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table photos
  add column if not exists deleted_at timestamptz;

-- The media bank reads non-deleted photos on every page load, so that is the
-- case worth indexing; the trash view is opened rarely.
create index if not exists photos_live_idx
  on photos (created_at desc) where deleted_at is null;
create index if not exists photos_trashed_idx
  on photos (deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- A photo committed to a post must not vanish from under it.
--
-- The existing trigger covers hard deletes. Trashing is an UPDATE, so it
-- needs its own guard — otherwise the row survives but the media bank hides
-- it, and a scheduled post quietly loses its picture.
-- ---------------------------------------------------------------------------

create or replace function guard_photo_trashing()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1
      from post_photos pp
      join posts p on p.id = pp.post_id
      where pp.photo_id = new.id
        and p.status in ('scheduled', 'publishing', 'published')
    ) then
      raise exception
        'This photo belongs to a scheduled or published post and cannot be deleted';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists photos_guard_trashing on photos;
create trigger photos_guard_trashing
  before update on photos
  for each row execute function guard_photo_trashing();

-- ---------------------------------------------------------------------------
-- Trashed photos are not "available" for anything.
--
-- Without this a photo sitting in the trash would still count toward the
-- media bank's filters via any draft post it was attached to.
-- ---------------------------------------------------------------------------

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
from photos ph
where ph.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Make the API pick all of this up immediately rather than on its own
-- schedule. Without it a freshly created table can 404 for a while.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
