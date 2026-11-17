-- Step cue and tip checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/step_cues.sql
-- A step's cue (what done looks like) and tip (its usual problem and the fix) are optional; one
-- that is there has something in it and is at most 140 characters. save_recipe saves both,
-- trimmed, clears one sent blank or not sent, refuses one that is too long, and leaves other
-- methods' steps alone. (create_household's copy of them is checked in households.sql.)

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Step cue check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Runs a statement that must be refused with the given error state.
create function pg_temp.refused(what text, stmt text, state text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Step cue check failed: % succeeded', what;
exception when others then
  if sqlstate <> state then raise; end if;
end $$;

-- The recipe's own steps as "text [cue] [tip]", in order; "-" for none.
create function pg_temp.steps(rid uuid) returns text language sql as $$
  select string_agg(format('%s [%s] [%s]', s.text, coalesce(s.cue, '-'), coalesce(s.tip, '-')), ', ' order by s.position)
  from public.recipe_steps s where s.recipe_id = rid and s.method_id is null
$$;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'cue-a@example.test');
insert into public.households (id, name) values ('00000000-0000-4000-8000-0000000000a1', 'Cue A');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner');
insert into public.recipes (id, household_id, slug, name, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'pasta', 'Creamy chicken pasta', 20, 30);
insert into public.recipe_methods (id, recipe_id, name, equipment, active_mins, total_mins) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'Slow cooker', 'slow cooker', 10, 240);

-- 1. Both are optional, and can be set alone or together, 140 characters at most.
insert into public.recipe_steps (id, recipe_id, method_id, position, text, cue, tip) values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000e1', null, 0, 'Fry the mushrooms.', 'browned at the edges',
   'Soaking up the oil is normal; keep going, don''t add more.'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000e1', null, 1, 'Add the carrots.', repeat('x', 140), null),
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-0000000000e1', null, 2, 'Serve.', null, null),
  ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 0, 'Cook on low.',
   'the chicken pulls apart', repeat('y', 140));
select pg_temp.expect('a step with neither',
  (select cue is null and tip is null from public.recipe_steps where id = '00000000-0000-4000-8000-000000000053'), true);

-- 2. Never an empty or blank string, never over 140 characters.
select pg_temp.refused('an empty cue',
  $$insert into public.recipe_steps (recipe_id, position, text, cue) values ('00000000-0000-4000-8000-0000000000e1', 3, 'Rest.', '')$$, '23514');
select pg_temp.refused('a blank cue',
  $$insert into public.recipe_steps (recipe_id, position, text, cue) values ('00000000-0000-4000-8000-0000000000e1', 3, 'Rest.', '   ')$$, '23514');
select pg_temp.refused('a cue of 141 characters',
  $$insert into public.recipe_steps (recipe_id, position, text, cue) values ('00000000-0000-4000-8000-0000000000e1', 3, 'Rest.', repeat('x', 141))$$, '23514');
select pg_temp.refused('an empty tip',
  $$insert into public.recipe_steps (recipe_id, position, text, tip) values ('00000000-0000-4000-8000-0000000000e1', 3, 'Rest.', '')$$, '23514');
select pg_temp.refused('a blank tip',
  $$update public.recipe_steps set tip = ' ' where id = '00000000-0000-4000-8000-000000000053'$$, '23514');
select pg_temp.refused('a tip of 141 characters',
  $$update public.recipe_steps set tip = repeat('x', 141) where id = '00000000-0000-4000-8000-000000000053'$$, '23514');

-- 3. save_recipe, as the household's owner: keeps, sets, trims and clears them.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Creamy chicken pasta', 'active_mins', 20, 'total_mins', 30,
  'steps', jsonb_build_array(
    -- Sent as they were: kept.
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Fry the mushrooms.', 'cue', 'browned at the edges',
                       'tip', 'Soaking up the oil is normal; keep going, don''t add more.'),
    -- A cue sent blank and a tip sent null: the cue is cleared, the step has no tip.
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000052', 'text', 'Add the carrots.', 'cue', '  ', 'tip', null),
    -- An old step given both, with spaces to trim.
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000053', 'text', 'Serve.', 'cue', ' the sauce clings to the pasta ',
                       'tip', ' If it is too thick, loosen it with pasta water. '),
    -- A new step with a tip only, and one with neither key.
    jsonb_build_object('text', 'Rest.', 'tip', 'If it sets, stir in a splash of water.'),
    jsonb_build_object('text', 'Eat.'))));
select pg_temp.expect('the steps saved', pg_temp.steps('00000000-0000-4000-8000-0000000000e1'),
  'Fry the mushrooms. [browned at the edges] [Soaking up the oil is normal; keep going, don''t add more.], '
  || 'Add the carrots. [-] [-], '
  || 'Serve. [the sauce clings to the pasta] [If it is too thick, loosen it with pasta water.], '
  || 'Rest. [-] [If it sets, stir in a splash of water.], '
  || 'Eat. [-] [-]');
select pg_temp.expect('the slow cooker''s step kept its cue and tip',
  (select cue || ' / ' || char_length(tip) from public.recipe_steps where id = '00000000-0000-4000-8000-000000000054'),
  'the chicken pulls apart / 140');

-- A step sent without its cue loses it, like every other field of the step.
select public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
  'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Creamy chicken pasta', 'active_mins', 20, 'total_mins', 30,
  'steps', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000051', 'text', 'Fry the mushrooms.', 'cue', repeat('x', 140)))));
select pg_temp.expect('a cue of 140 characters saved and the tip cleared', pg_temp.steps('00000000-0000-4000-8000-0000000000e1'),
  'Fry the mushrooms. [' || repeat('x', 140) || '] [-]');

-- 4. One over 140 characters is refused, naming the step, and nothing is saved.
do $$
begin
  perform public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
    'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Renamed', 'active_mins', 20, 'total_mins', 30,
    'steps', jsonb_build_array(
      jsonb_build_object('text', 'Fry.'),
      jsonb_build_object('text', 'Simmer.', 'cue', repeat('x', 141)))));
  raise exception 'Step cue check failed: a cue of 141 characters saved';
exception when others then
  if sqlerrm not like 'Step 2: keep "Done when" to 140 characters%' then raise; end if;
end $$;
do $$
begin
  perform public.save_recipe('00000000-0000-4000-8000-0000000000a1', jsonb_build_object(
    'id', '00000000-0000-4000-8000-0000000000e1', 'name', 'Renamed', 'active_mins', 20, 'total_mins', 30,
    'steps', jsonb_build_array(jsonb_build_object('text', 'Fry.', 'tip', repeat('x', 141)))));
  raise exception 'Step cue check failed: a tip of 141 characters saved';
exception when others then
  if sqlerrm not like 'Step 1: keep the tip to 140 characters%' then raise; end if;
end $$;
select pg_temp.expect('nothing saved by the refused saves',
  (select name from public.recipes where id = '00000000-0000-4000-8000-0000000000e1') || ': ' || pg_temp.steps('00000000-0000-4000-8000-0000000000e1'),
  'Creamy chicken pasta: Fry the mushrooms. [' || repeat('x', 140) || '] [-]');

\echo 'Step cue checks passed'
rollback;
