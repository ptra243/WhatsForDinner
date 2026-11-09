-- Week start day checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/week_start.sql
-- Every week_start must be the household's start day (settings weekStartsOn, Monday when
-- missing). Changing it moves the household's weeks: dinners keep their dates; list marks,
-- extras and votes go to the week that overlaps most. Other households are untouched.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Week start check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with an error in `codes` (sqlstate).
create function pg_temp.refused(stmt text, codes text[]) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Week start check failed: % succeeded', stmt;
exception when others then
  if not sqlstate = any (codes) then raise; end if;
end $$;

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

-- The household's dinners as "date day recipe", in date order.
create function pg_temp.dinners(hid uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s %s %s', d.week_start, d.day,
           d.week_start + ((array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day)
                            - extract(isodow from d.week_start)::int + 7) % 7), r.slug), ', '
         order by d.week_start, d.day), '')
  from public.meal_plan_dishes d join public.recipes r on r.id = d.recipe_id where d.household_id = hid
$$;

-- The household's nights as "week:day cooked" (t or f).
create function pg_temp.nights(hid uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s %s', week_start, day, cooked), ', ' order by week_start, day), '')
  from public.meal_plan_nights where household_id = hid
$$;

-- The weeks of the household's marks, extras and votes.
create function pg_temp.weekly(hid uuid) returns text language sql as $$
  select format('marks %s; extras %s; votes %s',
    coalesce((select string_agg(week_start || ' ' || item_key, ', ' order by week_start) from public.list_marks where household_id = hid), '-'),
    coalesce((select string_agg(week_start || ' ' || name, ', ' order by week_start) from public.list_extras where household_id = hid), '-'),
    coalesce((select string_agg(week_start::text, ', ' order by week_start) from public.recipe_votes where household_id = hid), '-'))
$$;

\set owner '00000000-0000-4000-8000-0000000007f1'
\set partner '00000000-0000-4000-8000-0000000007f2'
\set hid '00000000-0000-4000-8000-0000000007b1'
\set other '00000000-0000-4000-8000-0000000007b2'
\set curry '00000000-0000-4000-8000-0000000007e1'
\set stew '00000000-0000-4000-8000-0000000007e2'
\set theirs '00000000-0000-4000-8000-0000000007e3'
insert into auth.users (id, email) values (:'owner', 'week-owner@example.test'), (:'partner', 'week-partner@example.test');
insert into public.households (id, name) values (:'hid', 'Week home'), (:'other', 'Other home');
insert into public.household_members (household_id, user_id, role) values (:'hid', :'owner', 'owner'), (:'hid', :'partner', 'member');
insert into public.household_settings (household_id, settings) values (:'hid', '{"notes": "mild"}'), (:'other', '{}');
insert into public.recipes (id, household_id, slug, name) values
  (:'curry', :'hid', 'curry', 'Curry'), (:'stew', :'hid', 'stew', 'Stew'), (:'theirs', :'other', 'theirs', 'Theirs');

-- 1. With no setting, weeks start on Monday and other days are refused, in every table.
select pg_temp.expect('a date''s week, Monday by default', public.week_start_of(:'hid', '2026-11-05'), '2026-11-02'::date);
select pg_temp.refused(format($$insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, servings)
  values (%L, '2026-10-31', 'wed', %L, 4)$$, :'hid', :'curry'), array['23514']);
select pg_temp.refused(format($$insert into public.meal_plan_nights (household_id, week_start, day) values (%L, '2026-11-03', 'wed')$$, :'hid'), array['23514']);
select pg_temp.refused(format($$insert into public.list_marks (household_id, week_start, item_key) values (%L, '2026-11-01', 'rice|g')$$, :'hid'), array['23514']);
select pg_temp.refused(format($$insert into public.list_extras (household_id, week_start, name) values (%L, '2026-11-07', 'soap')$$, :'hid'), array['23514']);
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, user_id, vote)
  values (%L, '2026-11-04', %L, %L, 1)$$, :'hid', :'curry', :'owner'), array['23514']);

-- 2. Two Monday weeks planned: curry Mon 2 and Wed 5 Nov (cooked Mon), stew Sun 8 and Sat 14 Nov,
--    with ticks, a hand-added item and votes on both weeks. The other household plans Wed 5 Nov.
insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, servings) values
  (:'hid', '2026-11-02', 'mon', :'curry', 4), (:'hid', '2026-11-02', 'wed', :'curry', 4),
  (:'hid', '2026-11-02', 'sun', :'stew', 4), (:'hid', '2026-11-09', 'sat', :'stew', 4),
  (:'other', '2026-11-02', 'wed', :'theirs', 4);
insert into public.meal_plan_nights (household_id, week_start, day, cooked) values
  (:'hid', '2026-11-02', 'mon', true), (:'hid', '2026-11-02', 'sun', false), (:'other', '2026-11-02', 'wed', true);
insert into public.list_marks (household_id, week_start, item_key, ticked) values
  (:'hid', '2026-11-02', 'rice|g', true), (:'hid', '2026-11-09', 'rice|g', true), (:'other', '2026-11-02', 'rice|g', true);
insert into public.list_extras (household_id, week_start, name) values (:'hid', '2026-11-09', 'soap');
insert into public.recipe_votes (household_id, week_start, recipe_id, user_id, vote) values
  (:'hid', '2026-11-02', :'curry', :'owner', 1), (:'hid', '2026-11-09', :'stew', :'partner', -1);

-- 3. A member sets Saturday in the settings sheet. Dinners keep their dates in the new weeks;
--    marks, extras and votes move two days back to the Saturday week overlapping most.
set local role authenticated;
select pg_temp.as_user(:'owner');
update public.household_settings set settings = settings || '{"weekStartsOn": "sat"}' where household_id = :'hid';
reset role;
select pg_temp.expect('dinners keep their dates in Saturday weeks', pg_temp.dinners(:'hid'),
  '2026-10-31:mon 2026-11-02 curry, 2026-10-31:wed 2026-11-04 curry, 2026-11-07:sun 2026-11-08 stew, 2026-11-14:sat 2026-11-14 stew'::text);
select pg_temp.expect('nights keep their dates and cooked flags', pg_temp.nights(:'hid'),
  '2026-10-31:mon t, 2026-11-07:sun f'::text);
select pg_temp.expect('marks, extras and votes in the most-overlapping week (the partner''s vote too)', pg_temp.weekly(:'hid'),
  'marks 2026-10-31 rice|g, 2026-11-07 rice|g; extras 2026-11-07 soap; votes 2026-10-31, 2026-11-07'::text);
select pg_temp.expect('the other household is untouched',
  pg_temp.dinners(:'other') || ' / ' || pg_temp.nights(:'other') || ' / ' || pg_temp.weekly(:'other'),
  '2026-11-02:wed 2026-11-04 theirs / 2026-11-02:wed t / marks 2026-11-02 rice|g; extras -; votes -'::text);
select pg_temp.expect('the setting kept the other keys', (select settings->>'notes' from public.household_settings where household_id = :'hid'), 'mild'::text);

-- A member can't delete the settings row (it would put weeks back on Monday without moving them).
set local role authenticated;
select pg_temp.as_user(:'partner');
delete from public.household_settings where household_id = :'hid';
reset role;
select pg_temp.expect('the settings row is still there after a member''s delete',
  (select settings->>'weekStartsOn' from public.household_settings where household_id = :'hid'), 'sat'::text);

-- 4. Saturday weeks are now the only ones accepted, and the week of a date follows.
select pg_temp.expect('a date''s week, from Saturday', public.week_start_of(:'hid', '2026-11-05'), '2026-10-31'::date);
select pg_temp.expect('a Saturday is its own week start', public.week_start_of(:'hid', '2026-11-07'), '2026-11-07'::date);
select pg_temp.refused(format($$insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, servings)
  values (%L, '2026-11-09', 'tue', %L, 4)$$, :'hid', :'curry'), array['23514']);
select pg_temp.refused(format($$insert into public.list_marks (household_id, week_start, item_key) values (%L, '2026-11-09', 'salt|g')$$, :'hid'), array['23514']);
insert into public.list_extras (household_id, week_start, name) values (:'hid', '2026-11-14', 'foil');
-- The other household still plans Monday weeks.
insert into public.list_extras (household_id, week_start, name) values (:'other', '2026-11-09', 'foil');
select pg_temp.refused(format($$insert into public.list_extras (household_id, week_start, name) values (%L, '2026-11-14', 'foil')$$, :'other'), array['23514']);
delete from public.list_extras where name = 'foil';

-- 5. A day not on the list is refused; moving a dinner keeps working in the new weeks.
select pg_temp.refused(format($$update public.household_settings set settings = settings || '{"weekStartsOn": "saturday"}'
  where household_id = %L$$, :'hid'), array['23514']);
set local role authenticated;
select pg_temp.as_user(:'partner');
select public.move_night(:'hid', '2026-10-31', 'wed', '2026-10-31', 'fri');
reset role;
select pg_temp.expect('a dinner moved within a Saturday week', pg_temp.dinners(:'hid'),
  '2026-10-31:fri 2026-11-06 curry, 2026-10-31:mon 2026-11-02 curry, 2026-11-07:sun 2026-11-08 stew, 2026-11-14:sat 2026-11-14 stew'::text);

-- 6. Back to Monday (by removing the key): everything returns to where it started.
update public.meal_plan_dishes set day = 'wed' where household_id = :'hid' and day = 'fri';
update public.household_settings set settings = settings - 'weekStartsOn' where household_id = :'hid';
select pg_temp.expect('dinners back in Monday weeks', pg_temp.dinners(:'hid'),
  '2026-11-02:mon 2026-11-02 curry, 2026-11-02:sun 2026-11-08 stew, 2026-11-02:wed 2026-11-04 curry, 2026-11-09:sat 2026-11-14 stew'::text);
select pg_temp.expect('marks, extras and votes back in Monday weeks', pg_temp.weekly(:'hid'),
  'marks 2026-11-02 rice|g, 2026-11-09 rice|g; extras 2026-11-09 soap; votes 2026-11-02, 2026-11-09'::text);

-- 7. A Friday start moves week-wide rows three days back (Fri 30 Oct overlaps Mon 2 Nov's week by 4 days).
update public.household_settings set settings = settings || '{"weekStartsOn": "fri"}' where household_id = :'hid';
select pg_temp.expect('marks, extras and votes in Friday weeks', pg_temp.weekly(:'hid'),
  'marks 2026-10-30 rice|g, 2026-11-06 rice|g; extras 2026-11-06 soap; votes 2026-10-30, 2026-11-06'::text);
select pg_temp.expect('dinners in Friday weeks', pg_temp.dinners(:'hid'),
  '2026-10-30:mon 2026-11-02 curry, 2026-10-30:wed 2026-11-04 curry, 2026-11-06:sun 2026-11-08 stew, 2026-11-13:sat 2026-11-14 stew'::text);
-- A settings row first written with a start day moves what was planned on Mondays.
delete from public.household_settings where household_id = :'other';
insert into public.household_settings (household_id, settings) values (:'other', '{"weekStartsOn": "tue"}');
select pg_temp.expect('a new settings row moves the other household''s weeks',
  pg_temp.dinners(:'other') || ' / ' || pg_temp.weekly(:'other'),
  '2026-11-03:wed 2026-11-04 theirs / marks 2026-11-03 rice|g; extras -; votes -'::text);

\o
\echo 'Week start checks passed'
rollback;
