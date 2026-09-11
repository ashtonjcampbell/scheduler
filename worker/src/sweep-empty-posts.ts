import { serviceClient, log } from "./lib/supabase.js";

/**
 * Clear away posts that were started and never became anything.
 *
 * Creating a post makes a row immediately, so an abandoned click leaves an
 * empty shell cluttering the grid and the posts list for ever.
 *
 * This deletes, so the rules are deliberately timid:
 *
 *  EMPTY MEANS EMPTY — no photos, no caption, no title, no hashtags. Not "no
 *  caption". A post with nine photos and no words yet is someone part-way
 *  through, and deleting it would destroy real work; there is no version of
 *  this feature worth that. A post with none of the four is unambiguously
 *  abandoned, and that is the only case touched.
 *
 *  NEVER ANYTHING PLACED OR PUBLISHED. Queued, scheduled, publishing and
 *  published posts are out of scope regardless of how empty they look.
 *
 *  A DAY'S GRACE. Saving is deliberate now, so a post being edited right now
 *  has an empty row until the first save — and an afternoon of work sitting
 *  unsaved in an open tab must not be swept out from under it.
 */

/** How long an empty post gets before it counts as abandoned. */
const GRACE_HOURS = 24;

export async function sweepEmptyPosts(): Promise<number> {
  const supabase = serviceClient();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from("posts")
    .select("id, title, caption, created_at, updated_at")
    .in("status", ["idea", "rough_draft", "preview_draft"])
    .lt("created_at", cutoff)
    .lt("updated_at", cutoff);

  if (error) {
    await log("warn", `Could not look for empty posts: ${error.message}`);
    return 0;
  }

  const textless = (candidates ?? []).filter(
    (post) => !post.caption?.trim() && !post.title?.trim(),
  );

  if (textless.length === 0) return 0;

  const ids = textless.map((p) => p.id);

  // Anything attached at all means this was worked on, so it stays.
  const [{ data: photos }, { data: hashtags }] = await Promise.all([
    supabase.from("post_photos").select("post_id").in("post_id", ids),
    supabase.from("post_hashtags").select("post_id").in("post_id", ids),
  ]);

  const touched = new Set([
    ...(photos ?? []).map((row) => row.post_id),
    ...(hashtags ?? []).map((row) => row.post_id),
  ]);

  const empty = ids.filter((id) => !touched.has(id));
  if (empty.length === 0) return 0;

  const { error: deleteError } = await supabase.from("posts").delete().in("id", empty);

  if (deleteError) {
    await log("warn", `Could not remove empty posts: ${deleteError.message}`);
    return 0;
  }

  await log("info", `Removed ${empty.length} empty post(s) never filled in`);
  return empty.length;
}

// Runnable on its own as well as from the publish job.
if (process.argv[1]?.endsWith("sweep-empty-posts.ts")) {
  const removed = await sweepEmptyPosts();
  console.log(removed > 0 ? `Removed ${removed} empty post(s).` : "Nothing to remove.");
}
