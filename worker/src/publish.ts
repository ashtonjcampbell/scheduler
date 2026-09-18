import { serviceClient, log } from "./lib/supabase.js";
import { publish, publishingLimitRemaining, InstagramError } from "./lib/instagram.js";
// Shared with the app so the worker and the queue page can never disagree
// about whose turn it is.
import { syncGrid } from "./sync-grid.js";
import { syncPerformance } from "./sync-performance.js";
import { sweepEmptyPosts } from "./sweep-empty-posts.js";
import { reconcilePublished } from "./reconcile-published.js";
import { dueQueued, QUEUE_LOOKBACK_HOURS } from "../../src/lib/queue";
import { renderHashtags } from "../../src/lib/hashtags";

/**
 * Publishes whatever is due.
 *
 * Runs every 15 minutes. GitHub's cron is best-effort and can be delayed, so
 * "due" means "its moment has passed", not "its moment is now" — a post whose
 * slot went by while the runner was queued still goes out, it does not wait a
 * week.
 *
 * While dry run is on, everything happens except the Instagram calls: the post
 * is claimed, its exact payload is worked out and written to the log, and it
 * is marked published with `was_dry_run` set. That makes the whole path
 * testable before the account is ever connected.
 */

/** A post claimed longer ago than this is assumed abandoned by a dead run. */
const STALE_CLAIM_MINUTES = 30;

/** Publish at most this many per run, so one run cannot drain a whole backlog. */
const MAX_PER_RUN = 5;

async function main() {
  const supabase = serviceClient();

  await releaseStaleClaims();

  const { data: settings, error: settingsError } = await supabase
    .from("app_settings")
    .select("dry_run, ig_user_id")
    .single();

  if (settingsError) throw new Error(`Could not read settings: ${settingsError.message}`);

  const dryRun = settings?.dry_run !== false;

  const { data: secrets } = await supabase
    .from("app_secrets")
    .select("ig_access_token")
    .single();

  const accessToken = secrets?.ig_access_token ?? null;
  const igUserId = settings?.ig_user_id ?? null;

  if (!dryRun && (!accessToken || !igUserId)) {
    await log("error", "Dry run is off but Instagram is not connected — nothing was published");
    return;
  }

  // Instagram media URLs are signed and short-lived, so the cached grid is
  // refreshed every run rather than only when something publishes.
  await syncGrid().catch(() => {});

  /*
   * Performance costs an API call per post, so unlike the grid it is not worth
   * doing four times an hour — a post's reach does not change meaningfully
   * between two runs twenty minutes apart. Neither sync is allowed to fail the
   * publishing it is riding along with.
   */
  await refreshPerformanceIfStale().catch(() => {});

  // Tidying must never be able to stop a post going out.
  await sweepEmptyPosts().catch(() => {});

  // A post deleted on Instagram has to stop counting as published here, or the
  // grid shows a tile that is not on the account any more.
  await reconcilePublished().catch(() => {});

  const due = await findDue();

  if (due.length === 0) {
    console.log("Nothing due.");
    return;
  }

  console.log(`${due.length} post(s) due${dryRun ? " (dry run)" : ""}.`);

  // Ask Instagram how much of the daily allowance is left before starting.
  // Hitting the ceiling mid-run fails the post at its slot, which is worse
  // than it waiting for the next one.
  let remaining = MAX_PER_RUN;
  if (!dryRun) {
    try {
      remaining = Math.min(MAX_PER_RUN, await publishingLimitRemaining(igUserId!, accessToken!));
      if (remaining === 0) {
        await log("warn", "Instagram's 24-hour publishing limit is used up — waiting");
        return;
      }
    } catch (error) {
      await log("warn", "Could not check the publishing limit; continuing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let published = 0;

  for (const post of due.slice(0, remaining)) {
    const ok = await publishOne(post.id, post.at, { dryRun, igUserId, accessToken });
    if (ok) published++;
  }

  console.log(`Done. ${published} published.`);
}

type DuePost = { id: string; at: Date };

/**
 * What should have gone out by now.
 *
 * Fixed posts carry their own instant. Queued posts do not — their slots are
 * worked out from the timetable here, exactly as the app does when displaying
 * them, so the two can never disagree about whose turn it is.
 */
async function findDue(): Promise<DuePost[]> {
  const supabase = serviceClient();
  const now = new Date();

  // A little wider than the lookback, so a slot at the very edge of the
  // window still sees the post that used it.
  const usedSince = new Date(
    now.getTime() - (QUEUE_LOOKBACK_HOURS + 2) * 60 * 60 * 1000,
  ).toISOString();

  const [{ data: posts }, { data: slots }, { data: recent }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, status, scheduled_for, queue_position, ready")
      .in("status", ["queued", "scheduled"]),
    supabase.from("schedule_slots").select("*"),
    /*
     * The slots already spent. A published post's `scheduled_for` is the slot
     * it went out for — written by publishOne below — so any slot sitting on
     * one of these is not handed to the next post in line.
     */
    supabase
      .from("posts")
      .select("scheduled_for")
      .in("status", ["published", "publishing"])
      .gte("scheduled_for", usedSince),
  ]);

  const all = posts ?? [];

  const fixed = all
    .filter((p) => p.status === "scheduled" && p.scheduled_for)
    .map((p) => ({ id: p.id, scheduled_for: p.scheduled_for!, ready: p.ready }));

  /*
   * Queued posts are worked out by the same shared function the tests pin
   * down (npm run verify:queue). It used to be written out here, asked for
   * slots from `now` onwards and then looked for ones before `now` — which
   * never exist — so no queued post had ever published. Only pinned times did.
   */
  const queued = dueQueued({
    posts: all.filter((p) => p.status === "queued"),
    slots: slots ?? [],
    fixed,
    used: (recent ?? []).map((r) => r.scheduled_for!).filter(Boolean),
    now,
  });

  const due: DuePost[] = [
    // A fixed time is a promise about an instant, so it cannot be handed to a
    // different post. An unready one simply does not go out.
    ...fixed
      .filter((p) => p.ready && new Date(p.scheduled_for) <= now)
      .map((p) => ({ id: p.id, at: new Date(p.scheduled_for) })),

    ...queued.map((q) => ({ id: q.postId, at: q.at })),
  ];

  // Oldest first, so a backlog clears in the order it was meant to go out.
  return due.sort((a, b) => a.at.getTime() - b.at.getTime());
}

async function publishOne(
  postId: string,
  /**
   * The slot this goes out for. Written to `scheduled_for` on publish, which
   * is how the next run knows the slot is spent and does not give it to the
   * following post as well.
   */
  slotAt: Date,
  options: { dryRun: boolean; igUserId: string | null; accessToken: string | null },
): Promise<boolean> {
  const supabase = serviceClient();

  // Compare-and-set: two overlapping runs cannot both claim the same post,
  // which would publish it twice.
  const { data: claimed } = await supabase
    .from("posts")
    .update({ status: "publishing", claimed_at: new Date().toISOString() })
    .eq("id", postId)
    // Re-checked at the moment of claiming, not just when the list was built:
    // a post put back to a draft in the seconds since must not still go out.
    .eq("ready", true)
    .in("status", ["queued", "scheduled"])
    .select("id, caption, hashtag_placement, attempt_count");

  const post = claimed?.[0];
  if (!post) {
    console.log(`  ${postId}: already claimed elsewhere, skipping`);
    return false;
  }

  try {
    const payload = await buildPayload(postId, post.caption, post.hashtag_placement);

    if (options.dryRun) {
      await log("info", "DRY RUN — this is what would have been sent", payload, postId);

      await supabase
        .from("posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          scheduled_for: slotAt.toISOString(),
          was_dry_run: true,
          claimed_at: null,
          last_error: null,
        })
        .eq("id", postId);

      console.log(`  ${postId}: dry run complete (${payload.imageUrls.length} image(s))`);
      return true;
    }

    const result = await publish({
      igUserId: options.igUserId!,
      accessToken: options.accessToken!,
      imageUrls: payload.imageUrls,
      caption: payload.caption,
      firstComment: payload.firstComment,
      userTags: payload.userTags,
    });

    await supabase
      .from("posts")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        scheduled_for: slotAt.toISOString(),
        ig_media_id: result.mediaId,
        ig_permalink: result.permalink,
        was_dry_run: false,
        claimed_at: null,
        last_error: null,
      })
      .eq("id", postId);

    await log("info", `Published${result.permalink ? ` — ${result.permalink}` : ""}`, null, postId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof InstagramError ? error.retryable : false;

    /*
     * A retryable failure goes back to being due, so the next run tries again
     * — which is what makes a rate limit or a blip self-correcting. A real
     * failure is parked as 'failed' so it stops consuming slots and shows up
     * as needing attention.
     */
    await supabase
      .from("posts")
      .update({
        status: retryable ? "queued" : "failed",
        claimed_at: null,
        last_error: message,
        attempt_count: (post.attempt_count ?? 0) + 1,
      })
      .eq("id", postId);

    await log(
      retryable ? "warn" : "error",
      `${retryable ? "Will retry" : "Failed"}: ${message}`,
      null,
      postId,
    );

    return false;
  }
}

/**
 * Work out exactly what gets sent.
 *
 * Deliberately assembled here and logged verbatim in dry run, so what you see
 * in the log is byte-for-byte what Instagram would receive.
 */
async function buildPayload(
  postId: string,
  caption: string,
  placement: string,
): Promise<{
  imageUrls: string[];
  caption: string;
  firstComment: string | null;
  userTags: Array<Array<{ username: string; x: number; y: number }>>;
}> {
  const supabase = serviceClient();

  const [{ data: links }, { data: tags }] = await Promise.all([
    supabase
      .from("post_photos")
      .select("id, photo_id, position")
      .eq("post_id", postId)
      .order("position", { ascending: true }),
    supabase
      .from("post_hashtags")
      .select("tag, position")
      .eq("post_id", postId)
      .order("position", { ascending: true }),
  ]);

  if (!links || links.length === 0) throw new Error("This post has no photos");

  const { data: photos } = await supabase
    .from("photos")
    .select("id, storage_path")
    .in("id", links.map((l) => l.photo_id));

  const pathById = new Map((photos ?? []).map((p) => [p.id, p.storage_path]));
  const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/media`;

  const imageUrls = links.map((link) => {
    const path = pathById.get(link.photo_id);
    if (!path) {
      throw new Error(
        "A photo on this post no longer has its full-size file — it may have been archived",
      );
    }
    return `${base}/${path}`;
  });

  const { data: userTagRows } = await supabase
    .from("photo_tags")
    .select("photo_id, username, x, y")
    .eq("post_id", postId);

  const userTags = links.map((link) =>
    (userTagRows ?? [])
      .filter((t) => t.photo_id === link.photo_id)
      .map((t) => ({ username: t.username, x: Number(t.x), y: Number(t.y) })),
  );

  const hashtags = (tags ?? []).map((t) => t.tag);
  const rendered = hashtags.length > 0 ? renderHashtags(hashtags) : "";

  const body = caption.replace(/\s+$/, "");
  const inCaption = placement === "caption" && rendered.length > 0;

  return {
    imageUrls,
    caption: inCaption ? (body ? `${body}\n\n${rendered}` : rendered) : body,
    firstComment: placement === "first_comment" && rendered ? rendered : null,
    userTags,
  };
}

/**
 * Refresh the performance figures at most a few times a day.
 *
 * It rides on the publishing cron rather than a workflow of its own, so there
 * is one scheduled job to keep alive instead of two. While a backfill is still
 * working through history the sync asks to be run again sooner.
 */
const PERFORMANCE_EVERY_HOURS = 6;

async function refreshPerformanceIfStale() {
  const supabase = serviceClient();

  const { data } = await supabase
    .from("app_settings")
    .select("performance_synced_at")
    .single();

  const last = data?.performance_synced_at ? new Date(data.performance_synced_at).getTime() : 0;
  const due = Date.now() - last > PERFORMANCE_EVERY_HOURS * 60 * 60 * 1000;

  if (!due) return;

  const { seen, measured } = await syncPerformance();
  if (measured > 0) console.log(`Performance: ${measured} of ${seen} post(s) measured.`);
}

/** Hand back posts stranded mid-publish by a run that died. */
async function releaseStaleClaims() {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();

  const { data } = await serviceClient()
    .from("posts")
    .update({ status: "queued", claimed_at: null })
    .eq("status", "publishing")
    .lt("claimed_at", cutoff)
    .select("id");

  if (data && data.length > 0) {
    await log("warn", `Released ${data.length} post(s) stuck mid-publish`);
  }
}

await main();
