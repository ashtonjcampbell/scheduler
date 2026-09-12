/**
 * Load every page of the live app and report what actually happened.
 *
 * Written after a day in which the owner found five failures before the
 * developer did. Every one of them would have shown up here in seconds:
 *
 *   - the media bank exceeding Cloudflare's CPU budget and returning 1102
 *   - the overview doing the same on its RSC fetch
 *   - pages rendering at all after a schema change
 *
 * The checks that existed — typecheck, lint, unit tests — all passed through
 * every one of those, because none of them load a page. This does the thing
 * the owner does: signs in, opens each screen, and looks.
 *
 *   npm run smoke                  the deployed app
 *   npm run smoke -- --local       a dev server on :3000
 *
 * IT ANSWERS ONE QUESTION: does every page load. Not how fast — this used to
 * claim a free Worker gets ten milliseconds of CPU and to treat its own
 * wall-clock timings as evidence about that, and both halves were wrong.
 * Cloudflare's real figures come from `npm run cpu`, which asks Cloudflare
 * rather than inferring from out here, and costs the app nothing.
 *
 * It is deliberately GENTLE. An earlier version fired three samples of every
 * page as fast as they would go, and Cloudflare's numbers show it caused more
 * resource failures than everything else in this app's history put together —
 * then reported its own damage as the app's. One request per page, six hundred
 * milliseconds apart, after a warm-up that is not measured.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const local = process.argv.includes("--local");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

/*
 * The DEPLOYED app by default.
 *
 * Not APP_URL: that is set to localhost for development, and a smoke test that
 * quietly checks a dev server while reporting success is worse than no smoke
 * test at all.
 */
const DEPLOYED = "https://ig-scheduler.black-forest-7a87.workers.dev";
const base = local ? "http://localhost:3000" : DEPLOYED;

/** Every screen, plus the query strings that change what a page does. */
const PAGES = [
  "/",
  "/media",
  "/media?filter=all",
  "/media?filter=all&page=2",
  "/media?filter=trash",
  "/posts",
  "/posts?view=schedule",
  "/posts?view=drafts",
  "/posts?view=list",
  "/queue",
  "/grid",
  "/ideas",
  "/hashtags",
  "/settings",
  "/privacy",
  "/login",
];

/** Anything slower than this is close enough to the ceiling to fix now. */
const SLOW_MS = 1500;

/*
 * Where the last run's cookies are kept.
 *
 * Gitignored, and it holds a real session — treat it like the .env it sits
 * beside.
 */
const SESSION_FILE = ".smoke-session.json";

/** Long enough to be useful, short enough that a stale one is never used. */
const SESSION_GOOD_FOR_MS = 45 * 60 * 1000;

/**
 * The cookies from a previous run, if they are still worth having.
 *
 * WHY THIS EXISTS: this used to mint a fresh magic link every single run.
 * Run it a dozen times in an evening — which is exactly what happens while
 * working on the app — and Supabase starts refusing to issue them. It hands
 * back a session that does not work, every page redirects to the login screen,
 * and the smoke test reports seventeen failures that have nothing to do with
 * the app. A test that cries wolf under repeated use is worse than no test.
 */
function cachedSession() {
  try {
    const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8"));

    if (saved.base !== base) return null;
    if (Date.now() - saved.at > SESSION_GOOD_FOR_MS) return null;

    return saved.cookies;
  } catch {
    // No file, unreadable, or not JSON. Sign in properly.
    return null;
  }
}

function remember(cookies) {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ base, at: Date.now(), cookies }));
  } catch {
    // Not cached. The next run signs in again, which is only slower.
  }
}

async function signIn() {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // A one-time link for the app's single account, exchanged for the cookies a
  // browser would hold. Nothing here knows the password.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: env.ALLOWED_EMAIL,
  });

  if (error) throw new Error(`Could not make a sign-in link: ${error.message}`);

  /*
   * Redeem the link and take the tokens out of the FRAGMENT.
   *
   * Supabase answers a magic link with `#access_token=...`, which is designed
   * for a browser: a fragment never reaches a server, so the app's callback
   * route cannot see it and bounces to /auth/error?reason=missing_code.
   * Following the redirect the way a browser does therefore yields nothing.
   */
  const verify = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify`);
  verify.searchParams.set("token", data.properties.hashed_token);
  verify.searchParams.set("type", "magiclink");
  verify.searchParams.set("redirect_to", `${base}/auth/callback`);

  const response = await fetch(verify, { redirect: "manual" });
  const location = response.headers.get("location");

  if (!location) throw new Error("Supabase did not hand back a callback link.");

  const fragment = new URLSearchParams(location.split("#")[1] ?? "");
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");

  if (!accessToken || !refreshToken) {
    throw new Error(`No tokens in the sign-in response: ${location.slice(0, 120)}`);
  }

  /*
   * Build the cookie @supabase/ssr would have written.
   *
   * Coupling a test to a library's storage format is not lovely, and the
   * alternative is driving a real browser to read a fragment — which is a great
   * deal of machinery to check that a page returns 200. If a Supabase upgrade
   * changes the format this fails loudly at sign-in, which is the safe way for
   * it to break.
   */
  const { data: user } = await supabase.auth.getUser(accessToken);

  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: user.user,
  };

  const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;

  // Long values are split across numbered cookies, exactly as the browser
  // client does, because a session with a user object exceeds the 4KB limit.
  const CHUNK = 3180;

  if (encoded.length <= CHUNK) {
    return `sb-${projectRef}-auth-token=${encoded}`;
  }

  const parts = [];
  for (let i = 0; i * CHUNK < encoded.length; i++) {
    parts.push(`sb-${projectRef}-auth-token.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }

  return parts.join("; ");
}

/**
 * One real post, so the composer is checked too.
 *
 * It is the most-used screen in the app and the one most often changed, and
 * until now the smoke test could not see it: every other page has a fixed
 * path, and this one needs an id. A page the test never opens is a page it
 * cannot vouch for — which is exactly how a broken build once passed.
 */
async function findAPost() {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data } = await supabase
    .from("posts")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);

  return data?.[0]?.id ?? null;
}

/*
 * A cached session first, and a real check that it works.
 *
 * Trusting the cache blindly would trade one silent failure for another: an
 * hour-old session that Supabase has since invalidated would send every page
 * to the login screen just as convincingly. One request answers it.
 */
let cookies = cachedSession();

if (cookies) {
  const check = await fetch(`${base}/media`, {
    headers: { cookie: cookies },
    redirect: "manual",
  });

  // A redirect from a signed-in page means the session is no good.
  if (check.status !== 200) cookies = null;
}

if (cookies) {
  console.log("  (reusing the last session)");
} else {
  cookies = await signIn();
  remember(cookies);
}

const postId = await findAPost();
if (postId) PAGES.push(`/posts/${postId}`);
else console.log("  (no posts yet — the composer is not covered this run)");

/*
 * WAKE IT UP FIRST, and do not measure the waking.
 *
 * This runs straight after a deploy, when every route is cold and Cloudflare
 * is booting Next.js from scratch for each one. Firing fifty requests into
 * that state produced most of the resource failures in this app's history —
 * the test became the single biggest cause of the thing it was written to
 * detect, and then reported its own damage as the app's.
 *
 * One request, a pause, and the rest of the run measures a warm worker, which
 * is what anyone actually uses.
 */
await fetch(`${base}/privacy`, { signal: AbortSignal.timeout(20_000) }).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 2_000));

console.log(`\nsigned in · checking ${PAGES.length} pages on ${base}\n`);

let failed = 0;
let slow = 0;

/**
 * Load a page once and say what happened.
 *
 * Cloudflare's own error pages come back as 5xx HTML that says nothing useful
 * in the status alone, so the body is worth reading.
 */
async function hit(path) {
  const started = Date.now();

  try {
    /*
     * Give up after fifteen seconds.
     *
     * Without this a stalled connection sat for five minutes and was then
     * reported as a five-minute COLD START, which reads as the app being
     * catastrophically slow rather than as the network having hiccuped. No
     * page here takes anywhere near fifteen seconds; anything that does has
     * stopped being a timing and started being a failure.
     */
    const response = await fetch(`${base}${path}`, {
      headers: { cookie: cookies },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    const body = await response.text();

    const note = body.includes("Worker exceeded resource limits")
      ? "CPU limit"
      : body.includes("Internal Server Error")
        ? "server error"
        : body.includes("Application error")
          ? "client error"
          : "";

    return { status: response.status, note, ms: Date.now() - started };
  } catch (error) {
    return {
      status: 0,
      note: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

for (const path of PAGES) {
  /*
   * ONE REQUEST PER PAGE, and a pause between them.
   *
   * This took three samples and reported the median, to tell a cold start from
   * a slow page. It was the wrong trade. Seventeen pages times three, fired as
   * fast as they would go, is more than a free Worker will take — the failures
   * moved down the list as each run went on, which is load piling up, not
   * pages being slow. Cloudflare's own figures say this test caused more
   * resource failures than everything else in the app's history put together,
   * and then reported its own damage as the app's.
   *
   * So it does the one job it is actually for: does every page load. How FAST
   * they are is a different question with a better answer — `npm run cpu`,
   * which asks Cloudflare instead of guessing from out here, and costs the app
   * nothing at all.
   */
  await new Promise((resolve) => setTimeout(resolve, 600));

  const run = await hit(path);

  const status = run.status;
  const note = run.note;
  const ms = run.ms;

  const ok = (status === 200 || status === 307) && !note;

  if (!ok) failed++;
  else if (ms > SLOW_MS) slow++;

  const mark = ok ? (ms > SLOW_MS ? "SLOW" : " ok ") : "FAIL";
  console.log(
    `  ${mark}  ${String(status).padEnd(3)} ${String(ms).padStart(5)}ms  ${path}${note ? `  — ${note}` : ""}`,
  );
}

console.log("");

if (failed > 0) {
  console.error(`${failed} page(s) failed.\n`);
  process.exit(1);
}

if (slow > 0) {
  console.log(`All pages loaded. ${slow} slower than ${SLOW_MS}ms — worth trimming before they fail.\n`);
} else {
  console.log("All pages loaded.\n");
}
