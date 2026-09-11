import { supabaseServer } from "@/lib/supabase/server";
import { assignQueue, publishOrder } from "@/lib/queue";
import { thumbUrl } from "@/lib/photos";
import { formatPacific } from "@/lib/time";
import { GridBoard } from "./grid-board";

export const metadata = { title: "Grid preview" };
export const dynamic = "force-dynamic";

/**
 * A mock of the Instagram profile grid.
 *
 * Instagram shows newest first, so once everything has gone out the top-left
 * tile is whatever publishes LAST. The preview therefore runs furthest-future
 * down to oldest-published — which is what the grid will actually look like,
 * rather than a reading order that never exists.
 *
 * Posts still to come and posts already live share ONE grid, continuously:
 * planned tiles fill from the top and the real account picks up wherever they
 * leave off, mid-row if that is where it falls. Two grids with a heading
 * between them would break the row exactly where the join needs judging,
 * which is the whole point of showing them together.
 *
 * Drafts sit at the top with no date. They publish whenever they are finished,
 * which is later than anything already scheduled and unknowable until then —
 * so the grid shows the arrangement without inventing a day for it.
 */
export default async function GridPage() {
  const supabase = await supabaseServer();

  const [{ data: posts, error }, { data: slots }, { data: links }, { data: photos }] =
    await Promise.all([
      supabase
        .from("posts")
        .select(
          "id, caption, status, ready, scheduled_for, published_at, queue_position, was_dry_run, ig_media_id",
        )
        .in("status", ["preview_draft", "queued", "scheduled", "publishing", "published"])
        // A post deleted on Instagram is not on the profile, so it is not in
        // the mirror of the profile either.
        .is("removed_from_instagram_at", null),
      supabase.from("schedule_slots").select("*"),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase.from("photos").select("id, storage_path, thumb_path, processed_at").is("deleted_at", null),
    ]);

  // What is already live on Instagram, so the preview sits above reality
  // rather than floating on its own.
  const [{ data: liveMedia, error: mediaError }, { data: settings }] = await Promise.all([
    supabase
      .from("instagram_media")
      .select("*")
      .order("posted_at", { ascending: false })
      .limit(36),
    supabase.from("app_settings").select("ig_username, grid_synced_at").single(),
  ]);

  const connected = Boolean(settings?.ig_username);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load the grid: {error.message}
      </p>
    );
  }

  const all = posts ?? [];

  /*
   * Slots go to FINISHED posts only.
   *
   * A draft gets no date because there is no honest one to give it: it takes a
   * slot when it is finished, and nobody knows when that will be. Dating it by
   * its place in the order produced a number the app could not keep — the grid
   * promised November for a post that was going out the following Thursday.
   */
  const queued = publishOrder(
    all.filter(
      (p) => p.queue_position !== null && p.status !== "published" && p.ready,
    ),
  );

  // Worked out the same way the queue page and the worker do it — one source
  // of truth for "when".
  const { assignments } = assignQueue({
    posts: queued,
    slots: slots ?? [],
    fixed: all
      .filter((p) => p.scheduled_for && p.queue_position === null)
      .map((p) => ({ id: p.id, scheduled_for: p.scheduled_for! })),
    now: new Date(),
  });

  const queuedTime = new Map(assignments.map((a) => [a.postId, a.at.toISOString()]));

  const photoById = new Map((photos ?? []).map((p) => [p.id, p]));
  const coverFor = (postId: string) => {
    const first = (links ?? [])
      .filter((l) => l.post_id === postId)
      .sort((a, b) => a.position - b.position)[0];
    const photo = first ? photoById.get(first.photo_id) : undefined;
    return photo ? thumbUrl(photo) : null;
  };

  const countFor = (postId: string) => (links ?? []).filter((l) => l.post_id === postId).length;

  const planned = all
    .map((post) => ({
      ...post,
      at: post.published_at ?? post.scheduled_for ?? queuedTime.get(post.id) ?? null,
      cover: coverFor(post.id),
      photos: countFor(post.id),
    }))
    .sort((a, b) => {
      /*
       * Newest first, so an undated draft belongs ABOVE everything dated: it
       * publishes later than anything already scheduled, whenever it is
       * finished. Between two drafts the arranged order decides, reversed,
       * because the one meant to go out LAST sits highest.
       */
      if (!a.at && !b.at) {
        return (b.queue_position ?? 0) - (a.queue_position ?? 0);
      }

      if (!a.at) return -1;
      if (!b.at) return 1;
      return b.at.localeCompare(a.at);
    });

  /*
   * Once a post has really published it exists twice: as this app's own record
   * and as a row pulled back from Instagram. Drop the copy from Instagram, so
   * the grid keeps the tile that opens the post rather than standing it next
   * to itself.
   */
  const ownIgIds = new Set(all.map((p) => p.ig_media_id).filter(Boolean));
  const live = (liveMedia ?? []).filter((m) => !ownIgIds.has(m.id));

  const upcoming = planned.filter((t) => t.status !== "published").length;
  const notReady = planned.filter((t) => t.status !== "published" && !t.ready).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Grid preview</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
          How your profile will look once everything has gone out — newest
          first, the way Instagram shows it, in the 4:5 tiles it now uses. Your
          existing posts carry on in the same grid, so you can see the join.
          Unfinished posts sit at the top, dateless until you finish them.
        </p>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        {upcoming} still to come
        {notReady > 0 && ` · ${notReady} not scheduled yet`}
        {live.length > 0 && ` · ${live.length} already on @${settings?.ig_username}`}
        {settings?.grid_synced_at && ` · synced ${formatPacific(settings.grid_synced_at)}`}
      </p>

      {planned.length === 0 && live.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          Nothing to show yet. Start a post and it appears here.
        </p>
      ) : (
        <GridBoard
          planned={planned.map((t) => ({
            id: t.id,
            caption: t.caption,
            status: t.status,
            ready: t.ready,
            inOrder: t.queue_position !== null && t.status !== "published",
            was_dry_run: t.was_dry_run,
            at: t.at,
            cover: t.cover,
            photos: t.photos,
          }))}
          live={live.map((m) => ({
            id: m.id,
            permalink: m.permalink,
            thumbnail_url: m.thumbnail_url,
            media_url: m.media_url,
            caption: m.caption,
            media_type: m.media_type,
          }))}
          username={settings?.ig_username ?? null}
        />
      )}

      {live.length === 0 && (
        <p className="mx-auto max-w-md text-center text-xs text-stone-500 dark:text-stone-400">
          {mediaError
            ? `Could not read the cached grid: ${mediaError.message}`
            : connected
              ? `Connected as @${settings?.ig_username}. Your existing posts join this grid after the next publishing run — at most 15 minutes. Reading your grid works whether or not dry run is on.`
              : "Connect Instagram in Settings and your existing posts will carry on in this grid, below the ones still to come. Reading your grid works whether or not dry run is on."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-stone-500 dark:text-stone-400">
        <Legend colour="bg-emerald-500" label="Published" />
        <Legend colour="bg-sky-500" label="Ready to publish" />
        <Legend colour="bg-stone-400" label="Draft — will be passed over" />
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border border-stone-400" />
          No dot — already on Instagram
        </span>
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {label}
    </span>
  );
}
