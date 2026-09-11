import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { assignQueue, findMissed } from "@/lib/queue";
import { thumbUrl } from "@/lib/photos";
import { formatPacific } from "@/lib/time";
import { QueueList } from "./queue-list";

export const metadata = { title: "Queue" };
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const supabase = await supabaseServer();

  const [{ data: slots }, { data: posts, error }, { data: links }, { data: photos }] =
    await Promise.all([
      supabase.from("schedule_slots").select("*"),
      supabase
        .from("posts")
        .select("id, caption, status, ready, scheduled_for, queue_position, schedule_mode")
        .in("status", ["queued", "scheduled", "publishing"]),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase.from("photos").select("id, storage_path, thumb_path").is("deleted_at", null),
    ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load the queue: {error.message}
      </p>
    );
  }

  const all = posts ?? [];

  /*
   * ONLY posts that will actually go out.
   *
   * Drafts hold a place in the running order too — that is what lets the grid
   * show them at the date they are meant for — but they are not in the queue
   * and listing them here says they are. This page answers one question: what
   * is going out, and when. Planning happens on the grid, by dragging.
   *
   * Their slots are worked out from the ready posts alone, which is also what
   * the worker does: an unfinished post is passed over and the next ready one
   * takes the slot. Counting drafts here would push every date later than the
   * day it will really happen.
   */
  const queued = all
    .filter((p) => p.status === "queued" && p.ready)
    .sort(
      (a, b) =>
        (a.queue_position ?? Number.MAX_SAFE_INTEGER) -
        (b.queue_position ?? Number.MAX_SAFE_INTEGER),
    );

  const waiting = all.filter((p) => p.status === "queued" && !p.ready).length;
  const fixed = all
    .filter((p) => p.status !== "queued" && p.scheduled_for)
    .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));

  const now = new Date();

  // Queued posts have no stored time; their slots are worked out here, flowing
  // around anything already pinned to a fixed instant.
  const { assignments, unassigned } = assignQueue({
    posts: queued,
    slots: slots ?? [],
    fixed: fixed
      .filter((p) => p.scheduled_for)
      .map((p) => ({ id: p.id, scheduled_for: p.scheduled_for! })),
    now,
  });

  const timeFor = new Map(assignments.map((a) => [a.postId, a.at]));

  // Fixed posts whose moment came and went without publishing.
  const missed = findMissed(
    fixed.map((p) => ({ ...p, scheduled_for: p.scheduled_for })),
    now,
  );

  const coverFor = new Map<string, string | null>();
  const photoById = new Map((photos ?? []).map((p) => [p.id, p]));
  for (const post of all) {
    const first = (links ?? [])
      .filter((l) => l.post_id === post.id)
      .sort((a, b) => a.position - b.position)[0];
    const photo = first ? photoById.get(first.photo_id) : undefined;
    coverFor.set(post.id, photo ? thumbUrl(photo) : null);
  }

  const activeSlots = (slots ?? []).filter((s) => s.active).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Queue</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Posts go out in this order, filling your weekly slots. Times are
          worked out fresh each time — nothing sits with a stale date.
        </p>
      </div>

      {activeSlots === 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You have no active posting times, so nothing in the queue can be
          scheduled.{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Add some in Settings
          </Link>
          .
        </p>
      )}

      {missed.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {missed.length} fixed post{missed.length === 1 ? "" : "s"} passed
          without publishing. Queued posts roll forward on their own; a fixed
          time cannot, so these need a new time.
        </p>
      )}

      {waiting > 0 && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {waiting} draft{waiting === 1 ? "" : "s"} also hold a place in the
          running order. They are not in the queue and will not publish — see
          them, and reorder everything, on the{" "}
          <Link href="/grid" className="underline underline-offset-2">
            grid
          </Link>
          .
        </p>
      )}

      <QueueList
        queued={queued.map((post) => ({
          id: post.id,
          caption: post.caption,
          cover: coverFor.get(post.id) ?? null,
          at: timeFor.get(post.id)?.toISOString() ?? null,
        }))}
        unassigned={unassigned}
      />

      <section>
        <h2 className="text-sm font-semibold">Fixed times</h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Pinned to an exact moment. The queue works around them.
        </p>

        {fixed.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            Nothing pinned to a specific time.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {fixed.map((post) => {
              const isMissed = missed.some((m) => m.id === post.id);

              return (
                <li key={post.id} className="flex items-center gap-3 bg-white p-3 dark:bg-stone-900">
                  <Cover src={coverFor.get(post.id) ?? null} />

                  <Link href={`/posts/${post.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {firstLine(post.caption) ?? "Untitled post"}
                    </p>
                    <p
                      className={
                        isMissed
                          ? "text-xs text-amber-700 dark:text-amber-400"
                          : "text-xs text-stone-500 dark:text-stone-400"
                      }
                    >
                      {post.scheduled_for && formatPacific(post.scheduled_for)}
                      {isMissed && " · missed"}
                      {post.status === "publishing" && " · publishing now"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Cover({ src }: { src: string | null }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-stone-100 dark:bg-stone-950">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
