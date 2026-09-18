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

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GITHUB_REPO: string;
  GITHUB_DISPATCH_TOKEN: string;
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

/** What should go out now — the same answer the publisher will reach. */
async function whatIsDue(env: Env, now: Date): Promise<string[]> {
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
    .map((p) => p.id);

  const dueQueue = dueQueued({
    posts: posts.filter((p) => p.status === "queued"),
    slots,
    fixed,
    used: recent.map((r) => r.scheduled_for).filter(Boolean),
    now,
  }).map((d) => d.postId);

  return [...dueFixed, ...dueQueue];
}

/**
 * Leave a note the owner can find, at most once an hour.
 *
 * A clock that fails quietly is exactly what caused this: the publisher's
 * schedule slipped for a week and nothing said so. But a note every minute
 * would bury the log, so an identical one inside the last hour is enough.
 */
async function warnOnce(env: Env, message: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  try {
    const recent = await rest<unknown[]>(
      env,
      `publish_log?select=id&level=eq.warn&message=eq.${encodeURIComponent(message)}&at=gte.${encodeURIComponent(since)}&limit=1`,
    );
    if (recent.length > 0) return;

    await fetch(`${env.SUPABASE_URL}/rest/v1/publish_log`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ level: "warn", message }),
    });
  } catch {
    // Logging must never be the thing that breaks the clock.
  }
}

async function tick(env: Env) {
  const now = new Date();
  const due = await whatIsDue(env, now);

  if (due.length === 0) return;

  console.log(`${due.length} post(s) due — waking the publisher`);

  // workflow_dispatch: the publish workflow already accepts it, so this needs
  // no change to the workflow file — only a token allowed to use it.
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

    await warnOnce(
      env,
      response.status === 403
        ? "The clock could not start the publisher: its GitHub token needs Actions: Read and write"
        : `The clock could not start the publisher (GitHub ${response.status})`,
    );
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
