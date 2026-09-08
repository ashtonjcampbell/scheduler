"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific, TIMEZONE } from "@/lib/time";
import {
  addToQueue,
  removeFromQueue,
  scheduleFixed,
  setDraftState,
} from "../../queue/actions";

/**
 * What happens to this post, and when.
 *
 * The three draft states are not decoration: a rough draft is invisible in the
 * grid preview, a preview draft shows in position but can never publish, and
 * an idea is a thought that is not a post yet. Being explicit about which is
 * what stops a half-finished post drifting toward a slot.
 */
export function SchedulePanel({ post, photoCount }: { post: Post; photoCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const published = post.status === "published";
  const publishing = post.status === "publishing";
  const locked = published || publishing;
  const ready = photoCount > 0;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">When this goes out</h2>

      <p className="mt-2 text-sm">
        <StatusLine post={post} />
      </p>

      {locked ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          {published
            ? "Already published — this is now a record of what went out."
            : "Publishing right now. Changes are no longer possible."}
        </p>
      ) : (
        <>
          {!ready && (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Add at least one photo before scheduling.
            </p>
          )}

          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs font-medium">Rolling queue</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Takes the next free slot. Moves forward on its own if a slot is
                ever missed.
              </p>

              {post.status === "queued" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeFromQueue(post.id))}
                  className="mt-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-stone-700"
                >
                  Take out of the queue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending || !ready}
                  onClick={() => run(() => addToQueue(post.id))}
                  className="mt-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  Add to queue
                </button>
              )}
            </div>

            <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
              <p className="text-xs font-medium">Or pin an exact time</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                For anything genuinely time-sensitive. The queue works around it.
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-950"
                />
                <button
                  type="button"
                  disabled={pending || !when || !ready}
                  onClick={() =>
                    // The picker gives a local wall-clock string with no zone.
                    // It is interpreted as Pacific, because that is the only
                    // timezone this app schedules in.
                    run(() => scheduleFixed(post.id, pacificToInstant(when)))
                  }
                  className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-stone-700"
                >
                  Schedule
                </button>
              </div>
              <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                Times are Pacific.
              </p>
            </div>

            <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
              <p className="text-xs font-medium">Or keep it as a draft</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(
                  [
                    ["preview_draft", "Preview draft", "Shows in the grid, never publishes"],
                    ["rough_draft", "Rough draft", "Hidden from the grid entirely"],
                    ["idea", "Idea", "Not a real post yet"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    title={hint}
                    disabled={pending}
                    onClick={() => run(() => setDraftState(post.id, value))}
                    className={
                      post.status === value
                        ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                        : "rounded-md border border-stone-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function StatusLine({ post }: { post: Post }) {
  switch (post.status) {
    case "queued":
      return (
        <span className="text-stone-600 dark:text-stone-400">
          In the rolling queue — its time depends on what is ahead of it.
        </span>
      );
    case "scheduled":
      return (
        <>
          Going out <strong>{post.scheduled_for && formatPacific(post.scheduled_for)}</strong>
        </>
      );
    case "publishing":
      return <span className="text-stone-600 dark:text-stone-400">Publishing now…</span>;
    case "published":
      return (
        <>
          Published {post.published_at && formatPacific(post.published_at)}
          {post.was_dry_run && (
            <span className="text-amber-700 dark:text-amber-400"> (dry run — not really)</span>
          )}
        </>
      );
    case "failed":
      return (
        <span className="text-red-600 dark:text-red-400">
          Publishing failed{post.last_error ? `: ${post.last_error}` : ""}
        </span>
      );
    default:
      return <span className="text-stone-600 dark:text-stone-400">Not scheduled.</span>;
  }
}

/**
 * Read a `datetime-local` value as Pacific wall-clock time.
 *
 * The input gives "2026-09-15T10:00" with no timezone. Passing that to
 * `new Date()` would interpret it in the BROWSER's timezone — so scheduling
 * from a laptop set to Eastern would silently book the post three hours early.
 */
function pacificToInstant(local: string): string {
  const [date, time] = local.split("T");
  if (!date || !time) return local;

  // Ask what UTC offset Pacific was on that date, then apply it. Doing it via
  // the date itself keeps daylight saving correct.
  const guess = new Date(`${date}T${time}:00Z`);
  const offsetMinutes = pacificOffsetMinutes(guess);

  return new Date(guess.getTime() + offsetMinutes * 60_000).toISOString();
}

function pacificOffsetMinutes(at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    timeZoneName: "shortOffset",
  });

  const name = formatter
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;

  // "GMT-7" / "GMT-8"; positive minutes to ADD to a UTC-read wall clock.
  const hours = Number(name?.replace("GMT", "") || 0);
  return -hours * 60;
}
