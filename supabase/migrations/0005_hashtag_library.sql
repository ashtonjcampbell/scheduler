-- ============================================================================
-- Hashtag library: volume, retirement, and shuffle recipes
--
-- Modelled on the spreadsheet this replaces. That sheet held a tag, its
-- Instagram post count, a category, and a note; a second sheet parked tags
-- judged too low-volume to bother with; and a formula at the top drew a
-- random handful per category to build a set — roughly 5 tags, 2 from
-- elopement and 1-2 from whichever locations applied to the shoot.
--
-- NOTE ON THE SHUFFLE: it draws at random from the photographer's OWN
-- curated list. Nothing is generated, invented or suggested by AI, and it
-- must stay that way. See the absolute rule in AGENTS.md.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extra facts about a tag
-- ---------------------------------------------------------------------------

alter table hashtags
  -- Instagram's post count for the tag: the "volume" that decides whether a
  -- tag is worth using. Big numbers, hence bigint.
  add column if not exists post_count bigint,
  -- Retired rather than deleted. The spreadsheet's "too low volume" sheet was
  -- this idea: kept for reference, never offered by the shuffle.
  add column if not exists active boolean not null default true,
  add column if not exists notes text;

create index if not exists hashtags_active_idx
  on hashtags (category_id) where active;

-- ---------------------------------------------------------------------------
-- Saved shuffle recipes
--
-- A recipe is "how many tags from which categories" — e.g. a Mt Baker
-- elopement wants 2 elopement, 1 regional, 2 mt baker. Saved because the same
-- few shapes recur constantly, and retyping the counts every post is exactly
-- the friction the spreadsheet had.
-- ---------------------------------------------------------------------------

create table if not exists hashtag_recipes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- Optional volume band. Ignoring the 50-million-post tags in favour of
  -- mid-range ones is a real strategy, so it belongs in the recipe.
  min_posts  bigint,
  max_posts  bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hashtag_recipe_items (
  recipe_id   uuid not null references hashtag_recipes (id)  on delete cascade,
  category_id uuid not null references hashtag_categories (id) on delete cascade,
  -- How many tags to draw from this category. 0 is pointless, and Instagram
  -- caps a post at 30 anyway.
  count       smallint not null check (count between 1 and 30),

  primary key (recipe_id, category_id)
);

create index if not exists hashtag_recipe_items_recipe_idx
  on hashtag_recipe_items (recipe_id);

create or replace trigger hashtag_recipes_touch_updated_at
  before update on hashtag_recipes
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security, matching every other table
-- ---------------------------------------------------------------------------

alter table hashtag_recipes      enable row level security;
alter table hashtag_recipe_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['hashtag_recipes', 'hashtag_recipe_items']
  loop
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_owner_all', t
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
