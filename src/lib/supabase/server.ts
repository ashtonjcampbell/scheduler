import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { retryingFetch } from "./retry";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Server Components cannot write cookies, so the `setAll` below is allowed to
 * fail silently there — session refresh is handled by the proxy instead,
 * which runs before every request and *can* write them.
 */
export async function supabaseServer() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { fetch: retryingFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component. Safe to ignore: the proxy
            // has already refreshed the session for this request.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, or null.
 *
 * Always uses `getUser()` rather than reading the session from the cookie:
 * `getUser()` revalidates the token against Supabase, so a forged or stale
 * cookie cannot pass for a login.
 */
export async function currentUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
