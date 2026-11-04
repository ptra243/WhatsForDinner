-- Recipe method checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/methods.sql
-- Members see and change the methods of their own household's recipes only (Row Level Security
-- through the recipe). A planned dish's method must be one of its own recipe's; deleting the
-- method puts the dish back on the default. Positions count within each method. Saving the
-- recipe from the form (save_recipe) changes the default steps and keeps the methods.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Method check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Runs a statement that must be refused with the given error state.
create function pg_temp.refused(what text, stmt text, state text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Method check failed: % succeeded', what;
exception when others then
  if sqlstate <> state then raise; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'methods-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'methods-b@example.test');
insert into public.households (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Methods A'),
  ('00000000-0000-4000-8000-0000000000a2', 'Methods B');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'owner');
insert into public.recipes (id, household_id, slug, name, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'ragu', 'Ragù', 25, 180),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'dal', 'Dal', 15, 40),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a2', 'stew', 'Stew', 20, 150);
insert into public.recipe_methods (id, recipe_id, name, equipment, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'Pressure cooker', 'pressure cooker', 25, 80),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e2', 'Pressure cooker', 'pressure cooker', 10, 25),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e3', 'Slow cooker', 'slow cooker', 20, 480);
-- The default steps and the pressure cooker's both start at position 0.
insert into public.recipe_steps (recipe_id, method_id, position, text, timer_mins) values
  ('00000000-0000-4000-8000-0000000000e1', null, 0, 'Brown the beef.', 10),
  ('00000000-0000-4000-8000-0000000000e1', null, 1, 'Simmer.', 150),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 0, 'Brown on sauté.', 10),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 1, 'Cook on high pressure.', 45);
insert into public.meal_plan_dishes (id, household_id, week_start, day, recipe_id, role, servings, method_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'tue',
   '00000000-0000-4000-8000-0000000000e1', 'main', 4, '00000000-0000-4000-8000-0000000000f1');

-- 1. Positions count within each method: a second default step at 0 is refused.
select pg_temp.refused('a second default step at position 0',
  $$insert into public.recipe_steps (recipe_id, position, text) values ('00000000-0000-4000-8000-0000000000e1', 0, 'Again.')$$,
  '23505');
-- A step's method must be one of its own recipe's.
select pg_temp.refused('a step with another recipe''s method',
  $$insert into public.recipe_steps (recipe_id, method_id, position, text)
    values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f1', 5, 'Wrong.')$$,
  '23503');
-- Total can't be less than hands-on, and two methods of a recipe can't share a name.
select pg_temp.refused('total under hands-on',
  $$insert into public.recipe_methods (recipe_id, name, active_mins, total_mins)
    values ('00000000-0000-4000-8000-0000000000e1', 'Oven', 30, 20)$$,
  '23514');
select pg_temp.refused('a duplicate method name',
  $$insert into public.recipe_methods (recipe_id, name) values ('00000000-0000-4000-8000-0000000000e1', 'Pressure cooker')$$,
  '23505');

-- 2. A dish's method must belong to its recipe.
select pg_temp.refused('a dish with another recipe''s method',
  $$update public.meal_plan_dishes set method_id = '00000000-0000-4000-8000-0000000000f2'
    where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23503');
select pg_temp.refused('a dish planned with another household''s method',
  $$insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, role, servings, method_id)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'wed', '00000000-0000-4000-8000-0000000000e1', 'main', 4,
            '00000000-0000-4000-8000-0000000000f3')$$,
  '23503');
-- Changing the dish's recipe without its method is refused too.
select pg_temp.refused('a dish moved to another recipe keeping the method',
  $$update public.meal_plan_dishes set recipe_id = '00000000-0000-4000-8000-0000000000e2'
    where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23503');

-- 3. Row Level Security through the recipe, as user A.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select pg_temp.expect('methods A sees', (select string_agg(name || ' ' || recipe_id, ', ' order by recipe_id) from public.recipe_methods),
  'Pressure cooker 00000000-0000-4000-8000-0000000000e1, Pressure cooker 00000000-0000-4000-8000-0000000000e2'::text);
select pg_temp.expect('method steps A sees', (select count(*) from public.recipe_steps where method_id is not null), 2::bigint);
select pg_temp.refused('A adds a method to B''s recipe',
  $$insert into public.recipe_methods (recipe_id, name) values ('00000000-0000-4000-8000-0000000000e3', 'Oven')$$,
  '42501');
update public.recipe_methods set total_mins = 1 where id = '00000000-0000-4000-8000-0000000000f3';
delete from public.recipe_methods where id = '00000000-0000-4000-8000-0000000000f3';
insert into public.recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
values ('00000000-0000-4000-8000-0000000000e2', 'Slow cooker', 'slow cooker', 10, 360);

-- 4. Saving the recipe from the form edits the default steps and keeps the method and its steps.
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Ragù', 'course', 'main', 'serves', 6,
  'active_mins', 30, 'total_mins', 200, 'ingredients', '[]'::jsonb,
  'steps', jsonb_build_array(jsonb_build_object('text', 'Simmer for hours.', 'timer_mins', 180))));
reset role;
select pg_temp.expect('B''s method untouched by A', (select total_mins from public.recipe_methods where id = '00000000-0000-4000-8000-0000000000f3'), 480);
select pg_temp.expect('A added a method to its own recipe',
  (select count(*) from public.recipe_methods where recipe_id = '00000000-0000-4000-8000-0000000000e2'), 2::bigint);
select pg_temp.expect('default steps after the save',
  (select string_agg(text, ' | ' order by position) from public.recipe_steps
   where recipe_id = '00000000-0000-4000-8000-0000000000e1' and method_id is null), 'Simmer for hours.'::text);
select pg_temp.expect('method steps after the save',
  (select string_agg(text, ' | ' order by position) from public.recipe_steps
   where method_id = '00000000-0000-4000-8000-0000000000f1'), 'Brown on sauté. | Cook on high pressure.'::text);
select pg_temp.expect('dish keeps its method after the save',
  (select method_id from public.meal_plan_dishes where id = '00000000-0000-4000-8000-0000000000d1'),
  '00000000-0000-4000-8000-0000000000f1'::uuid);

-- 5. Moving the night keeps the method.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select public.move_night('00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'tue', '2026-11-02', 'thu');
reset role;
select pg_temp.expect('moved dish keeps its method',
  (select day || ' ' || method_id from public.meal_plan_dishes where id = '00000000-0000-4000-8000-0000000000d1'),
  'thu 00000000-0000-4000-8000-0000000000f1'::text);

-- 6. Deleting the method puts the dish on the default and takes the method's steps with it.
delete from public.recipe_methods where id = '00000000-0000-4000-8000-0000000000f1';
select pg_temp.expect('dish back on the default',
  (select method_id from public.meal_plan_dishes where id = '00000000-0000-4000-8000-0000000000d1'), null::uuid);
select pg_temp.expect('dish still planned',
  (select count(*) from public.meal_plan_dishes where household_id = '00000000-0000-4000-8000-0000000000a1'), 1::bigint);
select pg_temp.expect('method steps gone',
  (select count(*) from public.recipe_steps where recipe_id = '00000000-0000-4000-8000-0000000000e1'), 1::bigint);

-- 7. Deleting the recipe takes its methods.
delete from public.recipes where id = '00000000-0000-4000-8000-0000000000e2';
select pg_temp.expect('methods of a deleted recipe',
  (select count(*) from public.recipe_methods where recipe_id = '00000000-0000-4000-8000-0000000000e2'), 0::bigint);

\echo 'Method checks passed'
rollback;
