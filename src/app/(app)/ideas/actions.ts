"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { isNotebook } from "@/lib/notebooks";

/**
 * Write a notebook.
 *
 * AUTO-SAVED, unlike a caption. The composer saves deliberately because a
 * caption is a thing you publish and a sentence you regret should be takeable
 * back — but a notebook is scratch paper, and scratch paper that loses your
 * typing because you closed the tab is worse than useless.
 *
 * Addressed by kind rather than by id, so nothing has to look up which note is
 * which, and neither notebook can be created or deleted by accident. The
 * database enforces one of each.
 */
export async function saveNotebook(
  kind: string,
  html: string,
  json: unknown,
): Promise<{ error?: string }> {
  if (!isNotebook(kind)) return { error: "No such notebook." };

  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("notes")
    .update({ content_html: html, content: json })
    .eq("kind", kind);

  if (error) return { error: error.message };

  /*
   * No revalidatePath.
   *
   * This fires every couple of seconds while you type, and each call would
   * throw away the cached page and make the next render start over — for a
   * page whose only changing content is the box you are typing into, which
   * already knows what it says.
   */
  return {};
}
