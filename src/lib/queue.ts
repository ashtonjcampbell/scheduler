import { upcomingSlotInstants } from "@/lib/time";

/**
 * Working out when each queued post actually goes out.
 *
 * The rolling queue is the reason this app exists rather than a calendar: you
 * put drafts in an order and the timetable fills itself in. Everything here is
 * pure and takes `now` as an argument, so the awkward cases — a slot that has
 * just passed, a fixed post sitting on top of a slot, a queue longer than the
 * timetable — can be tested rather than discovered in production.
 */

export type Slot = {
  id: string;
  weekday: number;
  local_time: string;
  active: boolean;
};

export type QueuedPost = {
  id: string;
  queue_position: number | null;
};

/** A post pinned to an exact time, which the queue must flow around. */
export type FixedPost = {
  id: string;
  scheduled_for: string;
};

export type Assignment = {
  postId: string;
  slotId: string;
  at: Date;
};

/**
 * How far ahead to look for open slots.
 *
 * The brief asks for scheduling months in advance with no artificial cap, so
 * this is a search horizon rather than a limit: a queue longer than a year's
 * worth of slots is not a real situation, and the alternative is an unbounded
 * loop.
 */
const HORIZON_DAYS = 400;

/**
 * Give every queued post the next open slot, in queue order.
 *
 * A slot is taken if a fixed post already sits within `collisionMinutes` of
 * it — publishing two posts a couple of minutes apart looks like a glitch,
 * and Instagram's own guidance is to space posts out.
 */
export function assignQueue({
  posts,
  slots,
  fixed,
  now,
  collisionMinutes = 60,
}: {
  posts: readonly QueuedPost[];
  slots: readonly Slot[];
  fixed: readonly FixedPost[];
  now: Date;
  collisionMinutes?: number;
}): { assignments: Assignment[]; unassigned: string[] } {
  const active = slots.filter((s) => s.active);

  if (active.length === 0) {
    return { assignments: [], unassigned: posts.map((p) => p.id) };
  }

  const timetable = upcomingSlotInstants(active, now, HORIZON_DAYS);

  const blocked = fixed.map((f) => new Date(f.scheduled_for).getTime());
  const window = collisionMinutes * 60_000;

  const open = timetable.filter(
    (entry) => !blocked.some((taken) => Math.abs(taken - entry.at.getTime()) < window),
  );

  // Queue order is the user's stated intent; nulls sort last so a post that
  // somehow lost its position does not jump the line.
  const ordered = [...posts].sort(
    (a, b) => (a.queue_position ?? Number.MAX_SAFE_INTEGER) - (b.queue_position ?? Number.MAX_SAFE_INTEGER),
  );

  const assignments: Assignment[] = [];
  const unassigned: string[] = [];

  ordered.forEach((post, index) => {
    const slot = open[index];

    if (!slot) {
      unassigned.push(post.id);
      return;
    }

    assignments.push({ postId: post.id, slotId: slot.slotId, at: slot.at });
  });

  return { assignments, unassigned };
}

/**
 * Posts whose slot came and went without them publishing.
 *
 * GitHub's cron is best-effort and can be delayed, and a run can fail. Without
 * this, a missed post would sit in the past looking scheduled forever — the
 * exact "stale, backdated post that has to be manually rescheduled" the brief
 * calls out. They go back into the queue and take the next open slot instead.
 *
 * `graceMinutes` avoids treating a post as missed while a slow publish is
 * still legitimately in progress.
 */
export function findMissed<T extends { id: string; scheduled_for: string | null; status: string }>(
  posts: readonly T[],
  now: Date,
  graceMinutes = 30,
): T[] {
  const cutoff = now.getTime() - graceMinutes * 60_000;

  return posts.filter((post) => {
    if (post.status !== "scheduled") return false;
    if (!post.scheduled_for) return false;

    return new Date(post.scheduled_for).getTime() < cutoff;
  });
}

/** Move a post within the queue, renumbering the rest to stay contiguous. */
export function reorder(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  if (from === to || from < 0 || from >= ids.length) return [...ids];

  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...ids];

  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
