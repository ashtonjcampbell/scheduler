import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { thumbUrl } from "@/lib/photos";
import { formatPacific } from "@/lib/time";

/**
 * The unfinished ones — everything still needing work before it can publish.
 *
 * This was a list of every post, which made it a worse version of the grid:
 * the same tiles, in a duller arrangement, with published posts padding it
 * out. What was missing was somewhere to answer "what do I still have to
 * finish", so that is what it does now.
 *
 * A draft is a post the publisher will pass over — no caption, no photos, or
 * simply not marked ready. It keeps its place in the grid the whole time; this
 * view is the to-do list, the grid is the arrangement.
 */
export async function DraftsView() {
  const supabase = await supabaseServer();

  /*
   * Fetched as separate tables and joined below rather than with PostgREST's
   * embedded selects. Embedding needs relationship metadata in the generated
   * types, and generating those needs Docker, which this project does not
   * have. Four small queries over a single-user dataset is a fair trade for
   * types that are actually correct.
   */
  const [{ data: posts, error }, { data: links }, { data: photos }, { data: tags }] =
    await Promise.all([
      supabase
        .from("posts")
        .select("id, caption, status, ready, queue_position, updated_at, published_at, removed_from_instagram_at")
        /*
         * Ideas are deliberately absent. An idea is a caption with no photos
         * and no place in the grid — it has its own page, and mixing the two
         * would turn a to-do list back into a list of everything.
         */
        .in("status", ["preview_draft", "queued", "scheduled", "published", "failed"])
        .order("queue_position", { ascending: true }),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase
        .from("photos")
        .select("id, storage_path, thumb_path, status, processed_at")
        .is("deleted_at", null),
      supabase.from("post_hashtags").select("post_id"),
    ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load drafts: {error.message}
      </p>
    );
  }

  const all = posts ?? [];

  // Not ready is the whole definition: it is exactly what makes the publisher
  // skip a post, so it is exactly what "still to finish" means.
  const drafts = all.filter((p) => !p.ready && p.status !== "published");

  /*
   * A post that tried to publish and could not. Rare, and easy to lose: the
   * grid does not draw failures and the schedule has already moved past them,
   * so without a home here one would simply never be seen again.
   */
  const failed = all.filter((p) => p.status === "failed");

  /*
   * Taken down on Instagram, so no longer part of what is live — but kept and
   * reachable, because the row still holds the caption, the photo set and the
   * hashtags of a post that no longer exists anywhere else. Hiding it outright
   * also hid the one thing it is still good for: duplicating it to try again.
   */
  const removed = all.filter((p) => p.removed_from_instagram_at);

  const photoById = new Map((photos ?? []).map((p) => [p.id, p]));

  const photosByPost = new Map<string, Array<{ photo_id: string; position: number }>>();
  for (const link of links ?? []) {
    const list = photosByPost.get(link.post_id) ?? [];
    list.push(link);
    photosByPost.set(link.post_id, list);
  }

  const tagCount = new Map<string, number>();
  for (const tag of tags ?? []) {
    tagCount.set(tag.post_id, (tagCount.get(tag.post_id) ?? 0) + 1);
  }

  /** What is stopping this one going out, in the order worth fixing it. */
  function blocking(postId: string, caption: string): string[] {
    const missing: string[] = [];
    if ((photosByPost.get(postId) ?? []).length === 0) missing.push("no photos");
    if (caption.trim().length === 0) missing.push("no caption");
    if ((tagCount.get(postId) ?? 0) === 0) missing.push("no hashtags");
    return missing;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Posts still to finish. They hold their place in the grid, but the
        publisher passes over them until you mark one ready.
      </p>

      {failed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
            Failed to publish
          </h2>
          <ul className="mt-2 space-y-1.5">
            {failed.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="text-sm text-red-800 underline-offset-2 hover:underline dark:text-red-300"
                >
                  {firstLine(post.caption) ?? "No caption"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {drafts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          Nothing unfinished. Everything you have started is ready to publish.
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {drafts.length} unfinished, in the order they sit in the grid.
          </p>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((post) => {
              const linked = [...(photosByPost.get(post.id) ?? [])].sort(
                (a, b) => a.position - b.position,
              );
              const cover = linked[0] ? photoById.get(linked[0].photo_id) : undefined;
              const missing = blocking(post.id, post.caption);

              return (
                <li key={post.id}>
                  <Link
                    href={`/posts/${post.id}`}
                    className="flex h-full gap-3 rounded-lg border border-stone-200 bg-white p-3 transition hover:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
                  >
                    <div className="h-20 w-16 shrink-0 overflow-hidden rounded bg-stone-100 dark:bg-stone-950">
                      {cover && cover.status === "ready" && thumbUrl(cover) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl(cover)!}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-stone-400">
                          {linked.length === 0 ? "no photo" : "processing"}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {firstLine(post.caption) ?? (
                          <span className="italic text-stone-400 dark:text-stone-500">
                            No caption
                          </span>
                        )}
                      </p>

                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        {linked.length === 0
                          ? "No photos"
                          : linked.length === 1
                            ? "1 photo"
                            : `${linked.length} photos`}
                        {" · "}
                        {tagCount.get(post.id) ?? 0} hashtag
                        {(tagCount.get(post.id) ?? 0) === 1 ? "" : "s"}
                      </p>

                      {missing.length > 0 && (
                        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                          Needs {missing.join(", ")}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {removed.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
          <summary className="cursor-pointer text-sm font-medium">
            Deleted on Instagram{" "}
            <span className="font-normal text-stone-500 dark:text-stone-400">
              {removed.length}
            </span>
          </summary>

          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            These are no longer on your profile, so they are left out of the
            grid. Kept because each one still holds the caption, photos and
            hashtags that went out — open one to duplicate it and try again.
          </p>

          <ul className="mt-3 space-y-1.5">
            {removed.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="flex items-baseline gap-2 text-sm text-stone-700 underline-offset-2 hover:underline dark:text-stone-300"
                >
                  <span className="truncate">
                    {firstLine(post.caption) ?? (
                      <span className="italic text-stone-400 dark:text-stone-500">
                        No caption
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">
                    {post.published_at && formatPacific(post.published_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
