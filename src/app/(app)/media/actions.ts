"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

/**
 * Ask GitHub Actions to process the newly uploaded photos now.
 *
 * The token cannot go anywhere near the browser, so the browser uploads
 * straight to Supabase Storage and then calls this to ring the bell.
 *
 * This is an optimisation, not a requirement: a scheduled sweep picks up
 * anything pending every 20 minutes regardless. So a failure here is reported
 * as a slower wait, never as a lost upload.
 */
export async function requestProcessing(): Promise<{ started: boolean; message: string }> {
  const { GITHUB_REPO, GITHUB_DISPATCH_TOKEN } = serverEnv();

  /*
   * Every failure here used to return one identical message, which made a
   * real misconfiguration indistinguishable from a rejected request — the
   * uploads simply sat there and there was nothing to go on. Each case now
   * says which it was, and logs enough to find it in `wrangler tail`.
   */
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    console.warn(
      `[requestProcessing] not configured: repo=${GITHUB_REPO ? "set" : "MISSING"} ` +
        `token=${GITHUB_DISPATCH_TOKEN ? "set" : "MISSING"}`,
    );
    return {
      started: false,
      message: "Queued — instant processing isn't configured. Starts within 20 minutes.",
    };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          // GitHub rejects requests without one.
          "User-Agent": "ig-scheduler",
        },
        body: JSON.stringify({ event_type: "process-media" }),
      },
    );

    // GitHub answers 204 with no body on success.
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[requestProcessing] GitHub said ${response.status}: ${detail.slice(0, 300)}`);
      return {
        started: false,
        message: `Queued — GitHub refused the trigger (${response.status}). Starts within 20 minutes.`,
      };
    }

    return { started: true, message: "Processing — usually about a minute." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[requestProcessing] request failed: ${reason}`);
    return {
      started: false,
      message: "Queued — could not reach GitHub. Starts within 20 minutes.",
    };
  }
}

/**
 * Move a photo to the trash.
 *
 * Nothing is destroyed: the row keeps its files and can be restored. A
 * database trigger refuses if the photo belongs to a scheduled or published
 * post, so a live post can never lose its picture this way.
 */
export async function trashPhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", photoId)
    .is("deleted_at", null);

  if (error) return { error: friendlyError(error.message) };

  revalidatePath("/media");
  return {};
}

/** Take a photo back out of the trash. */
export async function restorePhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("photos")
    .update({ deleted_at: null })
    .eq("id", photoId);

  if (error) return { error: error.message };

  revalidatePath("/media");
  return {};
}

/**
 * Destroy a trashed photo and its files. There is no undo past this point,
 * which is why it only ever operates on photos already in the trash.
 */
export async function deleteForever(photoId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("storage_path, upload_path, deleted_at")
    .eq("id", photoId)
    .single();

  if (readError) return { error: readError.message };

  if (!photo.deleted_at) {
    return { error: "Move this photo to the trash first." };
  }

  // Row first: a trigger refuses if the photo is in use, so this is what
  // enforces the rule. Doing it in this order means a refusal leaves the
  // files untouched.
  const { error: deleteError } = await supabase.from("photos").delete().eq("id", photoId);
  if (deleteError) return { error: friendlyError(deleteError.message) };

  await removeFiles(photo.storage_path, photo.upload_path);

  revalidatePath("/media");
  return {};
}

/** Destroy everything currently in the trash. */
export async function emptyTrash(): Promise<{ error?: string; removed?: number }> {
  const supabase = await supabaseServer();

  const { data: trashed, error: readError } = await supabase
    .from("photos")
    .select("id, storage_path, upload_path")
    .not("deleted_at", "is", null);

  if (readError) return { error: readError.message };
  if (!trashed || trashed.length === 0) return { removed: 0 };

  let removed = 0;

  // One at a time so that a photo the database refuses to delete does not
  // take the whole operation down with it.
  for (const photo of trashed) {
    const { error } = await supabase.from("photos").delete().eq("id", photo.id);
    if (error) continue;

    await removeFiles(photo.storage_path, photo.upload_path);
    removed++;
  }

  revalidatePath("/media");
  return { removed };
}

/** Put a failed photo back in the queue. */
export async function retryPhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("photos")
    .update({ status: "pending", processing_error: null, claimed_at: null })
    .eq("id", photoId)
    .eq("status", "failed");

  if (error) return { error: error.message };

  await requestProcessing();
  revalidatePath("/media");
  return {};
}

export async function updateAltText(
  photoId: string,
  altText: string,
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const trimmed = altText.trim();
  const { error } = await supabase
    .from("photos")
    .update({ alt_text: trimmed.length > 0 ? trimmed : null })
    .eq("id", photoId);

  if (error) return { error: error.message };

  revalidatePath("/media");
  return {};
}

async function removeFiles(storagePath: string | null, uploadPath: string | null) {
  const supabase = await supabaseServer();

  if (storagePath) await supabase.storage.from("media").remove([storagePath]);
  if (uploadPath) await supabase.storage.from("uploads").remove([uploadPath]);
}

/** Database exceptions are raw SQL text; this one is worth saying properly. */
function friendlyError(message: string): string {
  return message.includes("scheduled or published")
    ? "This photo is part of a scheduled or published post."
    : message;
}
