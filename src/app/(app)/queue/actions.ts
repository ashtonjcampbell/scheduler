"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import type { PostStatus } from "@/lib/database.types";

/**
 * Scheduling.
 *
 * A queued post deliberately has NO stored time. Its slot is worked out from
 * the timetable whenever anything is displayed or published, which is what
 * makes the queue self-healing: reorder it, pause a slot, or miss a publish,
 * and the next calculation simply uses the next free slot. Storing assignments
 * would mean recomputing them on every change and would leave stale, backdated
 * times behind whenever that recompute was missed — the exact failure the
 * brief asks to avoid.
 *
 * A fixed post is the opposite: it names its instant and the queue flows
 * around it.
 */

function revalidate(postId?: string) {
  revalidatePath("/queue");
  revalidatePath("/posts");
  revalidatePath("/");
  if (postId) revalidatePath(`/posts/${postId}`);
}

export async function addToQueue(postId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { data: post } = await supabase
    .from("posts")
    .select("status")
    .eq("id", postId)
    .single();

  if (post?.status === "published") {
    return { error: "That post has already gone out." };
  }

  // A post with no photos cannot be published, and finding that out at the
  // slot is far too late.
  const { count } = await supabase
    .from("post_photos")
    .select("*", { head: true, count: "exact" })
    .eq("post_id", postId);

  if (!count) return { error: "Add at least one photo before queueing this." };

  const { data: last } = await supabase
    .from("posts")
    .select("queue_position")
    .eq("status", "queued")
    .order("queue_position", { ascending: false })
    .limit(1);

  const next = (last?.[0]?.queue_position ?? -1) + 1;

  const { error } = await supabase
    .from("posts")
    .update({
      status: "queued",
      schedule_mode: "queue",
      queue_position: next,
      // A queued post has no committed time; it takes whatever slot is free
      // when its turn comes.
      scheduled_for: null,
      slot_id: null,
    })
    .eq("id", postId);

  if (error) return { error: error.message };

  revalidate(postId);
  return {};
}

/** Take a post out of the queue, back to being a draft. */
export async function removeFromQueue(
  postId: string,
  to: PostStatus = "preview_draft",
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("posts")
    .update({ status: to, queue_position: null, scheduled_for: null, slot_id: null })
    .eq("id", postId);

  if (error) return { error: error.message };

  revalidate(postId);
  return {};
}

/**
 * Rewrite the whole queue order.
 *
 * Takes the complete list rather than a move instruction, so positions are
 * always contiguous and can never drift out of step with what is on screen.
 */
export async function reorderQueue(orderedIds: string[]): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  // Sequential rather than parallel: these are a handful of rows, and doing
  // them in order makes a partial failure leave a sane prefix.
  for (const [position, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from("posts")
      .update({ queue_position: position })
      .eq("id", id)
      .eq("status", "queued");

    if (error) return { error: error.message };
  }

  revalidate();
  return {};
}

/** Pin a post to an exact instant, outside the rolling queue. */
export async function scheduleFixed(
  postId: string,
  isoInstant: string,
): Promise<{ error?: string }> {
  const when = new Date(isoInstant);

  if (Number.isNaN(when.getTime())) return { error: "That isn't a valid date and time." };
  if (when.getTime() < Date.now()) return { error: "That time has already passed." };

  const supabase = await supabaseServer();

  const { count } = await supabase
    .from("post_photos")
    .select("*", { head: true, count: "exact" })
    .eq("post_id", postId);

  if (!count) return { error: "Add at least one photo before scheduling this." };

  const { error } = await supabase
    .from("posts")
    .update({
      status: "scheduled",
      schedule_mode: "fixed",
      scheduled_for: when.toISOString(),
      queue_position: null,
      slot_id: null,
    })
    .eq("id", postId);

  if (error) return { error: error.message };

  revalidate(postId);
  return {};
}

/** Set a draft state: rough drafts are hidden from the grid, previews are not. */
export async function setDraftState(
  postId: string,
  status: Extract<PostStatus, "idea" | "rough_draft" | "preview_draft">,
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("posts")
    .update({ status, queue_position: null, scheduled_for: null, slot_id: null })
    .eq("id", postId);

  if (error) return { error: error.message };

  revalidate(postId);
  return {};
}
