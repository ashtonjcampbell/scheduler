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
 * CPU is the part worth watching. Cloudflare gives a free Worker TEN
 * MILLISECONDS per request, and a page that renders a long list will quietly
 * approach it as the library grows — so this reports the slowest pages rather
 * than only the broken ones, and warns before they break.
 */

import { readFileSync } from "node:fs";
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

const cookies = await signIn();
console.log(`\nsigned in · checking ${PAGES.length} pages on ${base}\n`);

let failed = 0;
let slow = 0;

for (const path of PAGES) {
  const started = Date.now();

  let status = 0;
  let note = "";

  try {
    const response = await fetch(`${base}${path}`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });

    status = response.status;
    const body = await response.text();

    // Cloudflare's own error pages come back as 5xx HTML that says nothing
    // useful in the status alone, so the body is worth reading.
    if (body.includes("Worker exceeded resource limits")) note = "CPU limit";
    else if (body.includes("Internal Server Error")) note = "server error";
    else if (body.includes("Application error")) note = "client error";
  } catch (error) {
    note = error instanceof Error ? error.message : String(error);
  }

  const ms = Date.now() - started;
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
