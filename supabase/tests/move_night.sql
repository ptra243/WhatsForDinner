-- move_night checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/move_night.sql
-- A dinner moves to an empty night or swaps with a planned one, within a week or into the
-- next, keeping each dish's role, position, servings and swaps; the skip-check and the lock
-- go with the dinner and the time override stays with the night; cooked nights and other
-- households are refused, and a refused move changes nothing.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Move check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- A night's dishes as "recipe:role:position:servings:swaps", in order.
create function pg_temp.night(hid uuid, wk date, d text) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s:%s:%s', r.slug, x.role, x.position, x.servings, x.swaps), ' '
                             order by x.position), '')
  from public.meal_plan_dishes x join public.recipes r on r.id = x.recipe_id
  where x.household_id = hid and x.week_start = wk and x.day = d
$$;

-- Expects a move to be refused with `msg`.
create function pg_temp.refused(hid uuid, fw date, fd text, tw date, td text, msg text) returns void
language plpgsql as $$
begin
  perform public.move_night(hid, fw, fd, tw, td);
  raise exception 'Move check failed: move % % to % % succeeded', fw, fd, tw, td;
exception when raise_exception then
  if sqlerrm <> msg then raise; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'move-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'move-b@example.test');
insert into public.households (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Move A'),
  ('00000000-0000-4000-8000-0000000000a2', 'Move B');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'owner');
insert into public.recipes (id, household_id, slug, name, course, serves) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'curry', 'Curry', 'main', 4),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'rice', 'Rice', 'side', 4),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1', 'stew', 'Stew', 'main', 4);
\set hid '00000000-0000-4000-8000-0000000000a1'
-- Week of 2 Nov 2026: curry (6 serves, a swap) with rice on Thursday, stew on Friday, Monday cooked.
insert into public.meal_plan_dishes (household_id, week_start, day, position, recipe_id, role, servings, swaps) values
  (:'hid', '2026-11-02', 'thu', 0, '00000000-0000-4000-8000-0000000000e1', 'main', 6,
   '[{"from": "chicken thigh", "to": "tofu", "qty": 500, "unit": "g"}]'),
  (:'hid', '2026-11-02', 'thu', 1, '00000000-0000-4000-8000-0000000000e2', 'side', 4, '[]'),
  (:'hid', '2026-11-02', 'fri', 0, '00000000-0000-4000-8000-0000000000e3', 'main', 4, '[]'),
  (:'hid', '2026-11-02', 'mon', 0, '00000000-0000-4000-8000-0000000000e3', 'main', 4, '[]');
insert into public.meal_plan_nights (household_id, week_start, day, cooked, skip_check, locked, minutes) values
  (:'hid', '2026-11-02', 'mon', true, false, false, null),
  (:'hid', '2026-11-02', 'thu', false, true, true, 20);
select pg_temp.night(:'hid', '2026-11-02', 'thu') as thu_dinner \gset
select pg_temp.night(:'hid', '2026-11-02', 'fri') as fri_dinner \gset

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';

-- A night's flags as "skip_check:locked:minutes".
create function pg_temp.flags(hid uuid, wk date, d text) returns text language sql as $$
  select format('%s:%s:%s', skip_check, locked, coalesce(minutes::text, '-'))
  from public.meal_plan_nights where household_id = hid and week_start = wk and day = d
$$;

-- 1. To an empty night: Thursday's dinner (with its skip-check and lock) goes to Saturday;
-- Thursday keeps its 20 minutes.
select public.move_night(:'hid', '2026-11-02', 'thu', '2026-11-02', 'sat');
select pg_temp.expect('Saturday after the move', pg_temp.night(:'hid', '2026-11-02', 'sat'), :'thu_dinner'::text);
select pg_temp.expect('Thursday after the move', pg_temp.night(:'hid', '2026-11-02', 'thu'), ''::text);
select pg_temp.expect('Saturday flags', pg_temp.flags(:'hid', '2026-11-02', 'sat'), 't:t:-'::text);
select pg_temp.expect('Thursday flags', pg_temp.flags(:'hid', '2026-11-02', 'thu'), 'f:f:20'::text);

-- 2. With a planned night: Saturday and Friday swap.
select public.move_night(:'hid', '2026-11-02', 'sat', '2026-11-02', 'fri');
select pg_temp.expect('Friday after the swap', pg_temp.night(:'hid', '2026-11-02', 'fri'), :'thu_dinner'::text);
select pg_temp.expect('Saturday after the swap', pg_temp.night(:'hid', '2026-11-02', 'sat'), :'fri_dinner'::text);
select pg_temp.expect('Friday flags', pg_temp.flags(:'hid', '2026-11-02', 'fri'), 't:t:-'::text);
select pg_temp.expect('Saturday flags after the swap', pg_temp.flags(:'hid', '2026-11-02', 'sat'), 'f:f:-'::text);

-- 3. Into next week, and back.
select public.move_night(:'hid', '2026-11-02', 'fri', '2026-11-09', 'tue');
select pg_temp.expect('next Tuesday', pg_temp.night(:'hid', '2026-11-09', 'tue'), :'thu_dinner'::text);
select pg_temp.expect('Friday after moving out', pg_temp.night(:'hid', '2026-11-02', 'fri'), ''::text);
select public.move_night(:'hid', '2026-11-09', 'tue', '2026-11-02', 'thu');
select pg_temp.expect('Thursday after moving back', pg_temp.night(:'hid', '2026-11-02', 'thu'), :'thu_dinner'::text);
select pg_temp.expect('Thursday flags after moving back', pg_temp.flags(:'hid', '2026-11-02', 'thu'), 't:t:20'::text);

-- 4. Refused: a cooked night either way, the same night, another household.
select pg_temp.refused(:'hid', '2026-11-02', 'mon', '2026-11-02', 'tue', 'A cooked night cannot be moved');
select pg_temp.refused(:'hid', '2026-11-02', 'thu', '2026-11-02', 'mon', 'A cooked night cannot be moved');
select pg_temp.refused(:'hid', '2026-11-02', 'thu', '2026-11-02', 'thu', 'Pick another night');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select pg_temp.refused(:'hid', '2026-11-02', 'thu', '2026-11-02', 'wed', 'Not your household');
reset role;

select pg_temp.expect('Monday unchanged', pg_temp.night(:'hid', '2026-11-02', 'mon'), 'stew:main:0:4:[]'::text);
select pg_temp.expect('Thursday unchanged', pg_temp.night(:'hid', '2026-11-02', 'thu'), :'thu_dinner'::text);
select pg_temp.expect('anon cannot call it', has_function_privilege('anon',
  'public.move_night(uuid, date, text, date, text)', 'execute'), false);

rollback;
\o
\echo 'move_night checks passed'
