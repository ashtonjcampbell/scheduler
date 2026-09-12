import "server-only";
import type { supabaseServer } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * The fields every new post needs, in one place.
 *
 * There are three ways to start a post — the New post button, duplicating an
 * existing one, and picking photos in the media bank — and for a day the third
 * quietly made posts with no place in the running order. They appeared in the
 * grid and then refused to be dragged, because a tile can only be moved if it
 * has a position to move from. Two of the three had the right code; the third
 * had never been updated, and nothing connected them.
 *
 * So the fields live here rather than being written out three times. Starting
 * a post in a new way now means calling this, and a post that cannot be
 * arranged is not a thing the app can accidentally produce.
 */
export async function newPostFields(supabase: Client) {
  return {
    /*
     * A draft with a PLACE, not a place in the QUEUE.
     *
     * It cannot publish until it is finished, but it has a tile and a spot in
     * the order from the moment it exists — which is what makes the grid
     * useful for deciding what comes next, rather than a view of only the
     * things already done.
     */
    status: "preview_draft" as const,
    schedule_mode: "queue" as const,
    queue_position: await nextPosition(supabase),
  };
}

/** The end of the running order. New posts go last, never first. */
export async function nextPosition(supabase: Client): Promise<number> {
  const { data } = await supabase
    .from("posts")
    .select("queue_position")
    .not("queue_position", "is", null)
    .order("queue_position", { ascending: false })
    .limit(1);

  return (data?.[0]?.queue_position ?? -1) + 1;
}
