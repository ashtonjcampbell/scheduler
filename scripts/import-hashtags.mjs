import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

/**
 * Import a hashtag library from JSON.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/import-hashtags.mjs path/to/hashtags.json
 *
 * Expects rows of { tag, posts, category, notes, active }.
 *
 * Re-runnable: matches existing tags case-insensitively and updates them
 * rather than creating duplicates, so a corrected export can just be
 * imported again.
 */

const file = process.argv[2];
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!file || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-hashtags.mjs <file.json>",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const rows = JSON.parse(await readFile(file, "utf8"));
console.log(`Read ${rows.length} rows.\n`);

// ---------------------------------------------------------------------------
// Categories first — tags reference them.
// ---------------------------------------------------------------------------

const names = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();

const { data: existingCategories } = await supabase
  .from("hashtag_categories")
  .select("id, name");

const categoryId = new Map(
  (existingCategories ?? []).map((c) => [c.name.toLowerCase(), c.id]),
);

for (const [index, name] of names.entries()) {
  if (categoryId.has(name.toLowerCase())) continue;

  const { data, error } = await supabase
    .from("hashtag_categories")
    .insert({ name, sort_order: index })
    .select("id")
    .single();

  if (error) {
    console.error(`  Could not create category "${name}": ${error.message}`);
    continue;
  }

  categoryId.set(name.toLowerCase(), data.id);
  console.log(`  + category ${name}`);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const { data: existingTags } = await supabase.from("hashtags").select("id, tag");
const tagId = new Map((existingTags ?? []).map((t) => [t.tag.toLowerCase(), t.id]));

let created = 0;
let updated = 0;
let failed = 0;

for (const row of rows) {
  const fields = {
    tag: row.tag,
    category_id: row.category ? (categoryId.get(row.category) ?? null) : null,
    post_count: row.posts ?? null,
    notes: row.notes ?? null,
    active: row.active !== false,
  };

  const existing = tagId.get(row.tag.toLowerCase());

  const { error } = existing
    ? await supabase.from("hashtags").update(fields).eq("id", existing)
    : await supabase.from("hashtags").insert(fields);

  if (error) {
    console.error(`  ${row.tag}: ${error.message}`);
    failed++;
  } else if (existing) {
    updated++;
  } else {
    created++;
  }
}

console.log(`\n${created} created, ${updated} updated, ${failed} failed.`);

const { count } = await supabase
  .from("hashtags")
  .select("*", { head: true, count: "exact" });
console.log(`Library now holds ${count} tags.`);
