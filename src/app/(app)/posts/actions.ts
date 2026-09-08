"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { normaliseTag, validateTag } from "@/lib/hashtags";
import { MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";
import { CAPTION_LIMIT } from "@/lib/caption";
import type { HashtagPlacement, Post, PostStatus } from "@/lib/database.types";

/** Instagram's Content Publishing API caps a carousel at 10 images. */
const MAX_CAROUSEL = 10;

export async function createPost(): Promise<never> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("posts")
    .insert({ title: null })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create the post: ${error.message}`);

  redirect(`/posts/${data.id}`);
}

export async function updatePost(
  id: string,
  fields: {
    title?: string | null;
    caption?: string;
    hashtag_placement?: HashtagPlacement;
    status?: PostStatus;
  },
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  if (fields.caption !== undefined && fields.caption.length > CAPTION_LIMIT) {
    return { error: `Captions are limited to ${CAPTION_LIMIT} characters.` };
  }

  // Typed rather than a loose Record: the Supabase client rejects an index
  // signature, and a mistyped column name should fail here rather than at
  // runtime.
  const patch: Partial<
    Pick<Post, "title" | "caption" | "hashtag_placement" | "status">
  > = {};
  if (fields.title !== undefined) patch.title = fields.title?.trim() || null;
  if (fields.caption !== undefined) patch.caption = fields.caption;
  if (fields.hashtag_placement !== undefined) {
    patch.hashtag_placement = fields.hashtag_placement;
  }
  if (fields.status !== undefined) patch.status = fields.status;

  const { error } = await supabase.from("posts").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/posts/${id}`);
  revalidatePath("/posts");
  return {};
}

export async function deletePost(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  // A published post is a record of something that actually happened; losing
  // it would leave the grid preview lying about the account's history.
  const { data: post } = await supabase.from("posts").select("status").eq("id", id).single();

  if (post?.status === "published") {
    return { error: "Published posts cannot be deleted." };
  }

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/posts");
  return {};
}

// ---------------------------------------------------------------------------
// Photos on a post
// ---------------------------------------------------------------------------

/**
 * Replace the post's photo set, in the given order.
 *
 * Written as a whole-set replace rather than add/remove/reorder verbs: the
 * composer always knows the full intended order, and this way positions can
 * never drift out of sync with what is on screen.
 */
export async function setPostPhotos(
  postId: string,
  photoIds: string[],
): Promise<{ error?: string }> {
  if (photoIds.length > MAX_CAROUSEL) {
    return {
      error: `Instagram allows at most ${MAX_CAROUSEL} images in a carousel.`,
    };
  }

  const supabase = await supabaseServer();

  const { error: clearError } = await supabase
    .from("post_photos")
    .delete()
    .eq("post_id", postId);

  if (clearError) return { error: clearError.message };

  if (photoIds.length > 0) {
    const { error } = await supabase.from("post_photos").insert(
      photoIds.map((photo_id, position) => ({ post_id: postId, photo_id, position })),
    );

    if (error) {
      return {
        error: error.message.includes("carousels are capped")
          ? `Instagram allows at most ${MAX_CAROUSEL} images in a carousel.`
          : error.message,
      };
    }
  }

  revalidatePath(`/posts/${postId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Hashtags on a post
// ---------------------------------------------------------------------------

export type PostTagInput = { tag: string; hashtagId: string | null };

/**
 * Replace the post's hashtags, in order.
 *
 * Stores the literal tag text alongside the library id it came from, so
 * renaming or deleting a library entry later cannot rewrite what a post
 * published. A tag with a null id is a deliberate one-off.
 */
export async function setPostHashtags(
  postId: string,
  tags: PostTagInput[],
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const cleaned: PostTagInput[] = [];
  const seen = new Set<string>();

  for (const entry of tags) {
    const tag = normaliseTag(entry.tag);
    if (!tag) continue;

    const invalid = validateTag(tag);
    if (invalid) return { error: `#${entry.tag}: ${invalid.toLowerCase()}` };

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    cleaned.push({ tag, hashtagId: entry.hashtagId });
  }

  if (cleaned.length > MAX_HASHTAGS_PER_POST) {
    return { error: `Instagram allows at most ${MAX_HASHTAGS_PER_POST} hashtags.` };
  }

  const { error: clearError } = await supabase
    .from("post_hashtags")
    .delete()
    .eq("post_id", postId);

  if (clearError) return { error: clearError.message };

  if (cleaned.length > 0) {
    const { error } = await supabase.from("post_hashtags").insert(
      cleaned.map((entry, position) => ({
        post_id: postId,
        tag: entry.tag,
        hashtag_id: entry.hashtagId,
        position,
      })),
    );

    if (error) return { error: error.message };
  }

  revalidatePath(`/posts/${postId}`);
  return {};
}

/** Save a one-off tag into the library, so a good find need not be retyped. */
export async function saveTagToLibrary(
  tag: string,
  categoryId: string | null,
): Promise<{ error?: string; id?: string }> {
  const supabase = await supabaseServer();

  const cleaned = normaliseTag(tag);
  if (!cleaned) return { error: "Nothing to save" };

  const invalid = validateTag(cleaned);
  if (invalid) return { error: invalid };

  const { data: existing } = await supabase.from("hashtags").select("id, tag");
  const already = (existing ?? []).find(
    (row) => row.tag.toLowerCase() === cleaned.toLowerCase(),
  );

  if (already) return { id: already.id };

  const { data, error } = await supabase
    .from("hashtags")
    .insert({ tag: cleaned, category_id: categoryId })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return { id: data.id };
}
