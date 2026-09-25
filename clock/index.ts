/**
 * The clock: wakes the publisher the minute something is due.
 *
 * WHY THIS EXISTS. The publisher runs in GitHub Actions on a "every fifteen
 * minutes" schedule, and GitHub treats that as a suggestion. Measured over a
 * week it ran every two to five hours — so a post set for 9:00 went out
 * whenever GitHub next got round to it. Cloudflare's cron triggers fire on
 * the minute, so this asks every minute "is anything due?" and, only when the
 * answer is yes, tells GitHub to run the publisher now. The fifteen-minute
 * schedule stays as a backup.
 *
 * "DUE" IS NOT WORKED OUT HERE. It is the same `dueQueued` the publisher
 * itself uses, imported rather than copied, so the clock can never think a
 * post is due that the publisher would then skip, or the other way round.
 * That function is pinned down by `npm run verify:queue`.
 *
 * It does no publishing and holds no Instagram credentials. The worst it can
 * do is wake the publisher when there is nothing to do, which costs a
 * forty-second run that says "nothing due".
 *
 * Deployed on its own (`npm run clock:deploy`), separate from the app, so a
 * bad app deploy cannot stop posts going out and the other way round. The
 * same arrangement HQ uses for its own clock.
 */

import { dueQueued, QUEUE_LOOKBACK_HOURS } from "../src/lib/queue";
import { decide, alertText, type AlertKind, type Incident } from "./watchdog";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GITHUB_REPO: string;
  GITHUB_DISPATCH_TOKEN: string;
  /** What the clock remembers between ticks. See watchdog.ts. */
  SCHEDULER_STATE: KVNamespace;
};

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type PostRow = {
  id: string;
  status: string;
  scheduled_for: string | null;
  queue_position: number | null;
  ready: boolean;
};

type SlotRow = {
  id: string;
  weekday: number;
  local_time: string;
  active: boolean;
};

async function rest<T>(env: Env, query: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

/**
 * What should go out now, and the slot each one was due for — the same answer
 * the publisher will reach, because it is the same function.
 *
 * The times matter as much as the ids: "a post has been due for twenty
 * minutes" is the alert worth sending, and that cannot be said without them.
 */
async function whatIsDue(env: Env, now: Date): Promise<Array<{ id: string; at: Date }>> {
  const usedSince = new Date(
    now.getTime() - (QUEUE_LOOKBACK_HOURS + 2) * 60 * 60 * 1000,
  ).toISOString();

  const [posts, slots, recent] = await Promise.all([
    rest<PostRow[]>(
      env,
      "posts?select=id,status,scheduled_for,queue_position,ready&status=in.(queued,scheduled)",
    ),
    rest<SlotRow[]>(env, "schedule_slots?select=id,weekday,local_time,active"),
    rest<Array<{ scheduled_for: string }>>(
      env,
      `posts?select=scheduled_for&status=in.(published,publishing)&scheduled_for=gte.${encodeURIComponent(usedSince)}`,
    ),
  ]);

  const fixed = posts
    .filter((p) => p.status === "scheduled" && p.scheduled_for)
    .map((p) => ({ id: p.id, scheduled_for: p.scheduled_for!, ready: p.ready }));

  const dueFixed = fixed
    .filter((p) => p.ready && new Date(p.scheduled_for).getTime() <= now.getTime())
    .map((p) => ({ id: p.id, at: new Date(p.scheduled_for) }));

  const dueQueue = dueQueued({
    posts: posts.filter((p) => p.status === "queued"),
    slots,
    fixed,
    used: recent.map((r) => r.scheduled_for).filter(Boolean),
    now,
  }).map((d) => ({ id: d.postId, at: d.at }));

  return [...dueFixed, ...dueQueue];
}

/**
 * Raise an alert, or don't, and remember which.
 *
 * The memory lives in Cloudflare rather than the database, because the whole
 * point is to still work when the database does not.
 *
 * Writes are deliberately rare — once when something starts going wrong, once
 * when the owner is told, once when it recovers — rather than once a minute.
 * A two-day outage costs three writes.
 */
async function watch(
  env: Env,
  kind: AlertKind,
  wrong: boolean,
  now: number,
  /** When it really started, if earlier than now — see decide(). */
  startedAt?: number,
) {
  const key = `incident:${kind}`;

  let remembered: Incident | null = null;
  try {
    const saved = await env.SCHEDULER_STATE.get(key);
    if (saved) remembered = JSON.parse(saved) as Incident;
  } catch {
    // Unreadable memory must not stop the clock doing its actual job.
  }

  const decision = decide({ wrong, remembered, now, kind, startedAt });

  try {
    if (decision.action === "clear") {
      if (remembered) await env.SCHEDULER_STATE.delete(key);
      return;
    }

    if (decision.action === "alert") {
      const { title, body } = alertText(kind, decision.lateBy);
      const raised = await raiseIssue(env, title, body);

      // Only record "told them" if they were actually told. A refused API call
      // must not silence the next tick.
      if (raised) await env.SCHEDULER_STATE.put(key, JSON.stringify(decision.incident));
      return;
    }

    // Remembering only matters the first time; after that nothing has changed.
    if (!remembered) await env.SCHEDULER_STATE.put(key, JSON.stringify(decision.incident));
  } catch (error) {
    console.error("watchdog bookkeeping failed:", error instanceof Error ? error.message : error);
  }
}

/** Open a GitHub issue, which is what actually reaches the owner by email. */
async function raiseIssue(env: Env, title: string, body: string): Promise<boolean> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "scheduler-clock",
  };

  try {
    /*
     * Never two issues saying the same thing. The remembered state should
     * prevent it, but memory can be lost — a namespace cleared, a deploy from
     * a different machine — and waking up to forty identical issues would be
     * its own kind of failure.
     */
    const existing = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/issues?state=open&per_page=30`,
      { headers },
    );

    if (existing.ok) {
      const open = (await existing.json()) as Array<{ title: string }>;
      if (open.some((issue) => issue.title === title)) {
        console.log("already reported:", title);
        return true;
      }
    }

    const created = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body }),
    });

    if (!created.ok) {
      console.error(`could not raise the alert (${created.status})`, (await created.text()).slice(0, 200));
      return false;
    }

    console.log("alert raised:", title);
    return true;
  } catch (error) {
    console.error("could not raise the alert:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function tick(env: Env) {
  const now = new Date();

  /*
   * THE DATABASE FIRST, because when it is unreachable nothing else is
   * knowable — not what is due, not whether anything published, and not even
   * a note in the app's own log, which lives inside it.
   */
  let due: Array<{ id: string; at: Date }>;

  try {
    due = await whatIsDue(env, now);
  } catch (error) {
    console.error("cannot reach the database:", error instanceof Error ? error.message : error);
    await watch(env, "unreachable", true, now.getTime());
    return;
  }

  await watch(env, "unreachable", false, now.getTime());

  if (due.length === 0) {
    // Nothing waiting means nothing can be late.
    await watch(env, "overdue", false, now.getTime());
    return;
  }

  /*
   * Something is due, so the clock wakes the publisher — and starts counting.
   * If the same post is still due twenty minutes from now, the wake-up is not
   * working and the owner hears about it. This is the check that would have
   * caught two and a half days of silence.
   */
  console.log(`${due.length} post(s) due — waking the publisher`);

  // Lateness is measured from the slot the post was due for, not from now.
  const oldest = due.reduce((a, b) => (a.at < b.at ? a : b));
  await watch(env, "overdue", true, now.getTime(), oldest.at.getTime());

  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/publish.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "scheduler-clock",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  // GitHub answers 204 with no body when the run has been started.
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    console.error(`GitHub refused to start the publisher (${response.status}): ${detail}`);
  }
}

const clock = {
  async fetch(): Promise<Response> {
    return new Response("This is the scheduler's clock. It has no web interface.", {
      status: 404,
    });
  },

  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      tick(env).catch((error) => {
        console.error("Clock tick failed:", error instanceof Error ? error.message : error);
      }),
    );
  },
};

export default clock;
