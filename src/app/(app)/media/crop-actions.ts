"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requestProcessing } from "./actions";

export type CropInput = {
  x: number;
  y: number;
  w: number;
  h: number;
  aspect: string | null;
};

/**
 * Save a crop and re-run the photo from its original.
 *
 * Re-running rather than cropping the delivered file keeps this lossless: the
 * crop, the colour conversion and the resize all happen in one pass from the
 * source. That is only possible while the original still exists, which is why
 * originals are kept for a window rather than deleted on sight.
 */
export async function setCrop(
  photoId: string,
  crop: CropInput | null,
): Promise<{ error?: string; message?: string }> {
  const supabase = await supabaseServer();

  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("upload_path, original_removed_at, status")
    .eq("id", photoId)
    .single();

  if (readError) return { error: readError.message };

  if (!photo.upload_path) {
    return {
      error: photo.original_removed_at
        ? "The original was deleted, so this photo can no longer be re-cropped. Upload it again to change the framing."
        : "This photo has no original to crop from.",
    };
  }

  if (crop) {
    // Guard here as well as in the database: a crop outside the image would
    // otherwise fail deep in the worker, where the only sign is a failed photo.
    const inside =
      crop.x >= 0 && crop.y >= 0 && crop.w > 0 && crop.h > 0 &&
      crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001;

    if (!inside) return { error: "That crop falls outside the photo." };
  }

  const { error } = await supabase
    .from("photos")
    .update({
      crop_x: crop?.x ?? null,
      crop_y: crop?.y ?? null,
      crop_w: crop?.w ?? null,
      crop_h: crop?.h ?? null,
      crop_aspect: crop?.aspect ?? null,
      // Back into the queue. The worker picks up anything pending that still
      // has an original.
      status: "pending",
      processing_error: null,
      claimed_at: null,
      reprocess_requested_at: new Date().toISOString(),
    })
    .eq("id", photoId);

  if (error) {
    return {
      error: error.message.includes("photos_crop_complete")
        ? "That crop falls outside the photo."
        : error.message,
    };
  }

  const dispatch = await requestProcessing();

  revalidatePath("/media");
  return {
    message: dispatch.started
      ? "Re-cropping — about half a minute."
      : dispatch.message,
  };
}

/**
 * Re-read a photo whose colour profile had to be guessed.
 *
 * Sharp assumes sRGB for an untagged file. When that is wrong — an Adobe RGB
 * export that lost its tag — the photo looks flat, which is the exact problem
 * this app exists to fix. This states what the file really is and re-runs it
 * from the original.
 */
export async function setAssumedProfile(
  photoId: string,
  profile: "srgb" | "p3" | "adobe-rgb" | null,
): Promise<{ error?: string; message?: string }> {
  const supabase = await supabaseServer();

  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("upload_path, original_removed_at")
    .eq("id", photoId)
    .single();

  if (readError) return { error: readError.message };

  if (!photo.upload_path) {
    return {
      error: photo.original_removed_at
        ? "The original was deleted, so the colour can no longer be re-read. Upload it again."
        : "This photo has no original to re-read.",
    };
  }

  const { error } = await supabase
    .from("photos")
    .update({
      assumed_profile: profile,
      status: "pending",
      processing_error: null,
      claimed_at: null,
      reprocess_requested_at: new Date().toISOString(),
    })
    .eq("id", photoId);

  if (error) return { error: error.message };

  const dispatch = await requestProcessing();

  revalidatePath("/media");
  return {
    message: dispatch.started ? "Re-reading the colour — about half a minute." : dispatch.message,
  };
}
