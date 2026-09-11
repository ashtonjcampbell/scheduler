import { serviceClient, log } from "./lib/supabase.js";

/**
 * Pull how every post actually performed into `media_performance`.
 *
 * Independent of dry run: dry run stops the app WRITING to Instagram and has
 * nothing to do with reading it.
 *
 * Insights need one API call per post, so the work is spread rather than done
 * all at once. A first run backfills what it can inside `MAX_INSIGHT_CALLS` and
 * the next run continues; nothing is lost, the page just fills in over a few
 * hours. Steady state is a handful of calls: a new post, plus the recent ones
 * whose numbers are still moving.
 */

const API_VERSION = process.env.IG_API_VERSION ?? "v23.0";

/** How far back to bother. Older posts went to a different-sized audience. */
const HISTORY_MONTHS = 24;

/** A post's numbers keep climbing for weeks; after this they are settled. */
const STILL_MOVING_DAYS = 45;

/** Don't re-ask about the same settled post more than once a day. */
const REFRESH_AFTER_HOURS = 20;

/** Ceiling per run, so a backfill cannot exhaust the hourly rate limit. */
const MAX_INSIGHT_CALLS = 120;

/** How many insight calls to have in flight at once. */
const CONCURRENCY = 6;

/**
 * Everything worth having. Instagram rejects the WHOLE call if one metric does
 * not apply to that media type, so a failure falls back to the core set rather
 * than losing the post entirely.
 */
const FULL_METRICS = "reach,views,saved,shares,total_interactions,profile_visits,follows";
const CORE_METRICS = "reach";

type Media = {
  id: string;
  timestamp: string;
  media_type?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
};

export async function syncPerformance(): Promise<{ seen: number; measured: number }> {
  const supabase = serviceClient();

  const [{ data: settings }, { data: secrets }] = await Promise.all([
    supabase.from("app_settings").select("ig_user_id").single(),
    supabase.from("app_secrets").select("ig_access_token").single(),
  ]);

  if (!settings?.ig_user_id || !secrets?.ig_access_token) return { seen: 0, measured: 0 };

  const token = secrets.ig_access_token;
  const cutoff = Date.now() - HISTORY_MONTHS * 30.4 * 24 * 60 * 60 * 1000;

  // ---- what exists ------------------------------------------------------
  const media: Media[] = [];
  let next: string | null =
    `https://graph.facebook.com/${API_VERSION}/${settings.ig_user_id}/media` +
    `?fields=id,timestamp,media_type,permalink,like_count,comments_count&limit=100&access_token=${token}`;

  // The list is newest first, so the first page older than the cutoff ends it.
  for (let page = 0; page < 20 && next; page++) {
    const response = await fetch(next, { headers: { "User-Agent": "ig-scheduler" } });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      await log("warn", `Could not list posts for performance: ${error?.message ?? response.status}`);
      break;
    }

    const items = (body.data ?? []) as Media[];
    media.push(...items.filter((m) => new Date(m.timestamp).getTime() >= cutoff));

    if (items.some((m) => new Date(m.timestamp).getTime() < cutoff)) break;
    next = ((body.paging as { next?: string } | undefined)?.next as string) ?? null;
  }

  if (media.length === 0) return { seen: 0, measured: 0 };

  // ---- what we already know --------------------------------------------
  const { data: known } = await supabase
    .from("media_performance")
    .select("id, reach, fetched_at")
    .gte("posted_at", new Date(cutoff).toISOString());

  const seen = new Map((known ?? []).map((row) => [row.id, row]));

  const now = Date.now();
  const needsInsights = media.filter((m) => {
    const row = seen.get(m.id);
    if (!row) return true;
    if (row.reach == null) return true;

    const age = now - new Date(m.timestamp).getTime();
    if (age > STILL_MOVING_DAYS * 24 * 60 * 60 * 1000) return false;

    return now - new Date(row.fetched_at).getTime() > REFRESH_AFTER_HOURS * 60 * 60 * 1000;
  });

  // Oldest first: a backfill then works forward through history, so a run that
  // hits the ceiling leaves a contiguous gap at the recent end rather than
  // holes scattered through the record.
  needsInsights.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const batch = needsInsights.slice(0, MAX_INSIGHT_CALLS);

  const insights = new Map<string, Record<string, number>>();

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (m) => {
        const values = await fetchInsights(m.id, token);
        if (values) insights.set(m.id, values);
      }),
    );
  }

  // ---- store ------------------------------------------------------------
  // Counts come free with the listing, so every post is written even when its
  // insights were not fetched this run.
  const rows = media.map((m) => {
    const measured = insights.get(m.id);

    return {
      id: m.id,
      posted_at: m.timestamp,
      media_type: m.media_type ?? null,
      permalink: m.permalink ?? null,
      like_count: m.like_count ?? null,
      comments_count: m.comments_count ?? null,
      ...(measured
        ? {
            reach: measured.reach ?? null,
            views: measured.views ?? null,
            saved: measured.saved ?? null,
            shares: measured.shares ?? null,
            total_interactions: measured.total_interactions ?? null,
            profile_visits: measured.profile_visits ?? null,
            follows: measured.follows ?? null,
            fetched_at: new Date().toISOString(),
          }
        : {}),
    };
  });

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from("media_performance").upsert(rows.slice(i, i + 100));
    if (error) {
      await log("warn", `Could not store performance: ${error.message}`);
      return { seen: media.length, measured: insights.size };
    }
  }

  await supabase
    .from("app_settings")
    .update({ performance_synced_at: new Date().toISOString() })
    .eq("id", true);

  const remaining = needsInsights.length - batch.length;
  if (remaining > 0) {
    await log("info", `Performance: ${insights.size} measured, ${remaining} still to do`);
  }

  return { seen: media.length, measured: insights.size };
}

async function fetchInsights(
  mediaId: string,
  token: string,
): Promise<Record<string, number> | null> {
  for (const metrics of [FULL_METRICS, CORE_METRICS]) {
    const url =
      `https://graph.facebook.com/${API_VERSION}/${mediaId}/insights` +
      `?metric=${metrics}&access_token=${token}`;

    try {
      const response = await fetch(url, { headers: { "User-Agent": "ig-scheduler" } });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) continue;

      const values: Record<string, number> = {};
      for (const row of (body.data ?? []) as Array<{ name: string; values?: Array<{ value: number }> }>) {
        const value = row.values?.[0]?.value;
        if (typeof value === "number") values[row.name] = value;
      }

      return values;
    } catch {
      // Try the smaller ask, then give up on this post until the next run.
    }
  }

  return null;
}

// Runnable on its own as well as from the publish job.
if (process.argv[1]?.endsWith("sync-performance.ts")) {
  const { seen, measured } = await syncPerformance();
  console.log(`Saw ${seen} post(s); measured ${measured} this run.`);
}
