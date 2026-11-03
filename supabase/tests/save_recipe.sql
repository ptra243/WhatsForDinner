-- save_recipe checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/save_recipe.sql
-- Adding makes a unique slug and sets created_by; new ingredients are added with their section
-- and allergens. Editing keeps the ids of rows that are still there, reorders, adds and removes
-- the rest, makes an example the household's own and leaves planned dishes alone. A bad unit,
-- a new ingredient without a section, a duplicate name or another household's recipe rejects
-- the whole save and changes nothing.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Save check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects a save to be refused with a message starting with `msg`.
create function pg_temp.refused(hid uuid, recipe jsonb, msg text) returns void
language plpgsql as $$
begin
  perform public.save_recipe(hid, recipe);
  raise exception 'Save check failed: % succeeded', recipe->>'name';
exception when raise_exception or check_violation then
  if sqlerrm not like msg || '%' then raise; end if;
end $$;

-- A recipe's ingredients as "name:qty unit:note", and its steps as "text/timer", in order.
create function pg_temp.ings(rid uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s %s:%s', i.name, ri.qty, ri.unit, ri.note), ' | ' order by ri.position), '')
  from public.recipe_ingredients ri join public.ingredients i on i.slug = ri.ingredient_slug
  where ri.recipe_id = rid
$$;
create function pg_temp.steps(rid uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s/%s', s.text, s.timer_mins), ' | ' order by s.position), '')
  from public.recipe_steps s where s.recipe_id = rid
$$;
-- The row id at a position.
create function pg_temp.ing_id(rid uuid, pos integer) returns uuid language sql as $$
  select id from public.recipe_ingredients where recipe_id = rid and position = pos
$$;
create function pg_temp.step_id(rid uuid, pos integer) returns uuid language sql as $$
  select id from public.recipe_steps where recipe_id = rid and position = pos
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'save-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'save-b@example.test');
insert into public.households (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Save A'),
  ('00000000-0000-4000-8000-0000000000a2', 'Save B');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'owner');
insert into public.ingredients (slug, name, section, allergens) values
  ('save-onion', 'save onion', 'fruit and veg', '{}'),
  ('save-rice', 'save rice', 'pantry', '{}'),
  ('save-butter', 'save butter', 'dairy and fridge', array['milk'])
on conflict do nothing;
-- An example recipe in A, planned on a night with a swap.
insert into public.recipes (id, household_id, slug, name, course, serves, is_example, created_by) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'pilaf', 'Pilaf', 'main', 4, true, null);
insert into public.recipe_ingredients (recipe_id, position, ingredient_slug, qty, unit, note) values
  ('00000000-0000-4000-8000-0000000000e1', 0, 'save-onion', 1, 'each', 'diced'),
  ('00000000-0000-4000-8000-0000000000e1', 1, 'save-rice', 300, 'g', ''),
  ('00000000-0000-4000-8000-0000000000e1', 2, 'save-butter', 2, 'tbsp', '');
insert into public.recipe_steps (recipe_id, position, text, timer_mins) values
  ('00000000-0000-4000-8000-0000000000e1', 0, 'Fry the onion.', null),
  ('00000000-0000-4000-8000-0000000000e1', 1, 'Simmer the rice.', 15);
insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, role, servings, swaps) values
  ('00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'tue', '00000000-0000-4000-8000-0000000000e1', 'main', 4,
   '[{"from": "save butter", "to": "save onion", "qty": null, "unit": null}]');
\set hid '00000000-0000-4000-8000-0000000000a1'
\set pilaf '00000000-0000-4000-8000-0000000000e1'
select pg_temp.ing_id(:'pilaf', 0) as onion_row, pg_temp.ing_id(:'pilaf', 1) as rice_row,
       pg_temp.step_id(:'pilaf', 1) as simmer_row \gset

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';

-- 1. Add a recipe with an existing and a new ingredient.
select public.save_recipe(:'hid', '{
  "name": "  Chicken & leek pie ", "course": "main", "serves": 6, "active_mins": 30, "total_mins": 80,
  "provides": ["protein", "veg"], "spice": 0, "tags": ["weekend"], "source": "Nan", "notes": "Freeze half.",
  "ingredients": [
    {"name": "save onion", "qty": 2, "unit": "each", "note": ""},
    {"name": "Save  Leek", "qty": 1, "unit": "bunch", "note": "sliced", "section": "fruit and veg", "allergens": []},
    {"name": "save pastry", "qty": 1, "unit": "each", "note": "", "section": "frozen", "allergens": ["wheat", "gluten"]}
  ],
  "steps": [{"text": "Soften the leek.", "timer_mins": null}, {"text": "Bake.", "timer_mins": 40}]
}') as pie \gset
select pg_temp.expect('new recipe', (select format('%s|%s|%s|%s|%s|%s|%s|%s', slug, name, serves, active_mins, total_mins,
  provides, is_example, created_by) from public.recipes where id = :'pie'),
  'chicken-leek-pie|Chicken & leek pie|6|30|80|{protein,veg}|f|00000000-0000-4000-8000-0000000000c1');
select pg_temp.expect('new recipe ingredients', pg_temp.ings(:'pie'),
  'save onion:2 each: | save leek:1 bunch:sliced | save pastry:1 each:');
select pg_temp.expect('new recipe steps', pg_temp.steps(:'pie'), 'Soften the leek./ | Bake./40');
select pg_temp.expect('new ingredient', (select format('%s|%s|%s', slug, section, allergens) from public.ingredients
  where name = 'save pastry'), 'save-pastry|frozen|{wheat,gluten}');

-- 2. Another name with the same slug gets the next free one; a name already used is refused.
select public.save_recipe(:'hid', '{"name": "Chicken, leek pie", "ingredients": [], "steps": []}') as pie2 \gset
select pg_temp.expect('second slug', (select slug from public.recipes where id = :'pie2'), 'chicken-leek-pie-2');
select pg_temp.refused(:'hid', '{"name": "chicken & LEEK pie", "ingredients": [], "steps": []}',
  'A recipe called chicken & LEEK pie already exists');
select pg_temp.refused(:'hid', '{"name": "Quick", "active_mins": 20, "total_mins": 10}', 'Total minutes');

-- 3. Edit the example: reorder, change, remove and add rows.
select public.save_recipe(:'hid', jsonb_build_object(
  'id', :'pilaf', 'name', 'Butter pilaf', 'course', 'main', 'serves', 4, 'provides', '["carb"]'::jsonb, 'tags', '[]'::jsonb,
  'source', '', 'notes', '',
  'ingredients', jsonb_build_array(
    jsonb_build_object('id', :'rice_row', 'name', 'save rice', 'qty', 400, 'unit', 'g', 'note', 'basmati'),
    jsonb_build_object('name', 'save stock', 'qty', 750, 'unit', 'ml', 'note', '', 'section', 'pantry', 'allergens', '[]'::jsonb),
    jsonb_build_object('id', :'onion_row', 'name', 'save onion', 'qty', 1, 'unit', 'each', 'note', 'diced')),
  'steps', jsonb_build_array(
    jsonb_build_object('id', :'simmer_row', 'text', 'Simmer the rice.', 'timer_mins', 18),
    jsonb_build_object('text', 'Rest it.', 'timer_mins', 5))));
select pg_temp.expect('edited ingredients', pg_temp.ings(:'pilaf'),
  'save rice:400 g:basmati | save stock:750 ml: | save onion:1 each:diced');
select pg_temp.expect('rice row kept its id', pg_temp.ing_id(:'pilaf', 0), :'rice_row'::uuid);
select pg_temp.expect('onion row kept its id', pg_temp.ing_id(:'pilaf', 2), :'onion_row'::uuid);
select pg_temp.expect('edited steps', pg_temp.steps(:'pilaf'), 'Simmer the rice./18 | Rest it./5');
select pg_temp.expect('simmer step kept its id', pg_temp.step_id(:'pilaf', 0), :'simmer_row'::uuid);
select pg_temp.expect('edited recipe', (select format('%s|%s|%s|%s', slug, name, is_example, created_by)
  from public.recipes where id = :'pilaf'), 'pilaf|Butter pilaf|f|00000000-0000-4000-8000-0000000000c1');
select pg_temp.expect('planned dish and swap', (select format('%s|%s', count(*), min(swaps::text))
  from public.meal_plan_dishes where recipe_id = :'pilaf'),
  '1|[{"to": "save onion", "qty": null, "from": "save butter", "unit": null}]');

-- 4. A bad unit or a new ingredient without a section rejects the whole save.
select pg_temp.ings(:'pilaf') as before_ings, pg_temp.steps(:'pilaf') as before_steps \gset
select pg_temp.refused(:'hid', jsonb_build_object('id', :'pilaf', 'name', 'Renamed pilaf',
  'ingredients', jsonb_build_array(
    jsonb_build_object('name', 'save garlic', 'qty', 2, 'unit', 'each', 'section', 'fruit and veg'),
    jsonb_build_object('id', :'rice_row', 'name', 'save rice', 'qty', 1, 'unit', 'cup')),
  'steps', '[]'::jsonb), 'save rice: "cup" is not a unit');
select pg_temp.refused(:'hid', jsonb_build_object('id', :'pilaf', 'name', 'Renamed pilaf',
  'ingredients', '[{"name": "save saffron", "qty": 1, "unit": "tsp"}]'::jsonb, 'steps', '[]'::jsonb), 'save saffron: pick its section');
select pg_temp.refused(:'hid', '{"name": "Bad", "ingredients": [{"name": "save rice", "qty": 1, "unit": "pinch"}]}',
  'save rice: "pinch" is not a unit');
select pg_temp.expect('name after refused saves', (select name from public.recipes where id = :'pilaf'), 'Butter pilaf');
select pg_temp.expect('ingredients after refused saves', pg_temp.ings(:'pilaf'), :'before_ings'::text);
select pg_temp.expect('steps after refused saves', pg_temp.steps(:'pilaf'), :'before_steps'::text);
select pg_temp.expect('no ingredient from a refused save', (select count(*) from public.ingredients
  where name in ('save garlic', 'save saffron')), 0::bigint);
select pg_temp.expect('no recipe from a refused save', (select count(*) from public.recipes where name = 'Bad'), 0::bigint);

-- 5. Another household can neither save into A nor edit A's recipe from its own.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select pg_temp.refused(:'hid', '{"name": "Intruder"}', 'Not your household');
select pg_temp.refused('00000000-0000-4000-8000-0000000000a2', jsonb_build_object('id', :'pilaf', 'name', 'Mine now'),
  'Recipe not found');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select pg_temp.expect('A''s recipe after B tried', (select name from public.recipes where id = :'pilaf'), 'Butter pilaf');

-- 6. Signed out, the function cannot be called at all.
reset role;
select pg_temp.expect('anon can call save_recipe',
  has_function_privilege('anon', 'public.save_recipe(uuid, jsonb)', 'execute'), false);

\o
\echo 'save_recipe checks passed'
rollback;
