/**
 * Environment access, validated once and read lazily.
 *
 * Lazy matters here: on Cloudflare, `process.env` is populated by the worker
 * runtime at request time, not at module-eval time, so validating at import
 * would run against an empty object during the build.
 *
 * WRITTEN BY HAND rather than with a schema library. This module is imported
 * by the proxy, by both Supabase clients and by the photo helpers — which is
 * to say by everything, on every request. Cloudflare gives a free Worker about
 * ten milliseconds of CPU and roughly four hundred go on starting the runtime,
 * so anything on that path has to earn its place. Eight strings and two shapes
 * did not need a parser.
 *
 * The error messages are the part worth keeping: a misconfigured deployment
 * should say which variable is wrong, not merely fail.
 */

type PublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

type ServerEnv = {
  /** The one address allowed to sign in. Everything else is rejected. */
  ALLOWED_EMAIL: string;
  /** Public origin of the deployed app, used to build magic-link redirects. */
  APP_URL: string;
  /*
   * Optional: lets an upload kick off photo processing immediately instead of
   * waiting for the next scheduled sweep. Without them the app still works —
   * photos just take up to 20 minutes rather than about a minute.
   */
  GITHUB_REPO?: string;
  GITHUB_DISPATCH_TOKEN?: string;
};

let publicCache: PublicEnv | null = null;
let serverCache: ServerEnv | null = null;

function isUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Deliberately loose. This rejects typos, not unusual but valid addresses. */
function isEmail(value: string | undefined): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function fail(what: string, missing: string[]): never {
  throw new Error(`${what} Missing or invalid: ${missing.join(", ")}.`);
}

/** Supabase credentials that are safe to ship to the browser. */
export function publicEnv(): PublicEnv {
  if (publicCache) return publicCache;

  // These two must be referenced as full literals, not by computed key:
  // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time by textual match.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!isUrl(url)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    fail(
      "Supabase is not configured. Copy .env.example to .env.local and fill it in.",
      missing,
    );
  }

  publicCache = {
    NEXT_PUBLIC_SUPABASE_URL: url!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey!,
  };

  return publicCache;
}

/** Server-only configuration. Never import this from a client component. */
export function serverEnv(): ServerEnv {
  if (serverCache) return serverCache;

  const allowedEmail = process.env.ALLOWED_EMAIL;
  const appUrl = process.env.APP_URL;
  const repo = process.env.GITHUB_REPO || undefined;
  const token = process.env.GITHUB_DISPATCH_TOKEN || undefined;

  const missing: string[] = [];
  if (!isEmail(allowedEmail)) missing.push("ALLOWED_EMAIL");
  if (!isUrl(appUrl)) missing.push("APP_URL");

  // Optional, but a malformed one is a mistake worth reporting rather than
  // silently ignoring — instant uploads would just stop working.
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    missing.push("GITHUB_REPO (expected owner/repo)");
  }

  if (missing.length > 0) {
    fail("App configuration is incomplete.", missing);
  }

  serverCache = {
    ALLOWED_EMAIL: allowedEmail!,
    APP_URL: appUrl!,
    GITHUB_REPO: repo,
    GITHUB_DISPATCH_TOKEN: token,
  };

  return serverCache;
}
