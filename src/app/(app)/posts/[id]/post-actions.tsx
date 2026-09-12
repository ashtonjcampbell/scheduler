"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { deletePost, duplicatePost, forgetDeletedPost } from "../actions";

/**
 * Duplicate and delete, at the bottom where they belong.
 *
 * These used to sit in the banner at the top of the post, beside the button
 * that publishes it — three destructive-ish links in the first thing you see.
 * They are the things you do once, at the end, so they wait at the end.
 */
export function PostActions({ post }: { post: Post }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deletable = post.status !== "published" || post.was_dry_run;

  return (
    <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {/* Copying is how a published post gets redone. It cannot be edited —
            it is the record of what went out — so without this the only way to
            post it again differently was retyping all of it. */}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await duplicatePost(post.id);
              if (result?.error) setError(result.error);
            })
          }
          className="text-stone-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-stone-400"
        >
          Duplicate as a new draft
        </button>

        {deletable && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !confirm(
                  post.was_dry_run
                    ? "Delete this post? It was a dry run, so nothing was ever posted to Instagram."
                    : "Delete this post? This cannot be undone.",
                )
              ) {
                return;
              }

              startTransition(async () => {
                const result = await deletePost(post.id);
                if (result.error) setError(result.error);
                else router.push("/posts");
              });
            }}
            className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            {post.was_dry_run ? "Delete this dry-run post" : "Delete this post"}
          </button>
        )}

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
            className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Deleted on Instagram — remove the record
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
