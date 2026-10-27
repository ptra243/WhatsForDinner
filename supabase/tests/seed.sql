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

select pg_temp.expect('households before the test', (select count(*) from public.households), 0::bigint);

-- 1. No household yet: only ingredients load.
\ir ../seed/seed.sql
select pg_temp.expect('ingredients (no household)', (select count(*) from public.ingredients), :ingredients::bigint);
select pg_temp.expect('recipes (no household)', (select count(*) from public.recipes), 0::bigint);
select pg_temp.expect('recipe ingredients (no household)', (select count(*) from public.recipe_ingredients), 0::bigint);
select pg_temp.expect('recipe steps (no household)', (select count(*) from public.recipe_steps), 0::bigint);
select pg_temp.expect('household settings (no household)', (select count(*) from public.household_settings), 0::bigint);

-- 2. A throwaway owner and household, with one setting the seed also has and one it does not.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000038', 'seed-check@example.test');
insert into public.households (id, name) values ('00000000-0000-4000-8000-000000000038', 'Seed check');
insert into public.household_members (household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000038', 'owner');
insert into public.household_settings (household_id, settings)
values ('00000000-0000-4000-8000-000000000038', '{"dinnerTime": "household value", "householdOnly": true}');

-- 3. Run the seed twice: everything loads once.
\ir ../seed/seed.sql
\ir ../seed/seed.sql
select pg_temp.expect('ingredients', (select count(*) from public.ingredients), :ingredients::bigint);
select pg_temp.expect('recipes', (select count(*) from public.recipes), :recipes::bigint);
select pg_temp.expect('example recipes', (select count(*) from public.recipes where is_example), :recipes::bigint);
select pg_temp.expect('recipe ingredients', (select count(*) from public.recipe_ingredients), :recipe_ingredients::bigint);
select pg_temp.expect('recipe steps', (select count(*) from public.recipe_steps), :steps::bigint);
select pg_temp.expect('household settings rows', (select count(*) from public.household_settings), 1::bigint);
select pg_temp.expect('household dinnerTime', (select settings->'dinnerTime' from public.household_settings), '"household value"'::jsonb);
select pg_temp.expect('household-only setting', (select settings->'householdOnly' from public.household_settings), 'true'::jsonb);
select pg_temp.expect('settings keys', (select count(*) from public.household_settings, jsonb_object_keys(settings)),
                      (:settings_keys + 1)::bigint);

-- 4. Household edits: keep one recipe (and drop a step from it), re-rate and annotate another.
select slug as kept_slug from public.recipes order by slug limit 1 \gset
select slug as rated_slug from public.recipes order by slug offset 1 limit 1 \gset
update public.recipes set is_example = false, name = 'kept by household' where slug = :'kept_slug';
delete from public.recipe_steps
where id = (select s.id from public.recipe_steps s join public.recipes r on r.id = s.recipe_id
            where r.slug = :'kept_slug' order by s.position desc limit 1);
select count(*) as kept_steps from public.recipe_steps s join public.recipes r on r.id = s.recipe_id
where r.slug = :'kept_slug' \gset
select case when rating = 1 then 2 else 1 end as new_rating from public.recipes where slug = :'rated_slug' \gset
update public.recipes set rating = :new_rating, notes = 'household note' where slug = :'rated_slug';

\ir ../seed/seed.sql
select pg_temp.expect('kept recipe is_example', (select is_example from public.recipes where slug = :'kept_slug'), false);
select pg_temp.expect('kept recipe name', (select name from public.recipes where slug = :'kept_slug'), 'kept by household');
select pg_temp.expect('kept recipe steps',
                      (select count(*) from public.recipe_steps s join public.recipes r on r.id = s.recipe_id
                       where r.slug = :'kept_slug'), :kept_steps::bigint);
select pg_temp.expect('edited rating', (select rating from public.recipes where slug = :'rated_slug'), :new_rating::smallint);
select pg_temp.expect('edited notes', (select notes from public.recipes where slug = :'rated_slug'), 'household note');
select pg_temp.expect('recipes after edits', (select count(*) from public.recipes), :recipes::bigint);
select pg_temp.expect('household dinnerTime after edits', (select settings->'dinnerTime' from public.household_settings), '"household value"'::jsonb);

\echo 'Seed checks passed'
rollback;
