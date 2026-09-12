"use server";

import { supabaseServer } from "@/lib/supabase/server";
import type { Notebook } from "@/lib/notebooks";

export type Reference = Record<Notebook, string>;

/**
 * The two notebooks, fetched only when the panel is opened.
 *
 * NOT loaded with the rest of the composer. That page already runs ten
 * queries and sits closest to Cloudflare's CPU ceiling of anything here, and
 * most visits to it are to fix a hashtag or swap a photo — so a panel nobody
 * opened would be pure cost. Opening it is a deliberate act, and that is when
 * it is paid for.
 */
export async function loadReference(): Promise<{ data?: Reference; error?: string }> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.from("notes").select("kind, content_html");

  if (error) return { error: error.message };

  const byKind = new Map((data ?? []).map((n) => [n.kind, n.content_html]));

  return {
    data: {
      strategy: byKind.get("strategy") ?? "",
      idea_bank: byKind.get("idea_bank") ?? "",
    },
  };
}
