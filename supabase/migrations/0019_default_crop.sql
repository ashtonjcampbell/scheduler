-- ============================================================================
-- Crop new photos to a chosen shape on the way in
--
-- Instagram reshapes anything that is not between 4:5 and 1.91:1, and reshapes
-- a whole carousel to match its first image. Left to itself that produces a
-- centre crop nobody chose and, for a landscape squeezed into a portrait, an
-- upscale that looks blurry.
--
-- So the crop happens here instead, to a shape set once. It is a STARTING
-- POINT, not a decision: the original is kept, so opening the cropper and
-- moving the box re-cuts from the full-resolution file with nothing lost.
--
-- Null means "leave photos as they are", which is the old behaviour.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table app_settings
  add column if not exists default_crop_aspect text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'app_settings' and constraint_name = 'app_settings_default_crop_aspect_check'
  ) then
    alter table app_settings
      add constraint app_settings_default_crop_aspect_check
      check (default_crop_aspect is null or default_crop_aspect in ('4:5', '1:1', '1.91:1'));
  end if;
end $$;

-- 4:5 is the tallest Instagram keeps, which is the most of the grid a photo
-- can occupy — the right default for an account whose work is the picture.
update app_settings set default_crop_aspect = '4:5' where default_crop_aspect is null;

notify pgrst, 'reload schema';
