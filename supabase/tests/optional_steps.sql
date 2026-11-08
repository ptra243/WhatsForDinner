-- Optional step checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/optional_steps.sql
-- A step is optional only with its minutes and why. A planned dish's extras are optional steps of
-- its own recipe and method: writing any other is refused, and a change of method or recipe
-- quietly drops those that no longer fit. save_recipe saves optional steps and drops extras that
-- stop being optional; move_night moves a dish's extras with it.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Optional step check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Runs a statement that must be refused with the given error state.
create function pg_temp.refused(what text, stmt text, state text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Optional step check failed: % succeeded', what;
exception when others then
  if sqlstate <> state then raise; end if;
end $$;

-- The dish's extras, by step text.
create function pg_temp.extras(dish uuid) returns text
language sql as $$
  select coalesce(string_agg(s.text, ', ' order by x.n), '-')
  from public.meal_plan_dishes d
  cross join unnest(d.extras) with ordinality as x(id, n)
  join public.recipe_steps s on s.id = x.id
  where d.id = dish
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'optional-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'optional-b@example.test');
insert into public.households (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Optional A'),
  ('00000000-0000-4000-8000-0000000000a2', 'Optional B');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'owner');
insert into public.recipes (id, household_id, slug, name, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'stir-fry', 'Beef stir-fry', 20, 25),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'dal', 'Dal', 15, 40),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a2', 'stew', 'Stew', 20, 150);
insert into public.recipe_methods (id, recipe_id, name, equipment, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'Air fryer', 'air fryer', 15, 25);
insert into public.recipe_steps (id, recipe_id, method_id, position, text, optional, extra_mins, why) values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000e1', null, 0, 'Velvet the beef.', true, 15, 'silkier, more tender'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000e1', null, 1, 'Stir-fry the beef.', false, null, ''),
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-0000000000e1', null, 2, 'Fry some garlic chips.', true, 5, 'crunch'),
  ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 0, 'Marinate overnight.', true, 10, 'more flavour'),
  ('00000000-0000-4000-8000-000000000055', '00000000-0000-4000-8000-0000000000e2', null, 0, 'Temper the spices.', true, 5, 'more aroma'),
  ('00000000-0000-4000-8000-000000000056', '00000000-0000-4000-8000-0000000000e3', null, 0, 'Brown the meat.', true, 10, 'deeper flavour');
insert into public.meal_plan_dishes (id, household_id, week_start, day, recipe_id, role, servings) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'tue',
   '00000000-0000-4000-8000-0000000000e1', 'main', 4);

-- 1. Only an optional step has minutes or a why, and the minutes are above 0.
select pg_temp.refused('a required step with extra minutes',
  $$insert into public.recipe_steps (recipe_id, position, text, extra_mins) values ('00000000-0000-4000-8000-0000000000e2', 1, 'Serve.', 5)$$,
  '23514');
select pg_temp.refused('a required step with a why',
  $$insert into public.recipe_steps (recipe_id, position, text, why) values ('00000000-0000-4000-8000-0000000000e2', 1, 'Serve.', 'nicer')$$,
  '23514');
select pg_temp.refused('an optional step with 0 extra minutes',
  $$insert into public.recipe_steps (recipe_id, position, text, optional, extra_mins) values ('00000000-0000-4000-8000-0000000000e2', 1, 'Serve.', true, 0)$$,
  '23514');

-- 2. As household A: extras are the dish's own recipe's optional steps, for its method, in step order.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000051']::uuid[]
where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.expect('two extras, in step order', pg_temp.extras('00000000-0000-4000-8000-0000000000d1'),
  'Velvet the beef., Fry some garlic chips.');
select pg_temp.refused('a required step as an extra',
  $$update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000052']::uuid[] where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514');
select pg_temp.refused('another recipe''s optional step',
  $$update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000055']::uuid[] where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514');
select pg_temp.refused('another method''s optional step',
  $$update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000054']::uuid[] where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514');
select pg_temp.refused('another household''s optional step',
  $$update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000056']::uuid[] where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514');
select pg_temp.refused('a new dish with a required step as an extra',
  $$insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, role, servings, extras)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'wed', '00000000-0000-4000-8000-0000000000e1', 'main', 4,
            array['00000000-0000-4000-8000-000000000052']::uuid[])$$,
  '23514');

-- 3. move_night: the extras go with the dish.
select public.move_night('00000000-0000-4000-8000-0000000000a1', '2026-11-02', 'tue', '2026-11-02', 'thu');
select pg_temp.expect('moved to Thursday', (select day from public.meal_plan_dishes where id = '00000000-0000-4000-8000-0000000000d1'), 'thu'::text);
select pg_temp.expect('extras after the move', pg_temp.extras('00000000-0000-4000-8000-0000000000d1'),
  'Velvet the beef., Fry some garlic chips.');

-- 4. save_recipe: a step made required drops out of the dish's extras; optional steps are saved
-- with their minutes and why, and a required step loses any it was sent.
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Beef stir-fry', 'active_mins', 20, 'total_mins', 25,
  'steps', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Velvet the beef.', 'optional', true, 'extra_mins', 20, 'why', ' silkier '),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000052', 'text', 'Stir-fry the beef.'),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000053', 'text', 'Fry some garlic chips.', 'optional', false, 'extra_mins', 5, 'why', 'crunch'),
    jsonb_build_object('text', 'Pickle some chilli.', 'optional', true, 'extra_mins', 10, 'why', 'heat'))));
select pg_temp.expect('the steps saved',
  (select string_agg(text || ' ' || optional || ' ' || coalesce(extra_mins::text, '-') || ' ' || coalesce(nullif(why, ''), '-'), ', ' order by position)
   from public.recipe_steps where recipe_id = '00000000-0000-4000-8000-0000000000e1' and method_id is null),
  'Velvet the beef. true 20 silkier, Stir-fry the beef. false - -, Fry some garlic chips. false - -, Pickle some chilli. true 10 heat');
select pg_temp.expect('the step made required left the extras', pg_temp.extras('00000000-0000-4000-8000-0000000000d1'),
  'Velvet the beef.');
select pg_temp.expect('the air fryer''s optional step kept',
  (select optional from public.recipe_steps where id = '00000000-0000-4000-8000-000000000054'), true);
do $$
begin
  perform public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
    'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Beef stir-fry',
    'steps', jsonb_build_array(jsonb_build_object('text', 'Velvet.', 'optional', true, 'extra_mins', 0))));
  raise exception 'Optional step check failed: 0 extra minutes saved';
exception when others then
  if sqlerrm not like '%extra minutes must be more than 0%' then raise; end if;
end $$;

-- 5. A new method quietly drops the old method's extras; then its own optional step can be chosen.
update public.meal_plan_dishes set method_id = '00000000-0000-4000-8000-0000000000f1' where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.expect('extras after a new method', pg_temp.extras('00000000-0000-4000-8000-0000000000d1'), '-');
update public.meal_plan_dishes set extras = array['00000000-0000-4000-8000-000000000054']::uuid[] where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.expect('the air fryer''s extra', pg_temp.extras('00000000-0000-4000-8000-0000000000d1'), 'Marinate overnight.');

-- 6. Deleting a chosen step leaves its id until the next write, which drops it.
reset role;
delete from public.recipe_steps where id = '00000000-0000-4000-8000-000000000054';
update public.meal_plan_dishes set servings = 5 where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.expect('a deleted step dropped on the next write',
  (select cardinality(extras) from public.meal_plan_dishes where id = '00000000-0000-4000-8000-0000000000d1'), 0);

\echo 'Optional step checks passed'
rollback;
