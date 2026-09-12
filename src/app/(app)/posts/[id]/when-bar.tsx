"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/database.types";
import { formatPacific, TIMEZONE } from "@/lib/time";
import { DateTimePicker } from "./date-time-picker";
import { scheduleFixed, setReady } from "../../queue/actions";

/**
 * When this goes out — three choices, at the top, before you write.
 *
 * This replaces a banner at the top with one button and a panel at the bottom
 * with two more, which between them made a single decision in three places.
 * Deciding it first is also the honest order: whether a post is going out on
 * Thursday or sitting as a draft changes how you write it.
 *
 *   ADD TO QUEUE   takes the next free slot, and rolls forward if it misses
 *   SCHEDULE       pinned to an exact instant; the queue works around it
 *   SAVE AS DRAFT  keeps its place in the grid and is passed over
 *
 * THE GUARDS ARE UNCHANGED. Queueing and scheduling both publish, so both ask
 * for the same things: saved changes, at least one photo, a caption, and
 * shapes Instagram will not mangle. The shape check is a REFUSAL rather than a
 * warning — the cost of getting it wrong is a published carousel with every
 * landscape centre-cropped, and that cannot be repaired, only deleted.
 */
export function WhenBar({
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
  /** Edits on screen that are not in the database yet. */
  unsaved: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");

  const done = post.status === "published" || post.status === "publishing";

  /*
   * Which of the three this post is actually in.
   *
   * READINESS IS ASKED FIRST. A post can carry a pinned time and still not be
   * ready, and the worker refuses to publish an unready post whatever its
   * status says — so calling that "Schedule" would be the screen disagreeing
   * with what will happen. Found by testing: making a scheduled post a draft
   * left the bar reading "Schedule" over a post that was never going out.
   */
  const choice: Choice = !post.ready
    ? "draft"
    : post.status === "scheduled"
      ? "schedule"
      : "queue";

  const [showing, setShowing] = useState<Choice>(choice);

  /*
   * Follow the server when it changes under us.
   *
   * `showing` is which tab you are LOOKING at, which is deliberately not the
   * same as which one the post is in — you can open Schedule to consider it
   * without committing. But once an action lands, the two have to agree again,
   * or the bar keeps showing the tab you pressed rather than the state you
   * are in. Adjusting during render rather than in an effect avoids a frame of
   * the wrong answer.
   */
  const [basis, setBasis] = useState<Choice>(choice);
  if (basis !== choice) {
    setBasis(choice);
    setShowing(choice);
  }

  const blocked = unsaved
    ? "Save your changes first"
    : photoCount === 0
      ? "Add at least one photo first"
      : !hasCaption
        ? "Write a caption first"
        : shapeProblem
          ? "Fix the photo shapes first"
          : null;

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  /*
   * A question, not a refusal. Posting without hashtags is a legitimate
   * choice; forgetting them is the common one, and the difference only shows
   * at the moment of committing — which is why it asks here rather than
   * nagging from the side of the screen, where it would be learned and
   * ignored.
   */
  const confirmNoTags = () =>
    hashtagCount > 0 || confirm("This post has no hashtags. Send it anyway?");

  if (done) {
    return (
      <div className="border-b border-stone-200 pb-5 dark:border-stone-800">
        <p className="text-sm">
          {post.status === "publishing" ? (
            "Publishing right now."
          ) : post.was_dry_run ? (
            <span className="text-amber-700 dark:text-amber-400">
              Dry run {post.published_at && formatPacific(post.published_at)} — never
              sent to Instagram.
            </span>
          ) : (
            <>Published {post.published_at && formatPacific(post.published_at)}.</>
          )}
        </p>
        <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
          This is the record of what went out. Duplicate it to post it again.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-stone-200 pb-5 dark:border-stone-800">
      <div
        role="group"
        aria-label="When this goes out"
        className="inline-flex overflow-hidden rounded-lg border border-stone-300 dark:border-stone-700"
      >
        <Segment
          current={showing}
          value="queue"
          onSelect={setShowing}
          disabled={pending}
        >
          Add to queue
        </Segment>
        <Segment
          current={showing}
          value="schedule"
          onSelect={setShowing}
          disabled={pending}
        >
          Schedule
        </Segment>
        <Segment
          current={showing}
          value="draft"
          onSelect={setShowing}
          disabled={pending}
        >
          Save as draft
        </Segment>
      </div>

      <div className="mt-3 min-h-[1.5rem] text-sm text-stone-600 dark:text-stone-400">
        {showing === "queue" && (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {choice === "queue"
                ? "In the queue — takes the next free slot."
                : "Takes the next free slot. Rolls forward if it is missed."}
            </span>

            {choice !== "queue" && (
              <button
                type="button"
                disabled={pending || blocked !== null}
                title={blocked ?? undefined}
                onClick={() => {
                  if (!confirmNoTags()) return;
                  run(() => setReady(post.id, true));
                }}
                className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
              >
                Add to queue
              </button>
            )}
          </div>
        )}

        {showing === "schedule" && (
          <div className="space-y-2">
            {choice === "schedule" && post.scheduled_for ? (
              <p>
                Pinned to <strong>{formatPacific(post.scheduled_for)}</strong>. The
                queue works around it.
              </p>
            ) : (
              <p>Pinned to an exact time. The queue works around it.</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <DateTimePicker value={when} onChange={setWhen} disabled={pending} />
              <button
                type="button"
                disabled={pending || !when || blocked !== null}
                title={blocked ?? undefined}
                onClick={() => {
                  if (!confirmNoTags()) return;
                  // The picker gives a local wall-clock string with no zone.
                  // It is read as Pacific, the only timezone this app books in.
                  run(() => scheduleFixed(post.id, pacificToInstant(when)));
                }}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-stone-700"
              >
                {choice === "schedule" ? "Move it" : "Set the time"}
              </button>
              <span className="text-xs text-stone-400 dark:text-stone-500">Pacific</span>
            </div>

            {/*
              The difference between the two that publish, said once, where the
              choice is being made. A queued post that misses its slot takes the
              next one; a pinned time cannot roll anywhere, so it just sits
              there missed — which is worth knowing BEFORE picking a date.
            */}
            <p className="text-xs text-stone-400 dark:text-stone-500">
              A queued post rolls forward if it misses its slot. A pinned time
              cannot, so it stays missed until you give it a new one.
            </p>
          </div>
        )}

        {showing === "draft" && (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {choice === "draft"
                ? "A draft — it keeps its place in the grid and is passed over."
                : "Keeps its place in the grid, and is passed over until you queue it."}
            </span>

            {choice !== "draft" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setReady(post.id, false))}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-stone-700"
              >
                Make it a draft
              </button>
            )}
          </div>
        )}
      </div>

      {shapeProblem && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>Instagram would reshape this post.</strong> {shapeProblem}
        </p>
      )}

      {unsaved && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Unsaved changes — publishing sends the saved version, not what is on
          screen.
        </p>
      )}

      {!unsaved && blocked && (
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">{blocked}.</p>
      )}

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

type Choice = "queue" | "schedule" | "draft";

function Segment({
  current,
  value,
  onSelect,
  disabled,
  children,
}: {
  current: Choice;
  value: Choice;
  onSelect: (value: Choice) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const selected = current === value;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => onSelect(value)}
      className={
        selected
          ? "border-r border-stone-300 px-4 py-1.5 text-sm text-white last:border-r-0 disabled:opacity-50 bg-stone-900 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900"
          : "border-r border-stone-300 px-4 py-1.5 text-sm text-stone-500 transition last:border-r-0 hover:text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-100"
      }
    >
      {children}
    </button>
  );
}

/**
 * Read a `datetime-local` value as Pacific wall-clock time.
 *
 * The input gives "2026-09-15T10:00" with no timezone. Passing that to
 * `new Date()` would read it in the BROWSER's timezone — so scheduling from a
 * laptop set to Eastern would silently book the post three hours early.
 */
function pacificToInstant(local: string): string {
  const [date, time] = local.split("T");
  if (!date || !time) return local;

  // Ask what UTC offset Pacific was on that date, then apply it. Going via the
  // date itself keeps daylight saving correct.
  const guess = new Date(`${date}T${time}:00Z`);
  return new Date(guess.getTime() + pacificOffsetMinutes(guess) * 60_000).toISOString();
}

function pacificOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;

  // "GMT-7" / "GMT-8"; positive minutes to ADD to a UTC-read wall clock.
  return -Number(name?.replace("GMT", "") || 0) * 60;
}
