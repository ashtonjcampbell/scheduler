import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { thumbUrl } from "@/lib/photos";
import { formatPacific } from "@/lib/time";
import type { PostStatus } from "@/lib/database.types";
import { NewPostButton } from "./new-post-button";

export const metadata = { title: "Posts" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<PostStatus, string> = {
  idea: "Idea",
  // Kept only so an old row still renders a name; nothing creates these.
  rough_draft: "Draft",
  preview_draft: "Draft",
  queued: "In queue",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

export default async function PostsPage() {
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
        .select("id, caption, status, scheduled_for, published_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase.from("photos").select("id, storage_path, thumb_path, status").is("deleted_at", null),
      supabase.from("post_hashtags").select("post_id"),
    ]);

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

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load posts: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Posts</h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Drafts, scheduled posts, and everything already published.
          </p>
        </div>
        <NewPostButton />
      </div>

      {(posts ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          No posts yet. Start one and pick photos from the media bank.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(posts ?? []).map((post) => {
            const linked = [...(photosByPost.get(post.id) ?? [])].sort(
              (a, b) => a.position - b.position,
            );
            const cover = linked[0] ? photoById.get(linked[0].photo_id) : undefined;
            const hashtags = tagCount.get(post.id) ?? 0;

            return (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="flex h-full gap-3 rounded-lg border border-stone-200 bg-white p-3 transition hover:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
                >
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-stone-100 dark:bg-stone-950">
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
                      {firstLine(post.caption) ?? "Untitled post"}
                    </p>

                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {STATUS_LABELS[post.status]}
                      {post.scheduled_for && ` · ${formatPacific(post.scheduled_for)}`}
                      {post.published_at && ` · ${formatPacific(post.published_at)}`}
                    </p>

                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {linked.length === 0
                        ? "No photos"
                        : linked.length === 1
                          ? "1 photo"
                          : `${linked.length} photos`}
                      {" · "}
                      {hashtags} hashtag{hashtags === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
