-- ============================================================================
-- A default mix of hashtag categories for new posts
--
-- Reaching for the same "two elopement, two regional" on every post is the
-- kind of repetition the app exists to remove. The counts are remembered and
-- the shuffle panel opens already set to them.
--
-- Stored in the recipe tables that were built for exactly this — "how many
-- from which categories" — rather than a second, parallel place to keep the
-- same fact. `app_settings` only records which recipe is the default one.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table app_settings
  add column if not exists default_recipe_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'app_settings_default_recipe_fk'
  ) then
    alter table app_settings
      add constraint app_settings_default_recipe_fk
      foreign key (default_recipe_id) references hashtag_recipes (id)
      -- Deleting the recipe means "no default", not a broken reference.
      on delete set null;
  end if;
end $$;

notify pgrst, 'reload schema';
