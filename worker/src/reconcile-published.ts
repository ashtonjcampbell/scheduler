import { serviceClient, log } from "./lib/supabase.js";

/**
 * Notice when a published post has been deleted on Instagram.
 *
 * The grid mirrors the profile, so a post taken down on Instagram has to stop
 * counting as published here — otherwise the mirror shows a tile that is not
 * on the account any more, and the whole point of the preview is that it
 * matches.
 *
 * Each post is checked INDIVIDUALLY rather than by comparing against a listing.
 * A listing that comes back short — rate limited, paginated oddly, a bad
 * token — would make every post look deleted at once, and this marks things as
 * gone. One direct question per post cannot be wrong that way, and there are
 * only ever a handful of published posts to ask about.
 *
 * Error code 100 means the object does not exist. Anything else is a question
 * that could not be answered, and "could not ask" is never read as "deleted".
 */

const API_VERSION = process.env.IG_API_VERSION ?? "v23.0";

/** Nothing is marked on a run that cannot reach Instagram at all. */
const MAX_CHECKS = 50;

export async function reconcilePublished(): Promise<number> {
  const supabase = serviceClient();

  const { data: secrets } = await supabase
    .from("app_secrets")
    .select("ig_access_token")
    .single();

  const token = secrets?.ig_access_token;
  if (!token) return 0;

  const { data: posts } = await supabase
    .from("posts")
    .select("id, ig_media_id, ig_permalink")
    .eq("status", "published")
    .eq("was_dry_run", false)
    .is("removed_from_instagram_at", null)
    .not("ig_media_id", "is", null)
    .limit(MAX_CHECKS);

  if (!posts || posts.length === 0) return 0;

  const gone: string[] = [];

  for (const post of posts) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${post.ig_media_id}?fields=id&access_token=${token}`,
        { headers: { "User-Agent": "ig-scheduler" } },
      );

      if (response.ok) continue;

      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: number };
      };

      if (body.error?.code === 100) gone.push(post.id);
    } catch {
      // Unreachable is not the same as deleted. Leave it for the next run.
    }
  }

  if (gone.length === 0) return 0;

  const { error } = await supabase
    .from("posts")
    .update({ removed_from_instagram_at: new Date().toISOString() })
    .in("id", gone);

  if (error) {
    await log("warn", `Could not mark deleted posts: ${error.message}`);
    return 0;
  }

  await log(
    "info",
    `${gone.length} post(s) were deleted on Instagram — removed from the grid`,
  );

  return gone.length;
}

// Runnable on its own as well as from the publish job.
if (process.argv[1]?.endsWith("reconcile-published.ts")) {
  const count = await reconcilePublished();
  console.log(count > 0 ? `Marked ${count} post(s) as deleted.` : "Nothing to reconcile.");
}
