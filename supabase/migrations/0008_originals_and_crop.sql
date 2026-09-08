-- ============================================================================
-- Keep originals briefly, and record how a photo should be cropped
--
-- Originals used to be deleted seconds after conversion. That protected the
-- 1GB tier but made two things impossible: cropping a photo later without
-- re-compressing the already-compressed file, and re-reading a file whose
-- colour profile was missing and had to be guessed.
--
-- They are now kept for a short window — long enough to change your mind
-- while a photo is fresh, short enough that storage stays bounded, since only
-- recent uploads are held rather than the whole library.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table photos
  -- When the original was deleted. Null while it is still available, which is
  -- what tells the UI whether a lossless re-crop is still possible.
  add column if not exists original_removed_at timestamptz,

  -- Crop as fractions of the original, 0-1. All null means no crop.
  -- Stored rather than baked in so the crop can be adjusted while the
  -- original survives, and so the UI can show the current framing.
  add column if not exists crop_x numeric(6,5),
  add column if not exists crop_y numeric(6,5),
  add column if not exists crop_w numeric(6,5),
  add column if not exists crop_h numeric(6,5),

  -- Which Instagram shape the crop targets: '1:1', '4:5', '1.91:1', or null
  -- for a free crop. Kept for the UI; the fractions above are the truth.
  add column if not exists crop_aspect text,

  -- Set when the photo's colour profile was missing and the user has told us
  -- what it really was, so it can be re-read correctly instead of guessed.
  add column if not exists assumed_profile text
    check (assumed_profile is null or assumed_profile in ('srgb', 'p3', 'adobe-rgb')),

  -- Bumped to ask the worker to redo this photo from its original.
  add column if not exists reprocess_requested_at timestamptz;

-- Crop fractions only make sense together and inside the image.
do $$ begin
  alter table photos add constraint photos_crop_complete check (
    (crop_x is null and crop_y is null and crop_w is null and crop_h is null)
    or (
      crop_x is not null and crop_y is not null and crop_w is not null and crop_h is not null
      and crop_x >= 0 and crop_y >= 0
      and crop_w > 0 and crop_h > 0
      and crop_x + crop_w <= 1.00001
      and crop_y + crop_h <= 1.00001
    )
  );
exception when duplicate_object then null;
end $$;

create index if not exists photos_original_kept_idx
  on photos (processed_at) where upload_path is not null and original_removed_at is null;

-- ---------------------------------------------------------------------------
-- How long an original is kept after conversion.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists keep_originals_days smallint not null default 7;

notify pgrst, 'reload schema';
