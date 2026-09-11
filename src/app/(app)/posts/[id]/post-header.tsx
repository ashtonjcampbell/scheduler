"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";
import { deletePost, duplicatePost, forgetDeletedPost } from "../actions";
import { setReady } from "../../queue/actions";

/**
 * The one place that answers "will this go out, and when".
 *
 * ONE button, because there is one decision: this post is finished, let it go
 * out. It reads "Add to queue", which is what everyone already calls that.
 *
 * There WAS a second button. Every post needs a place in the running order so
 * the grid can show it at the date it is meant for, and that placement was
 * exposed as its own control — which meant learning that a post could be "in
 * the queue" and still not publish. Two buttons, one of which did nothing you
 * could see. The placement now happens on its own: a post joins the plan when
 * it is created and can be dragged around the grid like anything else.
 *
 * So "in the queue" means what it sounds like: this will publish at its turn.
 * A draft still holds its place and still shows in the grid — it is simply
 * passed over when its slot arrives, and the next queued post goes instead.
 */
export function PostHeader({
  post,
  photoCount,
  hasCaption,
  hashtagCount,
  shapeProblem,
  unsaved = false,
}: {
  post: Post;
  photoCount: number;
  hasCaption: boolean;
  /** Includes hashtags typed into the caption, not just picked ones. */
  hashtagCount: number;
  /** What Instagram would do to these photos, if anything is wrong. */
  shapeProblem: string | null;
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

  const done = post.status === "published" || post.status === "publishing";
  const ready = post.ready;

  const complete = photoCount > 0 && hasCaption && !shapeProblem;
  const blockedBecause = unsaved
    ? "Save your changes first"
    : photoCount === 0
      ? "Add at least one photo first"
      : !hasCaption
        ? "Write a caption first"
        : // A refusal, not a warning. The cost of getting this wrong is a
          // published post with every landscape centre-cropped and upscaled,
          // and it cannot be repaired afterwards — only deleted and redone.
          shapeProblem
          ? "Fix the photo shapes first"
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
                  ? post.status === "scheduled"
                    ? "In the queue — going out at its pinned time"
                    : "In the queue — this will publish"
                  : "Draft — this will not publish"}
            </p>

            <p className="text-xs text-stone-600 dark:text-stone-400">
              {done
                ? post.was_dry_run
                  ? `Rehearsed ${post.published_at ? formatPacific(post.published_at) : ""} — nothing was sent to Instagram`
                  : post.published_at && formatPacific(post.published_at)
                : post.status === "scheduled"
                  ? post.scheduled_for && formatPacific(post.scheduled_for)
                  : ready
                    ? "Takes the next free slot — see the Queue for exactly when"
                    : "It keeps its place in the grid. When that slot comes round it is passed over, and the next queued post goes instead."}
            </p>
          </div>

          {!done &&
            (ready ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setReady(post.id, false))}
                className="rounded-lg border border-stone-400 bg-white px-4 py-2 text-sm disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900"
              >
                Take out of the queue
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || !complete || unsaved}
                onClick={() => {
                  /*
                   * A question, not a refusal. Posting without hashtags is a
                   * legitimate choice; forgetting them is the common one, and
                   * the difference only shows at the moment of committing —
                   * which is why this asks here rather than nagging from the
                   * side of the screen where it would be learned and ignored.
                   */
                  if (
                    hashtagCount === 0 &&
                    !confirm("This post has no hashtags. Send it anyway?")
                  ) {
                    return;
                  }
                  run(() => setReady(post.id, true));
                }}
                title={blockedBecause ?? undefined}
                className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
              >
                Add to queue
              </button>
            ))}
        </div>
      </div>

      {shapeProblem && !done && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>Instagram would reshape this post.</strong> {shapeProblem}
        </p>
      )}

      {unsaved && !done && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You have unsaved changes. Save them first — publishing sends the saved
          version, not what is on screen.
        </p>
      )}

      {!done && !ready && !unsaved && blockedBecause && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {blockedBecause} to add this to the queue. It keeps its place in the
          grid meanwhile.
        </p>
      )}

      {!done && !ready && !blockedBecause && hashtagCount === 0 && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          No hashtags on this one. It can still go out — you will just be asked
          to confirm.
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-4">
        {/* Copying is how a published post gets redone. It cannot be edited —
            it is the record of what went out — so without this the only way
            to post it again differently was retyping all of it. */}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await duplicatePost(post.id);
              if (result?.error) setError(result.error);
            })
          }
          className="text-xs text-stone-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-stone-400"
        >
          Duplicate as a new draft
        </button>

        {/* Only for a post already deleted on Instagram — the action asks
            Instagram before believing it. */}
        {post.status === "published" && !post.was_dry_run && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !confirm(
                  "Remove this post from the app? Only do this if you have already deleted it on Instagram — it will be checked.",
                )
              ) {
                return;
              }

              startTransition(async () => {
                const result = await forgetDeletedPost(post.id);
                if (result.error) setError(result.error);
                else router.push("/posts");
              });
            }}
            className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Deleted on Instagram — remove the record
          </button>
        )}
      </div>

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
