import { upcomingSlotInstants } from "./time";

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
  /**
   * Finished and allowed to publish.
   *
   * Optional, and treated as true when absent, so a caller that has already
   * filtered to finished posts needs to say nothing.
   */
  ready?: boolean;
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
  horizonDays = HORIZON_DAYS,
}: {
  posts: readonly QueuedPost[];
  slots: readonly Slot[];
  fixed: readonly FixedPost[];
  now: Date;
  collisionMinutes?: number;
  /**
   * How far ahead to lay out the timetable. The queue screens want the whole
   * of it; the clock only asks what is due by now, and a shorter timetable
   * gives the same first slots — see `dueQueued`.
   */
  horizonDays?: number;
}): { assignments: Assignment[]; unassigned: string[] } {
  const active = slots.filter((s) => s.active);

  if (active.length === 0) {
    return { assignments: [], unassigned: posts.map((p) => p.id) };
  }

  const timetable = upcomingSlotInstants(active, now, horizonDays);

  const blocked = fixed.map((f) => new Date(f.scheduled_for).getTime());
  const window = collisionMinutes * 60_000;

  const open = timetable.filter(
    (entry) => !blocked.some((taken) => Math.abs(taken - entry.at.getTime()) < window),
  );

  /*
   * Ready first, then queue order.
   *
   * Sorted HERE rather than trusted from the caller. It used to sort by queue
   * position alone, which silently undid a caller that had already ordered its
   * posts — the grid passed a correctly ordered list, had it thrown away, and
   * dated a post two months late while the queue page showed the truth.
   *
   * Nulls sort last so a post that somehow lost its position cannot jump the
   * line.
   */
  const ordered = publishOrder(posts);

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

/**
 * How late a queued post may still go out for a slot that has passed.
 *
 * The publisher runs on a timer that is not exact, so "due" has to mean "its
 * slot went by recently", not "its slot is this minute". Six hours covers a
 * slow or skipped run comfortably; anything later than that is treated as a
 * missed slot and the post waits for the next one, rather than turning up at
 * an hour nobody chose.
 */
export const QUEUE_LOOKBACK_HOURS = 6;

/**
 * Which queued posts should publish right now, and for which slot.
 *
 * THIS IS WHERE QUEUED POSTS WERE SILENTLY NEVER PUBLISHING. The publisher
 * used to ask `assignQueue` for slots from `now` onwards and then look for
 * ones at or before `now` — which cannot exist, because the timetable skips
 * every slot that has already passed. Posts pinned to an exact time went out;
 * posts in the queue never did, and nothing failed loudly enough to notice.
 *
 * So the timetable is laid from a little way back, and a slot counts as due
 * once it has passed. Two things keep that honest:
 *
 *   - A slot already USED is not reused. `used` carries the slot times of
 *     queued posts that have published inside the window; any slot within the
 *     collision window of one is taken. Without this, every run inside the
 *     window would publish the next post in line into the same slot.
 *   - Only READY posts take a slot. A draft at the head of the queue is passed
 *     over, and the next finished post goes out instead.
 */
export function dueQueued({
  posts,
  slots,
  fixed,
  used,
  now,
  lookbackHours = QUEUE_LOOKBACK_HOURS,
}: {
  posts: readonly QueuedPost[];
  slots: readonly Slot[];
  fixed: readonly FixedPost[];
  /** Slot times already filled by queued posts that have published. */
  used: readonly string[];
  now: Date;
  lookbackHours?: number;
}): Array<{ postId: string; at: Date }> {
  const from = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  const ready = posts.filter((p) => p.ready !== false);

  const { assignments } = assignQueue({
    posts: ready,
    slots,
    // A used slot is treated exactly like a pinned post sitting on it.
    fixed: [...fixed, ...used.map((at, i) => ({ id: `used-${i}`, scheduled_for: at }))],
    now: from,
    /*
     * Only as far as now, and a day to spare. Found 26 September 2026: laying
     * out 400 days of slots every minute took the clock past Cloudflare's
     * 10 ms and every run was stopped ("exceededResources") — so nothing
     * published and the watchdog could not say so. Posts take open slots in
     * order, so the slots up to now are the same whether the timetable runs
     * two days or 400; the later ones only ever hold posts that are not due.
     */
    horizonDays: Math.ceil(lookbackHours / 24) + 1,
  });

  return assignments
    .filter((a) => a.at.getTime() <= now.getTime())
    .map((a) => ({ postId: a.postId, at: a.at }));
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

/**
 * The order posts will actually publish in.
 *
 * Queue position is the PLAN. What happens is slightly different: when a slot
 * comes round and the post whose turn it is has not been finished, the slot
 * goes to the next one that has been, and the draft waits for the following
 * slot. So a ready post sitting behind three drafts does not go out in four
 * weeks — it goes out next.
 *
 * Which means dates have to be worked out ready-first, or the app shows a date
 * it will not keep. The grid said November for a post the queue said was going
 * out next Thursday; both were computing honestly from different orders, and
 * only one of them matched what the worker would do.
 *
 * Within each group the queue position still decides, so the ordering set by
 * dragging is preserved — it just applies to the finished posts first.
 */
export function publishOrder<
  T extends { queue_position: number | null; ready?: boolean },
>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => {
    // Absent means ready: a caller that has already filtered to finished posts
    // should not have to restate it.
    const aReady = a.ready !== false;
    const bReady = b.ready !== false;

    if (aReady !== bReady) return aReady ? -1 : 1;

    return (
      (a.queue_position ?? Number.MAX_SAFE_INTEGER) -
      (b.queue_position ?? Number.MAX_SAFE_INTEGER)
    );
  });
}
