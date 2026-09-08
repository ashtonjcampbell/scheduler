import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. Bypasses every access rule.
 *
 * `app_secrets` deliberately has NO row-level security policies, so neither
 * the browser nor a signed-in session can read the Instagram tokens — only a
 * service-role caller can. That is the property worth keeping, and it means a
 * couple of genuinely server-side jobs need this client:
 *
 *   - the OAuth callback, which must read the App Secret to exchange the code
 *   - the settings page, to show whether credentials exist without revealing
 *     them
 *
 * The `server-only` import above makes importing this from a client component
 * a BUILD error rather than a leak discovered later. Never call it from
 * anything that ships to the browser, and never return a token from it.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Connecting Instagram needs it; " +
        "add it as a Worker secret.",
    );
  }

  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
