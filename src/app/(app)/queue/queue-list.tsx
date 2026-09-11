"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPacific } from "@/lib/time";
import { reorder } from "@/lib/queue";
import { reorderQueue, setReady } from "./actions";

type Item = {
  id: string;
  title: string | null;
  caption: string;
  cover: string | null;
  /** When this post will go out, worked out from the timetable. */
  at: string | null;
  /** In the queue proper. A draft holds its place but is passed over. */
  ready: boolean;
};

export function QueueList({
  queued,
  unassigned,
}: {
  queued: Item[];
  unassigned: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Held locally so reordering feels instant; the server call follows.
  const [order, setOrder] = useState(queued);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;

    const ids = reorder(order.map((p) => p.id), from, to);
    const byId = new Map(order.map((p) => [p.id, p]));
    const next = ids.map((id) => byId.get(id)!);

    // The times belong to positions, not to posts: whoever is second goes out
    // in the second slot. So the times stay put and the posts move between them.
    const times = order.map((p) => p.at);
    setOrder(next.map((post, index) => ({ ...post, at: times[index] ?? null })));

    setError(null);
    startTransition(async () => {
      const result = await reorderQueue(ids);
      if (result.error) {
        setError(result.error);
        setOrder(queued);
      } else {
        router.refresh();
      }
    });
  };

  /*
   * Back to a draft, keeping its place.
   *
   * Not the same as taking it out of the running order: the post still belongs
   * where it is in the plan, it simply stops being allowed to publish there.
   * Emptying its place instead would lose the ordering that was the reason for
   * putting it there.
   */
  const drop = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await setReady(id, false);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  if (order.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
        The queue is empty. Open a post and add it to the queue.
      </p>
    );
  }

  return (
    <section>
      {/* The running order holds drafts as well, so the heading counts the two
          apart — "in the queue" now means only what will actually go out. */}
      <h2 className="text-sm font-semibold">
        Coming up{" "}
        <span className="font-normal text-stone-500 dark:text-stone-400">
          {order.filter((p) => p.ready).length} in the queue
          {order.some((p) => !p.ready) &&
            ` · ${order.filter((p) => !p.ready).length} still drafts`}
        </span>
      </h2>

      {error && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <ol className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {order.map((post, index) => (
          <li
            key={post.id}
            className="flex items-center gap-3 bg-white p-3 dark:bg-stone-900"
          >
            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-stone-400 dark:text-stone-600">
              {index + 1}
            </span>

            <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-stone-100 dark:bg-stone-950">
              {post.cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.cover} alt="" className="h-full w-full object-cover" />
              )}
            </div>

            <Link href={`/posts/${post.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {post.title ?? firstLine(post.caption) ?? "Untitled post"}
                {!post.ready && (
                  <span className="ml-2 align-middle rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                    draft
                  </span>
                )}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {post.at ? (
                  <>
                    {formatPacific(post.at)}
                    {/* Says plainly what will happen, rather than leaving a
                        date standing there like a promise it cannot keep. */}
                    {!post.ready && " · passed over unless finished by then"}
                  </>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    no slot available
                  </span>
                )}
              </p>
            </Link>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={pending || index === 0}
                aria-label="Move up"
                className="rounded px-1.5 py-0.5 text-sm text-stone-500 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={pending || index === order.length - 1}
                aria-label="Move down"
                className="rounded px-1.5 py-0.5 text-sm text-stone-500 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"
              >
                ↓
              </button>
              {/* Nothing to take out if it is already a draft — it keeps its
                  place either way, so the only thing this changes is whether
                  it may publish. */}
              {post.ready && (
                <button
                  type="button"
                  onClick={() => drop(post.id)}
                  disabled={pending}
                  title="Keeps its place in the order; it just stops publishing there"
                  className="ml-1 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:text-stone-900 disabled:opacity-50 dark:hover:text-stone-100"
                >
                  Back to draft
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {unassigned.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {unassigned.length} post{unassigned.length === 1 ? " has" : "s have"} no
          slot within the next year — add more posting times, or the queue will
          not reach them.
        </p>
      )}
    </section>
  );
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
