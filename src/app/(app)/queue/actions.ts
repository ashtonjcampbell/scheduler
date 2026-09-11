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

/*
 * addToQueue and removeFromQueue are gone.
 *
 * They set and cleared a queue position, which was placement — and placement
 * stopped being a decision worth asking about once every post took a place in
 * the order when it was created. What is left is `setReady`, which answers the
 * only question that remains: does this publish when its turn comes.
 */

/**
 * Rewrite the whole queue order.
 *
 * Takes the complete list rather than a move instruction, so positions are
 * always contiguous and can never drift out of step with what is on screen.
 */
export async function reorderQueue(orderedIds: string[]): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  /*
   * One statement, not one per post.
   *
   * This was a loop of sequential updates, which is a dozen round trips for
   * what is conceptually a single edit — and dragging a tile is the action
   * most likely to be repeated quickly, so it is the worst place to be
   * wasteful. It was enough to exhaust the request budget on Cloudflare's free
   * tier and fail the whole page.
   *
   * It is also atomic now: the loop could stop half way and leave the queue in
   * an order nobody chose, which is exactly what running out of budget part
   * way through would have done.
   */
  const { error } = await supabase.rpc("reorder_queue", { ids: orderedIds });
  if (error) return { error: error.message };

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

/**
 * Park a post as a draft.
 *
 * A draft shows in the grid and can never publish. The old "rough draft",
 * hidden from the grid entirely, is gone: an unfinished post is most useful
 * precisely when you CAN see it sitting there while deciding what comes next.
 */
export async function setDraftState(
  postId: string,
  status: Extract<PostStatus, "idea" | "preview_draft">,
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

/**
 * Declare a post finished, or put it back to being a draft.
 *
 * This is the only thing that lets a post publish. Queue position decides when
 * its turn comes round; this decides whether it takes that turn or waves it on
 * to whatever is behind it.
 *
 * The completeness checks live here rather than on queueing, because this is
 * the moment the promise is made. Finding out at the slot that a post has no
 * photo is far too late — by then the only choices are publishing something
 * broken or silently doing nothing.
 */
export async function setReady(
  postId: string,
  ready: boolean,
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  // Being in the plan is not the same as being in the queue, but a post has
  // to be somewhere in the order before it can take a turn. Anything without a
  // place gets one at the end.
  if (ready) {
    const { data: existing } = await supabase
      .from("posts")
      .select("queue_position, status")
      .eq("id", postId)
      .single();

    if (existing && existing.queue_position === null && existing.status !== "scheduled") {
      const { data: last } = await supabase
        .from("posts")
        .select("queue_position")
        .not("queue_position", "is", null)
        .order("queue_position", { ascending: false })
        .limit(1);

      await supabase
        .from("posts")
        .update({
          schedule_mode: "queue",
          queue_position: (last?.[0]?.queue_position ?? -1) + 1,
        })
        .eq("id", postId);
    }
  }

  if (ready) {
    const { data: post } = await supabase
      .from("posts")
      .select("caption, status")
      .eq("id", postId)
      .single();

    if (post?.status === "published") {
      return { error: "That post has already gone out." };
    }

    const { count } = await supabase
      .from("post_photos")
      .select("*", { head: true, count: "exact" })
      .eq("post_id", postId);

    if (!count) return { error: "Add at least one photo before marking this ready." };

    if (!post?.caption?.trim()) {
      return { error: "Write a caption before marking this ready." };
    }
  }

  /*
   * Status follows readiness, and the place in the order is kept either way.
   *
   * "queued" now means exactly what it says — in the queue, will publish. A
   * draft keeps its position so the grid can still show it at the date it is
   * meant for, and can still be dragged around; it simply is not in the queue.
   * A post pinned to a fixed time keeps that status, since its placement was a
   * different decision.
   */
  const patch: { ready: boolean; status?: "queued" | "preview_draft" } = { ready };

  const { data: current } = await supabase
    .from("posts")
    .select("status")
    .eq("id", postId)
    .single();

  if (current?.status === "queued" || current?.status === "preview_draft") {
    patch.status = ready ? "queued" : "preview_draft";
  }

  const { error } = await supabase.from("posts").update(patch).eq("id", postId);
  if (error) return { error: error.message };

  revalidate(postId);
  return {};
}
