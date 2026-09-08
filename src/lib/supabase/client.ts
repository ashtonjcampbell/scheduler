"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

let cached: ReturnType<typeof create> | null = null;

function create() {
  const env = publicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The browser-side Supabase client. Memoised so every component shares one
 * auth session and one realtime socket.
 */
export function supabaseBrowser() {
  cached ??= create();
  return cached;
}
