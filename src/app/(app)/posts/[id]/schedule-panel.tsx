"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific, TIMEZONE } from "@/lib/time";
import { DateTimePicker } from "./date-time-picker";
import { scheduleFixed, setDraftState } from "../../queue/actions";

/**
 * The exceptions to the rolling queue.
 *
 * Whether a post publishes at all is decided in the banner above, by the one
 * button that says so. What is left here is the two things that are genuinely
 * separate decisions: pinning a post to an exact instant instead of taking its
 * turn, and setting one aside as not a post yet.
 */
export function SchedulePanel({
  post,
  photoCount,
  hasCaption,
  hashtagCount,
  shapeProblem,
  unsaved,
}: {
  post: Post;
  photoCount: number;
  hasCaption: boolean;
  /** Includes hashtags typed into the caption, not just picked ones. */
  hashtagCount: number;
  /** What Instagram would do to these photos, if anything is wrong. */
  shapeProblem: string | null;
  unsaved: boolean;
}) {
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
  /*
   * Scheduling now publishes, so it asks for the same things queueing does.
   * Anything less would let a post be pinned to Friday 6pm and then quietly
   * not go out, which is the trap this panel used to set.
   */
  const blocked = unsaved
    ? "Save your changes first"
    : photoCount === 0
      ? "Add at least one photo first"
      : !hasCaption
        ? "Write a caption first"
        : shapeProblem
          ? "Fix the photo shapes first"
          : null;

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
          {blocked && (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {blocked} to pin a time.
            </p>
          )}

          <div className="mt-3 space-y-3">
            {/* No queue button here. It lives in the banner at the top, where
                the decision is actually made — two of them, in two places,
                was how "in the queue" stopped meaning anything. */}
            <div>
              <p className="text-xs font-medium">Or pin an exact time</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                For anything genuinely time-sensitive. This sends it — no need
                to add it to the queue as well. The queue works around it.
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <DateTimePicker value={when} onChange={setWhen} disabled={pending} />
                <button
                  type="button"
                  disabled={pending || !when || blocked !== null}
                  onClick={() => {
                    // Scheduling publishes, so it gets the same nudge the queue
                    // button does — both are the moment of committing.
                    if (
                      hashtagCount === 0 &&
                      !confirm("This post has no hashtags. Schedule it anyway?")
                    ) {
                      return;
                    }

                    // The picker gives a local wall-clock string with no zone.
                    // It is interpreted as Pacific, because that is the only
                    // timezone this app schedules in.
                    run(() => scheduleFixed(post.id, pacificToInstant(when)));
                  }}
                  className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-stone-700"
                >
                  Schedule
                </button>
              </div>
              <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                Times are Pacific.
              </p>
            </div>

            {/* Draft is no longer a button: it is simply a post not in the
                queue, which the banner above already controls. What remains is
                taking a post OUT of the running order entirely. */}
            <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
              <p className="text-xs font-medium">Or set it aside</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Moves it to Ideas and out of the grid — for something that is
                not a post yet.
              </p>

              <button
                type="button"
                disabled={pending || post.status === "idea"}
                onClick={() => run(() => setDraftState(post.id, "idea"))}
                className="mt-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
              >
                {post.status === "idea" ? "Already an idea" : "Move to ideas"}
              </button>
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
