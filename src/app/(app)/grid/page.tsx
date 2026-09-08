import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { assignQueue } from "@/lib/queue";
import { thumbUrl } from "@/lib/photos";
import { formatPacific } from "@/lib/time";
import type { PostStatus } from "@/lib/database.types";

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
 * Rough drafts are excluded entirely, per the brief. Preview drafts appear at
 * the top, since they are intended for some point ahead but have no time yet.
 */
export default async function GridPage() {
  const supabase = await supabaseServer();

  const [{ data: posts, error }, { data: slots }, { data: links }, { data: photos }] =
    await Promise.all([
      supabase
        .from("posts")
        .select("id, title, caption, status, scheduled_for, published_at, queue_position, was_dry_run")
        .in("status", ["preview_draft", "queued", "scheduled", "publishing", "published"]),
      supabase.from("schedule_slots").select("*"),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase.from("photos").select("id, storage_path, thumb_path").is("deleted_at", null),
    ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load the grid: {error.message}
      </p>
    );
  }

  const all = posts ?? [];
  const queued = all
    .filter((p) => p.status === "queued")
    .sort(
      (a, b) =>
        (a.queue_position ?? Number.MAX_SAFE_INTEGER) -
        (b.queue_position ?? Number.MAX_SAFE_INTEGER),
    );

  // Queued posts carry no time of their own, so the grid works theirs out the
  // same way the queue page does — one source of truth for "when".
  const { assignments } = assignQueue({
    posts: queued,
    slots: slots ?? [],
    fixed: all
      .filter((p) => p.scheduled_for && p.status !== "queued")
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

  const tiles = all
    .map((post) => ({
      ...post,
      at: post.published_at ?? post.scheduled_for ?? queuedTime.get(post.id) ?? null,
      cover: coverFor(post.id),
      photos: countFor(post.id),
    }))
    .sort((a, b) => {
      // Preview drafts have no time; they sit at the top as "some point ahead".
      if (!a.at && !b.at) return 0;
      if (!a.at) return -1;
      if (!b.at) return 1;
      return b.at.localeCompare(a.at);
    });

  const published = tiles.filter((t) => t.status === "published").length;
  const upcoming = tiles.length - published;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Grid preview</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
          How your profile will look once everything has gone out — newest
          first, the way Instagram shows it. Rough drafts are left out.
        </p>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        {upcoming} still to come · {published} published
      </p>

      {tiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          Nothing to show yet. Queue a post or mark one as a preview draft.
        </p>
      ) : (
        <div className="mx-auto max-w-md">
          <div className="grid grid-cols-3 gap-0.5">
            {tiles.map((tile) => (
              <Link
                key={tile.id}
                href={`/posts/${tile.id}`}
                title={`${tile.title ?? firstLine(tile.caption) ?? "Untitled"}${tile.at ? ` — ${formatPacific(tile.at)}` : ""}`}
                className="group relative block aspect-square overflow-hidden bg-stone-100 dark:bg-stone-950"
              >
                {tile.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tile.cover}
                    alt=""
                    loading="lazy"
                    className={
                      tile.status === "published"
                        ? "h-full w-full object-cover"
                        : "h-full w-full object-cover opacity-70 transition group-hover:opacity-100"
                    }
                  />
                ) : (
                  <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-stone-400">
                    no photo
                  </span>
                )}

                {tile.photos > 1 && (
                  <span className="absolute right-1 top-1 rounded bg-stone-900/70 px-1 text-[9px] font-medium text-white">
                    ⧉ {tile.photos}
                  </span>
                )}

                <StatusDot status={tile.status} dryRun={tile.was_dry_run} />

                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/80 to-transparent px-1 pb-0.5 pt-3 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                  {tile.at ? formatPacific(tile.at) : "preview draft"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-stone-500 dark:text-stone-400">
        <Legend colour="bg-emerald-500" label="Published" />
        <Legend colour="bg-sky-500" label="Scheduled or queued" />
        <Legend colour="bg-stone-400" label="Preview draft" />
      </div>
    </div>
  );
}

function StatusDot({ status, dryRun }: { status: PostStatus; dryRun: boolean }) {
  const colour =
    status === "published"
      ? dryRun
        ? "bg-amber-500"
        : "bg-emerald-500"
      : status === "preview_draft"
        ? "bg-stone-400"
        : "bg-sky-500";

  return (
    <span
      className={`absolute left-1 top-1 h-2 w-2 rounded-full ring-1 ring-white/70 ${colour}`}
      title={dryRun ? "Published in dry run — not really posted" : status}
    />
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

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
