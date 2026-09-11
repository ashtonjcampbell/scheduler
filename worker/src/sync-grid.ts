import { serviceClient, log } from "./lib/supabase.js";

/**
 * Pull what is already on the Instagram grid into a local cache.
 *
 * So the preview can show posts still to come sitting above the ones already
 * live, which is the only way to judge how the grid will actually look.
 *
 * Independent of dry run: dry run stops the app WRITING to Instagram, it has
 * nothing to do with reading. As soon as the account is connected this works,
 * whether or not anything is publishing for real.
 */

const API_VERSION = process.env.IG_API_VERSION ?? "v23.0";

/** Two full rows beyond a screenful is plenty of context for a grid preview. */
const HOW_MANY = 36;

export async function syncGrid(): Promise<number> {
  const supabase = serviceClient();

  const [{ data: settings }, { data: secrets }] = await Promise.all([
    supabase.from("app_settings").select("ig_user_id").single(),
    supabase.from("app_secrets").select("ig_access_token").single(),
  ]);

  if (!settings?.ig_user_id || !secrets?.ig_access_token) return 0;

  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${settings.ig_user_id}/media`);
  url.searchParams.set(
    "fields",
    "id,permalink,media_type,media_url,thumbnail_url,caption,timestamp",
  );
  url.searchParams.set("limit", String(HOW_MANY));
  url.searchParams.set("access_token", secrets.ig_access_token);

  const response = await fetch(url, { headers: { "User-Agent": "ig-scheduler" } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    await log("warn", `Could not refresh the Instagram grid: ${error?.message ?? response.status}`);
    return 0;
  }

  const items = (body.data ?? []) as Array<{
    id: string;
    permalink?: string;
    media_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    caption?: string;
    timestamp?: string;
  }>;

  if (items.length === 0) return 0;

  const { error } = await supabase.from("instagram_media").upsert(
    items.map((item) => ({
      id: item.id,
      permalink: item.permalink ?? null,
      media_type: item.media_type ?? null,
      // A video's own URL is not an image; its thumbnail is what a grid shows.
      media_url: item.media_url ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      caption: item.caption ?? null,
      posted_at: item.timestamp ?? null,
      fetched_at: new Date().toISOString(),
    })),
  );

  if (error) {
    await log("warn", `Could not store the Instagram grid: ${error.message}`);
    return 0;
  }

  await supabase
    .from("app_settings")
    .update({ grid_synced_at: new Date().toISOString() })
    .eq("id", true);

  return items.length;
}

// Runnable on its own as well as from the publish job.
if (process.argv[1]?.endsWith("sync-grid.ts")) {
  const count = await syncGrid();
  console.log(count > 0 ? `Refreshed ${count} post(s) from Instagram.` : "Nothing to refresh.");
}
