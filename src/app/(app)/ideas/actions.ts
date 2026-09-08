"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Ideas are posts in their earliest state.
 *
 * Modelling them as a separate thing would mean copying caption, photos and
 * hashtags across when one grew into a real post — and losing whatever did not
 * survive the copy. An idea is just a post nothing will ever publish until you
 * say so.
 */

export async function createIdea(caption: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("posts")
    .insert({ caption: caption.trim(), status: "idea" });

  if (error) return { error: error.message };

  revalidatePath("/ideas");
  return {};
}

export async function updateIdea(id: string, caption: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("posts")
    .update({ caption: caption.trim() })
    .eq("id", id)
    .eq("status", "idea");

  if (error) return { error: error.message };

  revalidatePath("/ideas");
  return {};
}

export async function deleteIdea(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase.from("posts").delete().eq("id", id).eq("status", "idea");

  if (error) return { error: error.message };

  revalidatePath("/ideas");
  return {};
}

/** Turn an idea into a real draft and open it in the composer. */
export async function promoteIdea(id: string): Promise<never | { error: string }> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("posts")
    .update({ status: "rough_draft" })
    .eq("id", id)
    .eq("status", "idea");

  if (error) return { error: error.message };

  redirect(`/posts/${id}`);
}

// ---------------------------------------------------------------------------
// The notepad — freeform, not attached to any post
// ---------------------------------------------------------------------------

export async function saveNote(
  id: string | null,
  title: string,
  html: string,
  json: unknown,
): Promise<{ error?: string; id?: string }> {
  const supabase = await supabaseServer();

  if (id) {
    const { error } = await supabase
      .from("notes")
      .update({ title: title.trim() || "Untitled", content_html: html, content: json })
      .eq("id", id);

    if (error) return { error: error.message };

    revalidatePath("/ideas");
    return { id };
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({ title: title.trim() || "Untitled", content_html: html, content: json })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/ideas");
  return { id: data.id };
}

export async function deleteNote(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/ideas");
  return {};
}
