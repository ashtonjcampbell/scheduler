"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";
import { deletePost } from "../actions";
import { addToQueue, removeFromQueue, setReady } from "../../queue/actions";

/**
 * The one place that answers "will this go out, and when".
 *
 * Two separate questions, deliberately shown as two separate controls:
 *
 *   IN THE QUEUE says WHERE this post sits — which slot it is lined up for.
 *   An unfinished post can hold its place for weeks, and seeing it there in
 *   the grid is the whole reason for planning ahead.
 *
 *   PUBLISH-READY says WHETHER it may actually go out from that place. When a
 *   slot arrives and the post at the front is not ready, the slot goes to the
 *   next one that is, and the draft keeps its place for the following slot.
 *
 * Collapsing the two into one status is what made an unfinished post
 * unplaceable before. Keeping them apart means nothing publishes by drifting
 * into a slot — it has to be declared finished, once, on purpose.
 */
export function PostHeader({
  post,
  photoCount,
  hasCaption,
  unsaved = false,
}: {
  post: Post;
  photoCount: number;
  hasCaption: boolean;
  /** Edits on screen that are not in the database yet. */
  unsaved?: boolean;
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

  const placed = post.status === "queued" || post.status === "scheduled";
  const done = post.status === "published" || post.status === "publishing";
  const ready = post.ready;

  const complete = photoCount > 0 && hasCaption;
  const blockedBecause = unsaved
    ? "Save your changes first"
    : photoCount === 0
      ? "Add at least one photo first"
      : !hasCaption
        ? "Write a caption first"
        : null;

  return (
    <div className="space-y-2">
      <div
        className={
          done
            ? post.was_dry_run
              ? // A rehearsal is not an achievement; green would read as one.
                "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950"
              : "rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950"
            : ready
              ? "rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950"
              : "rounded-lg border border-stone-300 bg-stone-100 px-4 py-3 dark:border-stone-700 dark:bg-stone-900"
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {done
                ? post.status === "published"
                  ? post.was_dry_run
                    ? "Dry run — this was never posted"
                    : "Published"
                  : "Publishing now"
                : ready
                  ? placed
                    ? post.status === "scheduled"
                      ? "Ready — going out at its pinned time"
                      : "Ready — goes out at its turn in the queue"
                    : "Ready — but not in the queue, so it has no turn yet"
                  : placed
                    ? "Draft — holding its place, will not publish"
                    : "Draft — not in the queue"}
            </p>

            <p className="text-xs text-stone-600 dark:text-stone-400">
              {done
                ? post.was_dry_run
                  ? `Rehearsed ${post.published_at ? formatPacific(post.published_at) : ""} — nothing was sent to Instagram`
                  : post.published_at && formatPacific(post.published_at)
                : post.status === "scheduled"
                  ? post.scheduled_for && formatPacific(post.scheduled_for)
                  : ready
                    ? placed
                      ? "Takes the next free slot — see the Queue for exactly when"
                      : "Add it to the queue to give it a slot."
                    : placed
                      ? "When its slot comes round it will be passed over, and the next ready post goes out instead."
                      : "Edit freely. Nothing goes out until you mark it ready."}
            </p>
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-2">
              {placed ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeFromQueue(post.id))}
                  className="rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900"
                >
                  Remove from queue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending || unsaved}
                  onClick={() => run(() => addToQueue(post.id))}
                  title={unsaved ? "Save your changes first" : undefined}
                  className="rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm disabled:opacity-40 dark:border-stone-600 dark:bg-stone-900"
                >
                  Add to queue
                </button>
              )}

              {ready ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setReady(post.id, false))}
                  className="rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900"
                >
                  Back to draft
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending || !complete || unsaved}
                  onClick={() => run(() => setReady(post.id, true))}
                  title={blockedBecause ?? undefined}
                  className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
                >
                  Mark publish-ready
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {unsaved && !done && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You have unsaved changes. Save them first — publishing sends the saved
          version, not what is on screen.
        </p>
      )}

      {!done && !ready && !unsaved && blockedBecause && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {blockedBecause} to mark this publish-ready. It can sit in the queue
          meanwhile.
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* A dry-run post published nothing, so there is no record to protect —
          only a rehearsal to clear away. */}
      {(post.status !== "published" || post.was_dry_run) && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  post.was_dry_run
                    ? "Delete this post? It was a dry run, so nothing was ever posted to Instagram."
                    : "Delete this post? This cannot be undone.",
                )
              ) {
                startTransition(async () => {
                  const result = await deletePost(post.id);
                  if (result.error) setError(result.error);
                  else router.push("/posts");
                });
              }
            }}
            className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            {post.was_dry_run ? "Delete this dry-run post" : "Delete this post"}
          </button>
        </div>
      )}
    </div>
  );
}
