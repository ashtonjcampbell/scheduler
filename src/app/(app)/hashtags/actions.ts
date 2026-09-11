"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { normaliseTag, parseTagBlock, validateTag, isValidParse } from "@/lib/hashtags";
import type { Hashtag } from "@/lib/database.types";

export type AddResult = {
  added: number;
  duplicates: string[];
  rejected: Array<{ input: string; error: string }>;
  error?: string;
};

/**
 * Add one or many tags at once.
 *
 * Accepts a pasted block in whatever shape it arrives — spaces, commas,
 * newlines, with or without '#'. Duplicates are reported rather than treated
 * as failures: pasting a set that overlaps an existing one is normal, not a
 * mistake.
 */
export async function addTags(
  block: string,
  categoryId: string | null,
): Promise<AddResult> {
  const supabase = await supabaseServer();
  const parsed = parseTagBlock(block);

  const rejected = parsed.filter((p) => !isValidParse(p)) as Array<{
    input: string;
    error: string;
  }>;
  const wanted = parsed.filter(isValidParse).map((p) => p.tag);

  if (wanted.length === 0) {
    return { added: 0, duplicates: [], rejected };
  }

  // Existing tags are matched case-insensitively, the way Instagram treats
  // them, so #MtBaker will not be added alongside #mtbaker.
  const { data: existing, error: readError } = await supabase
    .from("hashtags")
    .select("tag");

  if (readError) {
    return { added: 0, duplicates: [], rejected, error: readError.message };
  }

  const have = new Set((existing ?? []).map((row) => row.tag.toLowerCase()));
  const duplicates = wanted.filter((tag) => have.has(tag.toLowerCase()));
  const fresh = wanted.filter((tag) => !have.has(tag.toLowerCase()));

  if (fresh.length === 0) {
    return { added: 0, duplicates, rejected };
  }

  const { error } = await supabase
    .from("hashtags")
    .insert(fresh.map((tag) => ({ tag, category_id: categoryId })));

  if (error) {
    return { added: 0, duplicates, rejected, error: error.message };
  }

  revalidatePath("/hashtags");
  return { added: fresh.length, duplicates, rejected };
}

export async function updateTag(
  id: string,
  fields: { tag?: string; category_id?: string | null; post_count?: number | null; notes?: string | null },
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  // Typed rather than Record<string, unknown>: the Supabase client rejects a
  // loose index signature, and a typo in a column name should fail here.
  const patch: Partial<Pick<Hashtag, "tag" | "category_id" | "post_count" | "notes">> = {};

  if (fields.tag !== undefined) {
    const cleaned = normaliseTag(fields.tag);
    if (!cleaned) return { error: "A tag cannot be empty" };

    const invalid = validateTag(cleaned);
    if (invalid) return { error: invalid };

    patch.tag = cleaned;
  }

  if (fields.category_id !== undefined) patch.category_id = fields.category_id;
  if (fields.post_count !== undefined) patch.post_count = fields.post_count;
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null;

  const { error } = await supabase.from("hashtags").update(patch).eq("id", id);

  if (error) {
    return {
      error: error.message.includes("hashtags_tag_lower_idx")
        ? "That tag is already in the library."
        : error.message,
    };
  }

  revalidatePath("/hashtags");
  return {};
}

/**
 * Retire or bring back a tag.
 *
 * Retired tags stay in the library and stay searchable, but the shuffle never
 * offers them. This is what the "too low volume" sheet was for.
 */
export async function setTagActive(id: string, active: boolean): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("hashtags").update({ active }).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return {};
}

export async function deleteTag(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("hashtags").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return {};
}

/** Bulk retire/restore/recategorise, for tidying a big paste after the fact. */
export async function updateMany(
  ids: string[],
  fields: { active?: boolean; category_id?: string | null },
): Promise<{ error?: string; updated?: number }> {
  if (ids.length === 0) return { updated: 0 };

  const supabase = await supabaseServer();
  const { error, count } = await supabase
    .from("hashtags")
    .update(fields, { count: "exact" })
    .in("id", ids);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return { updated: count ?? 0 };
}

export async function deleteMany(ids: string[]): Promise<{ error?: string; deleted?: number }> {
  if (ids.length === 0) return { deleted: 0 };

  const supabase = await supabaseServer();
  const { error, count } = await supabase
    .from("hashtags")
    .delete({ count: "exact" })
    .in("id", ids);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return { deleted: count ?? 0 };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function addCategory(name: string): Promise<{ error?: string; id?: string }> {
  const supabase = await supabaseServer();
  const trimmed = name.trim();

  if (!trimmed) return { error: "Give the category a name" };

  const { data, error } = await supabase
    .from("hashtag_categories")
    .insert({ name: trimmed })
    .select("id")
    .single();

  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "You already have a category with that name."
        : error.message,
    };
  }

  revalidatePath("/hashtags");
  return { id: data.id };
}

export async function renameCategory(id: string, name: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const trimmed = name.trim();

  if (!trimmed) return { error: "Give the category a name" };

  const { error } = await supabase
    .from("hashtag_categories")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return {};
}

/**
 * Delete a category. Its tags survive and become uncategorised — the schema's
 * `on delete set null` does that, so no tag is ever lost with its folder.
 */
export async function deleteCategory(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("hashtag_categories").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/hashtags");
  return {};
}

// ---------------------------------------------------------------------------
// The default mix for new posts
// ---------------------------------------------------------------------------

/**
 * Remember "how many from which categories" as the starting point for every
 * new post.
 *
 * Kept as a single recipe rather than a growing list, because the ask was for a
 * default and not for a library of presets. The recipe tables already model
 * this exactly, so nothing new is invented to store it; `app_settings` just
 * points at which recipe is the default.
 */
export async function saveDefaultMix(
  counts: Record<string, number>,
): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  const items = Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([category_id, count]) => ({ category_id, count: Math.floor(count) }));

  const { data: settings } = await supabase
    .from("app_settings")
    .select("default_recipe_id")
    .single();

  let recipeId = settings?.default_recipe_id ?? null;

  if (!recipeId) {
    const { data: created, error: createError } = await supabase
      .from("hashtag_recipes")
      .insert({ name: "Default" })
      .select("id")
      .single();

    if (createError) return { error: createError.message };
    recipeId = created!.id;

    const { error: linkError } = await supabase
      .from("app_settings")
      .update({ default_recipe_id: recipeId })
      .eq("id", true);

    if (linkError) return { error: linkError.message };
  }

  // Replace wholesale: the panel always knows the complete intended mix, so
  // reconciling item by item could only drift from what is on screen.
  const { error: clearError } = await supabase
    .from("hashtag_recipe_items")
    .delete()
    .eq("recipe_id", recipeId);

  if (clearError) return { error: clearError.message };

  if (items.length > 0) {
    const { error } = await supabase
      .from("hashtag_recipe_items")
      .insert(items.map((item) => ({ ...item, recipe_id: recipeId })));

    if (error) return { error: error.message };
  }

  revalidatePath("/posts", "layout");
  return {};
}
