-- Seed checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 $(node supabase/tests/seed-counts.mjs) -f supabase/tests/seed.sql
-- The expected counts (:ingredients, :recipes, :recipe_ingredients, :steps, :settings_keys)
-- come from seed/, so a seed that drops or duplicates rows fails here.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Seed check failed: % is %, expected %', what, got, want;
  end if;
end $$;

select private.template_household_id() as tid \gset

-- 1. The migrations create the template household, with no members and nothing in it.
select pg_temp.expect('households before the test', (select count(*) from public.households), 1::bigint);
select pg_temp.expect('template household exists', (select count(*) from public.households where id = :'tid'), 1::bigint);
select pg_temp.expect('template members', (select count(*) from public.household_members), 0::bigint);

-- 2. Run the seed twice: everything loads once, into the template.
\ir ../seed/seed.sql
\ir ../seed/seed.sql
select pg_temp.expect('ingredients', (select count(*) from public.ingredients), :ingredients::bigint);
select pg_temp.expect('recipes', (select count(*) from public.recipes), :recipes::bigint);
select pg_temp.expect('template recipes', (select count(*) from public.recipes where household_id = :'tid' and is_example), :recipes::bigint);
select pg_temp.expect('recipe ingredients', (select count(*) from public.recipe_ingredients), :recipe_ingredients::bigint);
select pg_temp.expect('recipe steps', (select count(*) from public.recipe_steps), :steps::bigint);
select pg_temp.expect('household settings rows', (select count(*) from public.household_settings), 1::bigint);
select pg_temp.expect('settings keys', (select count(*) from public.household_settings, jsonb_object_keys(settings)), :settings_keys::bigint);
select pg_temp.expect('households after seeding', (select count(*) from public.households), 1::bigint);

-- 3. The template follows seed/: stray recipes go, edited ones and settings are restored.
select slug as edited_slug from public.recipes order by slug limit 1 \gset
select name as edited_name from public.recipes where slug = :'edited_slug' \gset
update public.recipes set name = 'edited in the template' where slug = :'edited_slug';
delete from public.recipe_steps where recipe_id = (select id from public.recipes where slug = :'edited_slug');
insert into public.recipes (household_id, slug, name) values (:'tid', 'not-in-seed', 'Not in seed');
update public.household_settings set settings = '{"dinnerTime": "edited"}';

\ir ../seed/seed.sql
select pg_temp.expect('stray template recipe removed', (select count(*) from public.recipes where slug = 'not-in-seed'), 0::bigint);
select pg_temp.expect('edited template recipe name', (select name from public.recipes where slug = :'edited_slug'), :'edited_name'::text);
select pg_temp.expect('recipe steps after restore', (select count(*) from public.recipe_steps), :steps::bigint);
select pg_temp.expect('settings keys after restore', (select count(*) from public.household_settings, jsonb_object_keys(settings)), :settings_keys::bigint);
select pg_temp.expect('recipes after restore', (select count(*) from public.recipes), :recipes::bigint);

\echo 'Seed checks passed'
rollback;
