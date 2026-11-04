-- Step ingredient checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/step_ingredients.sql
-- A step links only to its own recipe's ingredients; removing the step or the ingredient removes
-- the link. Members see and change the links of their own household's recipes only (Row Level
-- Security through the step's recipe). save_recipe saves a step's links from `uses`.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Step ingredient check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Runs a statement that must be refused with the given error state.
create function pg_temp.refused(what text, stmt text, state text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Step ingredient check failed: % succeeded', what;
exception when others then
  if sqlstate <> state then raise; end if;
end $$;

-- The ingredients a step uses, by name in recipe order.
create function pg_temp.uses(step uuid) returns text language sql as $$
  select coalesce(string_agg(i.name, ', ' order by ri.position), '-')
  from public.recipe_step_ingredients l
  join public.recipe_ingredients ri on ri.id = l.recipe_ingredient_id
  join public.ingredients i on i.slug = ri.ingredient_slug
  where l.step_id = step
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'links-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'links-b@example.test');
insert into public.households (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Links A'),
  ('00000000-0000-4000-8000-0000000000a2', 'Links B');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'owner');
insert into public.ingredients (slug, name, section) values
  ('links-beef', 'links beef', 'meat and seafood'),
  ('links-onion', 'links onion', 'fruit and veg'),
  ('links-carrot', 'links carrot', 'fruit and veg');
insert into public.recipes (id, household_id, slug, name) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'ragu', 'Ragù'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'dal', 'Dal'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a2', 'stew', 'Stew');
insert into public.recipe_ingredients (id, recipe_id, position, ingredient_slug, qty, unit) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000e1', 0, 'links-beef', 1, 'kg'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000e1', 1, 'links-onion', 1, 'each'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000e1', 2, 'links-carrot', 2, 'each'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000e2', 0, 'links-onion', 1, 'each'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-0000000000e3', 0, 'links-beef', 1, 'kg');
insert into public.recipe_methods (id, recipe_id, name) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'Pressure cooker');
insert into public.recipe_steps (id, recipe_id, method_id, position, text) values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000e1', null, 0, 'Brown the beef.'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000e1', null, 1, 'Soften the veg.'),
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 0, 'Brown on sauté.'),
  ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-0000000000e2', null, 0, 'Soften the onion.'),
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-0000000000e3', null, 0, 'Brown the beef.');

-- 1. A step links to its own recipe's ingredients, a method's step too.
insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id) values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000012'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000013'),
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000031');
select pg_temp.expect('step 2 uses', pg_temp.uses('00000000-0000-4000-8000-000000000052'), 'links onion, links carrot');

-- 2. The database refuses a link to another recipe's ingredient, in the same household or not,
-- and moving a link onto one.
select pg_temp.refused('a step using another recipe''s ingredient',
  $$insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
    values ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000012')$$,
  '23514');
select pg_temp.refused('a step using another household''s ingredient',
  $$insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
    values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000031')$$,
  '23514');
select pg_temp.refused('a link moved to another recipe''s step',
  $$update public.recipe_step_ingredients set step_id = '00000000-0000-4000-8000-000000000061'
    where step_id = '00000000-0000-4000-8000-000000000051'$$,
  '23514');
select pg_temp.refused('the same link twice',
  $$insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
    values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000011')$$,
  '23505');

-- 3. Row Level Security through the step's recipe, as user A.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select pg_temp.expect('links A sees', (select count(*) from public.recipe_step_ingredients), 4::bigint);
select pg_temp.refused('A links B''s step to B''s ingredient',
  $$insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
    values ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000031')$$,
  '23514');
delete from public.recipe_step_ingredients where step_id = '00000000-0000-4000-8000-000000000071';
insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
values ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000021');

-- 4. save_recipe saves `uses` (positions in the ingredients sent), keeps the links of a step
-- sent without it, and refuses a position past the ingredients.
select pg_temp.refused('a step using a position past the ingredients',
  $$select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
    'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Ragù', 'course', 'main', 'serves', 6,
    'ingredients', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000011', 'name', 'links beef', 'qty', 1, 'unit', 'kg')),
    'steps', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Brown the beef.', 'uses', jsonb_build_array(1)))))$$,
  'P0001');
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Ragù', 'course', 'main', 'serves', 6,
  'ingredients', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000012', 'name', 'links onion', 'qty', 1, 'unit', 'each'),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000011', 'name', 'links beef', 'qty', 1, 'unit', 'kg'),
    jsonb_build_object('name', 'links celery', 'qty', 2, 'unit', 'each', 'section', 'fruit and veg')),
  'steps', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Brown the beef.', 'uses', jsonb_build_array(1)),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000052', 'text', 'Soften the veg.', 'uses', jsonb_build_array(0, 2, 2)),
    jsonb_build_object('text', 'Season.', 'uses', '[]'::jsonb))));
select pg_temp.expect('step 1 after the save', pg_temp.uses('00000000-0000-4000-8000-000000000051'), 'links beef');
select pg_temp.expect('step 2 after the save: the carrot is gone, the new celery linked',
  pg_temp.uses('00000000-0000-4000-8000-000000000052'), 'links onion, links celery');
select pg_temp.expect('new step uses nothing',
  (select pg_temp.uses(id) from public.recipe_steps where recipe_id = '00000000-0000-4000-8000-0000000000e1' and text = 'Season.'), '-');
select pg_temp.expect('method step keeps its link', pg_temp.uses('00000000-0000-4000-8000-000000000053'), 'links beef');
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Ragù', 'course', 'main', 'serves', 6,
  'ingredients', (select jsonb_agg(jsonb_build_object('id', ri.id, 'name', i.name, 'qty', ri.qty, 'unit', ri.unit) order by ri.position)
                  from public.recipe_ingredients ri join public.ingredients i on i.slug = ri.ingredient_slug
                  where ri.recipe_id = '00000000-0000-4000-8000-0000000000e1'),
  'steps', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000052', 'text', 'Soften the veg first.'),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Brown the beef.'))));
select pg_temp.expect('a step sent without uses keeps its links',
  pg_temp.uses('00000000-0000-4000-8000-000000000052'), 'links onion, links celery');
reset role;
select pg_temp.expect('B''s link untouched by A', pg_temp.uses('00000000-0000-4000-8000-000000000071'), 'links beef');
select pg_temp.expect('A linked its own dal step', pg_temp.uses('00000000-0000-4000-8000-000000000061'), 'links onion');

-- 5. Cascade: deleting an ingredient or a step removes its links, and the rest stay.
delete from public.recipe_ingredients where id = '00000000-0000-4000-8000-000000000012';
select pg_temp.expect('links after deleting the onion', pg_temp.uses('00000000-0000-4000-8000-000000000052'), 'links celery');
delete from public.recipe_steps where id = '00000000-0000-4000-8000-000000000051';
select pg_temp.expect('links of a deleted step',
  (select count(*) from public.recipe_step_ingredients where step_id = '00000000-0000-4000-8000-000000000051'), 0::bigint);
select pg_temp.expect('the beef''s other link stays', pg_temp.uses('00000000-0000-4000-8000-000000000053'), 'links beef');
delete from public.recipes where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.expect('links left after deleting the recipe',
  (select count(*) from public.recipe_step_ingredients), 2::bigint);

\echo 'Step ingredient checks passed'
rollback;
