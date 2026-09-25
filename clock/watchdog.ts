/**
 * Deciding when to shout, kept separate so it can be tested.
 *
 * The clock is the only part of this system that runs outside the database
 * and outside GitHub, which makes it the only thing able to notice when
 * either of those has stopped working. It missed that chance once already:
 * publishing failed every run for two and a half days, and the owner found
 * out because a post was not on Instagram.
 *
 * TWO THINGS ARE WORTH SHOUTING ABOUT:
 *
 *   UNREACHABLE  the database will not answer, so nothing can publish and
 *                nothing can even be logged — the app's own publish log
 *                lives inside the database it cannot reach.
 *
 *   OVERDUE      a slot came and went with a finished post waiting for it.
 *                This is the one that matters, because it holds whatever the
 *                cause turns out to be: the database, the publisher, GitHub,
 *                or something nobody has thought of yet. A queued post that
 *                misses its slot silently becomes next week's plan, with
 *                nothing on screen to say it was ever late.
 *
 * Both wait a few minutes before alerting. A single failed minute is a blip
 * — GitHub being slow to start a run is normal and self-correcting — and an
 * alarm that fires on blips gets ignored, which is how the last one was
 * missed. Each alert is raised ONCE per incident, not once a minute.
 */

export type AlertKind = "unreachable" | "overdue";

/** What the clock remembers between ticks, per kind. */
export type Incident = {
  /** When this first went wrong, as epoch milliseconds. */
  since: number;
  /** Whether the owner has already been told about this one. */
  alerted?: boolean;
  /**
   * The GitHub issue raised for it, so recovery can close the same one rather
   * than leaving a pile of stale alarms for the owner to tidy up.
   */
  issue?: number;
};

/**
 * How long something must stay wrong before the owner hears about it.
 *
 * Three minutes for an unreachable database: three consecutive failed ticks,
 * which no ordinary hiccup survives. Twenty for an overdue post, because a
 * publish run takes about a minute to start and finish, and GitHub is
 * sometimes slower — twenty minutes late is a real failure, two is traffic.
 */
export const PATIENCE_MS: Record<AlertKind, number> = {
  unreachable: 3 * 60 * 1000,
  overdue: 20 * 60 * 1000,
};

export type Decision =
  /** Nothing wrong: forget any incident of this kind. */
  | { action: "clear" }
  /** Wrong, but not for long enough yet. Remember when it started. */
  | { action: "remember"; incident: Incident }
  /** Wrong for long enough, and not yet reported. */
  | { action: "alert"; incident: Incident; lateBy: number };

/**
 * What to do about one kind of problem, given what is remembered.
 *
 * Pure, so the awkward cases are tested rather than discovered during an
 * outage: see npm run verify:watchdog.
 */
export function decide({
  wrong,
  remembered,
  now,
  kind,
  startedAt,
}: {
  /** Is this thing wrong right now? */
  wrong: boolean;
  remembered: Incident | null;
  now: number;
  kind: AlertKind;
  /**
   * When this actually started going wrong, if that is known and earlier than
   * now — the slot a post was due for, rather than the moment the clock first
   * looked. They are the same thing in normal running and days apart after an
   * outage: a post due last Thursday is not "late by one minute" because the
   * clock has only just got its database back.
   */
  startedAt?: number;
}): Decision {
  if (!wrong) return { action: "clear" };

  const incident = remembered ?? { since: Math.min(startedAt ?? now, now) };
  const lateBy = now - incident.since;

  // Already told them. Saying it again every minute is how an alert becomes
  // something people filter out of their inbox.
  if (incident.alerted) return { action: "remember", incident };

  if (lateBy < PATIENCE_MS[kind]) return { action: "remember", incident };

  return { action: "alert", incident: { ...incident, alerted: true }, lateBy };
}

/**
 * What gets written on the alert when it recovers.
 *
 * An alarm that only ever appears is half a signal. Closing it — with how long
 * it lasted — means an open issue always means something is wrong NOW, which
 * is the only way a list of alerts stays worth looking at.
 */
export function recoveryText(kind: AlertKind, lastedMs: number): string {
  const what =
    kind === "unreachable"
      ? "The database is answering again"
      : "The overdue post has published";

  return (
    `${what}, after ${minutes(lastedMs)} minutes.\n\n` +
    "Closed automatically by the clock. Nothing further to do — but if this " +
    "keeps happening, the cause is worth chasing rather than the symptom."
  );
}

/** Minutes, rounded, for a sentence a person reads. */
export function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** What the owner sees in their inbox. */
export function alertText(
  kind: AlertKind,
  lateBy: number,
): { title: string; body: string } {
  if (kind === "unreachable") {
    return {
      title: "Scheduler: the database is not answering",
      body:
        `The clock has been unable to reach the database for ${minutes(lateBy)} minutes.\n\n` +
        "While this lasts, **nothing will publish** — and the app cannot warn you " +
        "itself, because its own log lives in the database it cannot reach. That is " +
        "why this is a GitHub issue rather than a note in the app.\n\n" +
        "**What usually fixes it:** supabase.com/dashboard → your project → " +
        "Settings → General → Restart project. It takes a minute or two and loses " +
        "nothing.\n\n" +
        "Posts waiting in the queue are not lost. Each one rolls forward to the " +
        "next free slot once the database is back.\n\n" +
        "This issue is raised once per incident. Close it when you are done.",
    };
  }

  return {
    title: "Scheduler: a post is overdue",
    body:
      `A post has been due to publish for ${minutes(lateBy)} minutes and is still waiting.\n\n` +
      "The clock can see it is due, so the queue and the schedule are fine. " +
      "Something between here and Instagram is not: the publisher failing, GitHub " +
      "not starting the run, or Instagram refusing the post.\n\n" +
      "**Where to look:** the repository's Actions tab, newest \"Publish due posts\" " +
      "run. The reason is in its log.\n\n" +
      "**The post is not lost.** A queued post keeps its place and takes the next " +
      "free slot, so the worst case is that it goes out later than planned.\n\n" +
      "This issue is raised once per incident. Close it when you are done.",
  };
}
