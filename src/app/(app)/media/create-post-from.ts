"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/** Instagram's Content Publishing API caps a carousel at 10 images. */
const MAX_CAROUSEL = 10;

/**
 * Start a post from photos chosen in the media bank.
 *
 * The composer could already pick photos, but only after creating an empty
 * post — which is backwards from how you actually work: you look at the
 * photos first and the post follows from them.
 *
 * Selection order is preserved, so the first one picked is the one that lands
 * in the grid.
 */
export async function createPostFrom(photoIds: string[]): Promise<never | { error: string }> {
  if (photoIds.length === 0) return { error: "Pick at least one photo." };

  if (photoIds.length > MAX_CAROUSEL) {
    return {
      error: `Instagram allows at most ${MAX_CAROUSEL} images in a carousel — you picked ${photoIds.length}.`,
    };
  }

  const supabase = await supabaseServer();

  // Only ready photos can go on a post: an unprocessed one has no file for
  // Instagram to fetch, and an archived one no longer has its full-size file.
  const { data: usable, error: readError } = await supabase
    .from("photos")
    .select("id")
    .in("id", photoIds)
    .eq("status", "ready")
    .is("deleted_at", null)
    .not("storage_path", "is", null);

  if (readError) return { error: readError.message };

  const ready = new Set((usable ?? []).map((p) => p.id));
  const unusable = photoIds.filter((id) => !ready.has(id));

  if (unusable.length > 0) {
    return {
      error:
        unusable.length === photoIds.length
          ? "Those photos aren't ready to post yet."
          : `${unusable.length} of those aren't ready to post yet.`,
    };
  }

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ title: null })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const { error: linkError } = await supabase.from("post_photos").insert(
    photoIds.map((photo_id, position) => ({ post_id: post.id, photo_id, position })),
  );

  if (linkError) {
    // Don't leave an empty post behind if the photos could not be attached.
    await supabase.from("posts").delete().eq("id", post.id);
    return { error: linkError.message };
  }

  redirect(`/posts/${post.id}`);
}
