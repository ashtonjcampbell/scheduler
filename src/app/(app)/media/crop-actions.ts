"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requestProcessing } from "./actions";
import { autoCrop, type CropAspect } from "@/lib/crop";

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

/**
 * Crop every uncropped photo on a post to one shape.
 *
 * The shape guard refuses a carousel whose photos disagree, and fixing ten
 * photos one at a time to say the same thing each time is the sort of work a
 * tool should do for you.
 *
 * ONLY photos that have never been cropped. Their delivered file is the whole
 * original, just resized, so its aspect ratio is the original's — which is
 * what makes the crop box calculable from the numbers to hand. A photo that
 * has already been cropped is a decision someone made, and recalculating from
 * its cropped dimensions would measure against the wrong picture entirely.
 */
export async function cropUncroppedTo(
  postId: string,
  aspect: CropAspect,
): Promise<{ error?: string; cropped?: number; skipped?: number }> {
  const supabase = await supabaseServer();

  const { data: links } = await supabase
    .from("post_photos")
    .select("photo_id")
    .eq("post_id", postId);

  const ids = (links ?? []).map((l) => l.photo_id);
  if (ids.length === 0) return { cropped: 0, skipped: 0 };

  const { data: photos, error } = await supabase
    .from("photos")
    .select("id, width, height, crop_w, crop_aspect, upload_path, original_removed_at")
    .in("id", ids);

  if (error) return { error: error.message };

  let cropped = 0;
  let skipped = 0;

  for (const photo of photos ?? []) {
    if (photo.crop_aspect === aspect) continue;

    // Already framed by hand, or no original left to re-cut from.
    if (photo.crop_w !== null || !photo.upload_path || photo.original_removed_at) {
      skipped++;
      continue;
    }

    if (!photo.width || !photo.height) {
      skipped++;
      continue;
    }

    const box = autoCrop(photo.width, photo.height, aspect);

    // Already the right shape: record the choice without re-running the file.
    if (!box) {
      await supabase.from("photos").update({ crop_aspect: aspect }).eq("id", photo.id);
      cropped++;
      continue;
    }

    const result = await setCrop(photo.id, { ...box, aspect });
    if (result.error) skipped++;
    else cropped++;
  }

  revalidatePath(`/posts/${postId}`);
  revalidatePath("/media");
  return { cropped, skipped };
}

/**
 * A short-lived URL for the photo's untouched original.
 *
 * The cropper has to draw its box over the ORIGINAL, because that is what the
 * stored box measures. Showing the delivered file instead looks reasonable
 * right up until a photo has been cropped once — after that the two stop
 * corresponding, and a 4:5 crop reopens as a box covering five sixths of an
 * image that is already 4:5. Which is what it did.
 *
 * Signed rather than public: originals live in a private bucket, and they are
 * the full-resolution files. Ten minutes is longer than anyone spends framing
 * one photo and short enough that a copied link is worthless by the time it
 * travels anywhere.
 */
export async function originalPhotoUrl(
  photoId: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await supabaseServer();

  const { data: photo, error } = await supabase
    .from("photos")
    .select("upload_path, original_removed_at")
    .eq("id", photoId)
    .single();

  if (error) return { error: error.message };

  if (!photo.upload_path || photo.original_removed_at) {
    return { error: "The original is gone, so this photo can no longer be re-cropped." };
  }

  const { data, error: signError } = await supabase.storage
    .from("uploads")
    .createSignedUrl(photo.upload_path, 600);

  if (signError || !data?.signedUrl) {
    return { error: signError?.message ?? "Could not open the original." };
  }

  return { url: data.signedUrl };
}
