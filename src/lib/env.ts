import { z } from "zod";

/**
 * Environment access, validated once and read lazily.
 *
 * Lazy matters here: on Cloudflare, `process.env` is populated by the worker
 * runtime at request time, not at module-eval time, so validating at import
 * would run against an empty object during the build.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  /** The one address allowed to sign in. Everything else is rejected. */
  ALLOWED_EMAIL: z.string().email(),
  /** Public origin of the deployed app, used to build magic-link redirects. */
  APP_URL: z.string().url(),

  /*
   * Optional: lets an upload kick off photo processing immediately instead of
   * waiting for the next scheduled sweep. Without them the app still works —
   * photos just take up to 20 minutes rather than about a minute.
   */
  GITHUB_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo")
    .optional(),
  GITHUB_DISPATCH_TOKEN: z.string().min(1).optional(),
});

let publicCache: z.infer<typeof publicSchema> | null = null;
let serverCache: z.infer<typeof serverSchema> | null = null;

/** Supabase credentials that are safe to ship to the browser. */
export function publicEnv() {
  if (publicCache) return publicCache;

  // These two must be referenced as full literals, not by computed key:
  // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time by textual match.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${describe(parsed.error)}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }

  publicCache = parsed.data;
  return publicCache;
}

/** Server-only configuration. Never import this from a client component. */
export function serverEnv() {
  if (serverCache) return serverCache;

  const parsed = serverSchema.safeParse({
    ALLOWED_EMAIL: process.env.ALLOWED_EMAIL,
    APP_URL: process.env.APP_URL,
    GITHUB_REPO: process.env.GITHUB_REPO || undefined,
    GITHUB_DISPATCH_TOKEN: process.env.GITHUB_DISPATCH_TOKEN || undefined,
  });

  if (!parsed.success) {
    throw new Error(
      `App configuration is incomplete. Missing or invalid: ${describe(parsed.error)}.`,
    );
  }

  serverCache = parsed.data;
  return serverCache;
}

function describe(error: z.ZodError) {
  return error.issues.map((issue) => issue.path.join(".")).join(", ");
}
