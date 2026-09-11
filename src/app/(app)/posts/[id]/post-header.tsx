"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";
import { deletePost } from "../actions";
import { addToQueue, removeFromQueue } from "../../queue/actions";

/**
 * The one place that answers "will this go out, and when".
 *
 * A post only ever publishes from `queued` or `scheduled`, and only ever gets
 * there by an explicit click — but that protection was buried in a side panel,
 * which is no comfort when you are half-way through writing something. This
 * states it plainly at the top, and makes committing a deliberate act.
 */
export function PostHeader({
  post,
  photoCount,
  hasCaption,
}: {
  post: Post;
  photoCount: number;
  hasCaption: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const live = post.status === "queued" || post.status === "scheduled";
  const done = post.status === "published" || post.status === "publishing";
  const ready = photoCount > 0;

  return (
    <div className="space-y-2">
      <div
        className={
          live
            ? "flex flex-wrap items-center gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950"
            : done
              ? "flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950"
              : "flex flex-wrap items-center gap-3 rounded-lg border border-stone-300 bg-stone-100 px-4 py-3 dark:border-stone-700 dark:bg-stone-900"
        }
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {done
              ? post.status === "published"
                ? `Published${post.was_dry_run ? " (dry run)" : ""}`
                : "Publishing now"
              : live
                ? post.status === "queued"
                  ? "In the queue — this will publish"
                  : "Scheduled — this will publish"
                : "Draft — this will never publish"}
          </p>
          <p className="text-xs text-stone-600 dark:text-stone-400">
            {done
              ? post.published_at && formatPacific(post.published_at)
              : post.status === "scheduled"
                ? post.scheduled_for && formatPacific(post.scheduled_for)
                : post.status === "queued"
                  ? "Takes the next free slot — see the Queue for exactly when"
                  : "Edit freely. Nothing goes out until you put it in the queue."}
          </p>
        </div>

        {!done &&
          (live ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeFromQueue(post.id))}
              className="rounded-lg border border-stone-400 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900"
            >
              Take out of the queue
            </button>
          ) : (
            <button
              type="button"
              disabled={pending || !ready}
              onClick={() => run(() => addToQueue(post.id))}
              title={ready ? undefined : "Add at least one photo first"}
              className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              Add to queue
            </button>
          ))}
      </div>

      {!live && !done && !ready && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Add at least one photo before this can be queued.
        </p>
      )}

      {!live && !done && ready && !hasCaption && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No caption yet — it can still be queued, but it will go out without one.
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {post.status !== "published" && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this post? This cannot be undone.")) {
                startTransition(async () => {
                  const result = await deletePost(post.id);
                  if (result.error) setError(result.error);
                  else router.push("/posts");
                });
              }
            }}
            className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Delete this post
          </button>
        </div>
      )}
    </div>
  );
}
