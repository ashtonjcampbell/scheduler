import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
// Type-only, so it is erased at runtime and never resolved by tsx. Shares the
// single source of truth with the web app instead of duplicating it here.
import type { Database } from "../../../src/lib/database.types.js";

/** Gateway and network hiccups, as opposed to "the request was wrong". */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const RETRY_DELAYS_MS = [500, 1500];

/**
 * Fetch that tries again when Supabase blinks.
 *
 * A publish run once died on its very first query with a bare "Gateway
 * Timeout" — the database was briefly unreachable, and a whole scheduled run
 * failed over roughly one second of bad luck. Nothing was lost, because the
 * queue rolls forward and the next run picked it up, but it did send an
 * "all jobs have failed" alarm for a problem that had already gone away.
 *
 * ONLY READS ARE RETRIED. A 5xx does not say whether the write landed before
 * the gateway gave up, so retrying a POST risks a second copy of the row —
 * a duplicate publish_log line is harmless, a duplicate anything else is not.
 * Writes still fail loudly, which is the right outcome for a write.
 */
async function retryingFetch(
  // Taken from the global rather than written out: this runs under tsx with
  // Node's own types, where the DOM's RequestInfo does not exist.
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD";

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init);

      if (!retryable || !TRANSIENT_STATUS.has(response.status)) return response;
      if (attempt >= RETRY_DELAYS_MS.length) return response;

      console.warn(
        `Supabase returned ${response.status}; retrying in ${RETRY_DELAYS_MS[attempt]}ms`,
      );
    } catch (error) {
      // A refused connection or a dropped socket never reached the database,
      // so this is safe to repeat whatever the method was.
      if (attempt >= RETRY_DELAYS_MS.length) throw error;

      console.warn(
        `Supabase request failed (${String(error)}); retrying in ${RETRY_DELAYS_MS[attempt]}ms`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/**
 * Service-role client. Bypasses RLS, so treat every query here as trusted and
 * never expose this module to the web app.
 */
export function serviceClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  });
}

/** Append to the publish log. Never throws: logging must not break a job. */
export async function log(
  level: "info" | "warn" | "error",
  message: string,
  detail?: unknown,
  postId?: string,
) {
  const line = `[${level}] ${message}`;
  if (level === "error") console.error(line, detail ?? "");
  else console.log(line, detail ?? "");

  try {
    await serviceClient().from("publish_log").insert({
      level,
      message,
      detail: detail === undefined ? null : (detail as never),
      post_id: postId ?? null,
    });
  } catch (error) {
    console.error("Could not write to publish_log:", error);
  }
}
