import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
// Type-only, so it is erased at runtime and never resolved by tsx. Shares the
// single source of truth with the web app instead of duplicating it here.
import type { Database } from "../../../src/lib/database.types.js";

/**
 * Service-role client. Bypasses RLS, so treat every query here as trusted and
 * never expose this module to the web app.
 */
export function serviceClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
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
