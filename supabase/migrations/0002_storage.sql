-- ============================================================================
-- Storage buckets
--
-- `uploads` - private. Untouched originals land here straight from the
--             browser. The worker downloads each one, processes it, and
--             deletes it. Nothing should live here for more than a minute.
--
-- `media`   - public read. Holds the finished colour-managed JPEGs.
--             It has to be publicly readable because Instagram's Content
--             Publishing API does not accept an uploaded file: it is given a
--             URL and fetches the image from it itself. Paths are UUIDs, so
--             the files are unguessable, but treat them as public.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'uploads',
    'uploads',
    false,
    -- Generous: these are camera originals, and they are deleted immediately
    -- after processing.
    104857600,  -- 100 MB
    array['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/avif']
  ),
  (
    'media',
    'media',
    true,
    -- Instagram rejects anything over 8 MB. Our pipeline targets well under
    -- that; this is a backstop.
    8388608,    -- 8 MB
    array['image/jpeg']
  )
on conflict (id) do update
set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Access. The signed-in user manages both buckets from the dashboard; the
-- worker uses the service-role key and bypasses all of this.
-- ---------------------------------------------------------------------------

drop policy if exists "uploads: owner full access" on storage.objects;
create policy "uploads: owner full access"
  on storage.objects for all to authenticated
  using (bucket_id = 'uploads')
  with check (bucket_id = 'uploads');

drop policy if exists "media: owner full access" on storage.objects;
create policy "media: owner full access"
  on storage.objects for all to authenticated
  using (bucket_id = 'media')
  with check (bucket_id = 'media');

-- Public read on `media` is granted by the bucket's `public` flag above;
-- this makes the intent explicit and survives the flag being toggled.
drop policy if exists "media: public read" on storage.objects;
create policy "media: public read"
  on storage.objects for select to anon
  using (bucket_id = 'media');
