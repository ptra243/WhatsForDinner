-- create_household checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 $(node supabase/tests/seed-counts.mjs) -f supabase/tests/households.sql
-- A new household gets its own copy of every example (with ingredients and steps) and the
-- example settings; two households get separate copies; re-seeding leaves them alone.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Household check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Recipes, ingredient rows and step rows in one household.
create function pg_temp.counts(hid uuid) returns text language sql as $$
  select format('%s recipes, %s examples, %s ingredients, %s steps, %s with created_by',
    (select count(*) from public.recipes where household_id = hid),
    (select count(*) from public.recipes where household_id = hid and is_example),
    (select count(*) from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.household_id = hid),
    (select count(*) from public.recipe_steps rs join public.recipes r on r.id = rs.recipe_id where r.household_id = hid),
    (select count(*) from public.recipes where household_id = hid and created_by is not null))
$$;

\ir ../seed/seed.sql
select private.template_household_id() as tid \gset
select format('%s recipes, %s examples, %s ingredients, %s steps, 0 with created_by',
              :recipes, :recipes, :recipe_ingredients, :steps) as want_counts \gset

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'household-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'household-b@example.test');

-- 1. Signed out: refused.
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
do $$
begin
  perform public.create_household('No one');
  raise exception 'signed-out call succeeded';
exception when raise_exception then
  if sqlerrm <> 'Sign in first' then raise; end if;
end $$;
reset role;
select pg_temp.expect('households after signed-out call', (select count(*) from public.households), 1::bigint);

-- 2. User A signs in for the first time, then again (or in a second tab).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select public.create_household('Home A') as hid_a \gset
select public.create_household('Home A again') as hid_a2 \gset
select count(*) as a_sees_recipes from public.recipes \gset
select count(*) as a_sees_households from public.households \gset

-- 3. User B.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select public.create_household('Home B') as hid_b \gset
reset role;

select pg_temp.expect('second call returns the same household', :'hid_a2'::uuid, :'hid_a'::uuid);
select pg_temp.expect('households', (select count(*) from public.households), 3::bigint);
select pg_temp.expect('separate households', :'hid_a'::uuid <> :'hid_b'::uuid, true);
select pg_temp.expect('A owner', (select role from public.household_members where household_id = :'hid_a'
                                  and user_id = '00000000-0000-4000-8000-00000000000a'), 'owner'::text);
select pg_temp.expect('B owner', (select role from public.household_members where household_id = :'hid_b'
                                  and user_id = '00000000-0000-4000-8000-00000000000b'), 'owner'::text);
select pg_temp.expect('members', (select count(*) from public.household_members), 2::bigint);
select pg_temp.expect('A copy', pg_temp.counts(:'hid_a'), :'want_counts'::text);
select pg_temp.expect('B copy', pg_temp.counts(:'hid_b'), :'want_counts'::text);
select pg_temp.expect('template unchanged', pg_temp.counts(:'tid'), :'want_counts'::text);
select pg_temp.expect('A settings', (select settings from public.household_settings where household_id = :'hid_a'),
                      (select settings from public.household_settings where household_id = :'tid'));
select pg_temp.expect('B settings', (select settings from public.household_settings where household_id = :'hid_b'),
                      (select settings from public.household_settings where household_id = :'tid'));
-- copies match the template field for field
select pg_temp.expect('A recipes differ from template',
  (select count(*) from (
     select slug, name, course, serves, active_mins, total_mins, provides, spice, tags, source, rating, notes
     from public.recipes where household_id = :'tid'
     except
     select slug, name, course, serves, active_mins, total_mins, provides, spice, tags, source, rating, notes
     from public.recipes where household_id = :'hid_a') d), 0::bigint);
select pg_temp.expect('A ingredients differ from template',
  (select count(*) from (
     select r.slug, ri.position, ri.ingredient_slug, ri.qty, ri.unit, ri.note
     from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.household_id = :'tid'
     except
     select r.slug, ri.position, ri.ingredient_slug, ri.qty, ri.unit, ri.note
     from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.household_id = :'hid_a') d), 0::bigint);
select pg_temp.expect('A steps differ from template',
  (select count(*) from (
     select r.slug, rs.position, rs.text, rs.timer_mins
     from public.recipe_steps rs join public.recipes r on r.id = rs.recipe_id where r.household_id = :'tid'
     except
     select r.slug, rs.position, rs.text, rs.timer_mins
     from public.recipe_steps rs join public.recipes r on r.id = rs.recipe_id where r.household_id = :'hid_a') d), 0::bigint);

-- 4. Row Level Security: A sees only A's recipes and household, never the template.
select pg_temp.expect('recipes A can see', :a_sees_recipes::bigint, :recipes::bigint);
select pg_temp.expect('households A can see', :a_sees_households::bigint, 1::bigint);

-- 5. Copies are separate: A's edits touch neither B nor the template; re-seeding touches no household.
select slug as some_slug from public.recipes where household_id = :'tid' order by slug limit 1 \gset
update public.recipes set rating = 5, notes = 'A note' where household_id = :'hid_a' and slug = :'some_slug';
delete from public.recipes where household_id = :'hid_a' and slug <> :'some_slug';
\ir ../seed/seed.sql
select pg_temp.expect('A recipes after edits and re-seed', (select count(*) from public.recipes where household_id = :'hid_a'), 1::bigint);
select pg_temp.expect('A note after re-seed', (select notes from public.recipes where household_id = :'hid_a'), 'A note'::text);
select pg_temp.expect('B copy after A edits', pg_temp.counts(:'hid_b'), :'want_counts'::text);
select pg_temp.expect('template after A edits', pg_temp.counts(:'tid'), :'want_counts'::text);

\echo 'Household checks passed'
rollback;
