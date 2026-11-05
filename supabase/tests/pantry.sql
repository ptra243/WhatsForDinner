-- Pantry checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pantry.sql
-- Members add, change and remove their household's pantry items; non-members and anon see and
-- change nothing; the location, unit and amount are checked; an item needs a known ingredient.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Pantry check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with an error in `codes` (sqlstate).
create function pg_temp.refused(stmt text, codes text[]) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Pantry check failed: % succeeded', stmt;
exception when others then
  if not sqlstate = any (codes) then raise; end if;
end $$;

-- Acts as the user with this id (inside the transaction).
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

\set owner '00000000-0000-4000-8000-0000000000e1'
\set partner '00000000-0000-4000-8000-0000000000e2'
\set stranger '00000000-0000-4000-8000-0000000000e3'
\set hid '00000000-0000-4000-8000-0000000000d1'
\set other '00000000-0000-4000-8000-0000000000d2'
insert into auth.users (id, email) values
  (:'owner', 'pantry-owner@example.test'),
  (:'partner', 'pantry-partner@example.test'),
  (:'stranger', 'pantry-stranger@example.test');
insert into public.households (id, name) values (:'hid', 'Pantry home'), (:'other', 'Other home');
insert into public.household_members (household_id, user_id, role) values
  (:'hid', :'owner', 'owner'),
  (:'hid', :'partner', 'member'),
  (:'other', :'stranger', 'owner');
insert into public.ingredients (slug, name, section, shelf_days) values
  ('pantry-chicken', 'pantry chicken', 'meat and seafood', 3),
  ('pantry-rice', 'pantry rice', 'pantry', 730)
on conflict do nothing;
insert into public.pantry_items (household_id, ingredient_slug, qty, unit, location, best_before)
values (:'other', 'pantry-rice', 1, 'kg', 'pantry', '2027-06-01');

set local role authenticated;

-- 1. A member adds an item; it is theirs by default, with the household's id.
select pg_temp.as_user(:'partner');
insert into public.pantry_items (household_id, ingredient_slug, qty, unit, location, best_before, note)
values (:'hid', 'pantry-chicken', 300, 'g', 'fridge', '2026-11-07', 'on special');
select pg_temp.expect('added by the partner',
  (select added_by from public.pantry_items where household_id = :'hid'), :'partner'::uuid);
insert into public.pantry_items (household_id, ingredient_slug, unit, location)
values (:'hid', 'pantry-rice', 'each', 'pantry');
select pg_temp.expect('an amount nobody measured, and no best-before',
  (select qty is null and best_before is null from public.pantry_items where household_id = :'hid' and ingredient_slug = 'pantry-rice'), true);

-- 2. The other member sees, changes and removes it.
select pg_temp.as_user(:'owner');
select pg_temp.expect('items the owner sees', (select count(*) from public.pantry_items), 2::bigint);
update public.pantry_items set qty = 200, location = 'freezer' where household_id = :'hid' and ingredient_slug = 'pantry-chicken';
select pg_temp.expect('moved to the freezer',
  (select location || ' ' || qty from public.pantry_items where household_id = :'hid' and ingredient_slug = 'pantry-chicken'), 'freezer 200');
delete from public.pantry_items where household_id = :'hid' and ingredient_slug = 'pantry-rice';
select pg_temp.expect('used up', (select count(*) from public.pantry_items), 1::bigint);

-- 3. The checks: location from the fixed list, units from the list, amounts above 0, a known ingredient.
select pg_temp.refused($$insert into public.pantry_items (household_id, ingredient_slug, location)
  values ('00000000-0000-4000-8000-0000000000d1', 'pantry-rice', 'cupboard')$$, array['23514']);
select pg_temp.refused($$update public.pantry_items set location = 'garage'
  where household_id = '00000000-0000-4000-8000-0000000000d1'$$, array['23514']);
select pg_temp.refused($$insert into public.pantry_items (household_id, ingredient_slug, unit)
  values ('00000000-0000-4000-8000-0000000000d1', 'pantry-rice', 'packet')$$, array['23514']);
select pg_temp.refused($$insert into public.pantry_items (household_id, ingredient_slug, qty, unit)
  values ('00000000-0000-4000-8000-0000000000d1', 'pantry-rice', 0, 'g')$$, array['23514']);
select pg_temp.refused($$insert into public.pantry_items (household_id, ingredient_slug)
  values ('00000000-0000-4000-8000-0000000000d1', 'no-such-ingredient')$$, array['23503']);

-- 4. Another household's members see and change none of it, and can't add to it.
select pg_temp.as_user(:'stranger');
select pg_temp.expect('rows the stranger sees', (select string_agg(ingredient_slug, ',') from public.pantry_items), 'pantry-rice');
update public.pantry_items set qty = 1 where household_id = :'hid';
delete from public.pantry_items where household_id = :'hid';
select pg_temp.refused($$insert into public.pantry_items (household_id, ingredient_slug)
  values ('00000000-0000-4000-8000-0000000000d1', 'pantry-rice')$$, array['42501']);
-- Nor move their own item into it.
select pg_temp.refused($$update public.pantry_items set household_id = '00000000-0000-4000-8000-0000000000d1'
  where household_id = '00000000-0000-4000-8000-0000000000d2'$$, array['42501']);
select pg_temp.as_user(:'owner');
select pg_temp.expect('the household''s item untouched',
  (select location || ' ' || qty from public.pantry_items), 'freezer 200');

-- 5. Anon gets nothing.
reset role;
set local role anon;
select pg_temp.refused('select 1 from public.pantry_items', array['42501']);
reset role;

-- 6. Pantry changes are realtime, so both members see them without a refresh.
select pg_temp.expect('in the realtime publication',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pantry_items'), true);

rollback;
\o
\echo 'Pantry checks passed'
