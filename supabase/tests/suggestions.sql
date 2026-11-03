-- Suggestion checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/suggestions.sql
-- Members suggest and see the household's suggestions; only the author edits the name and
-- description, or deletes, and only while open; status is one of the fixed list and stamps
-- handled_at; a linked recipe is the household's own; non-members see and change nothing.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Suggestion check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with an error in `codes` (sqlstate).
create function pg_temp.refused(stmt text, codes text[]) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Suggestion check failed: % succeeded', stmt;
exception when others then
  if not sqlstate = any (codes) then raise; end if;
end $$;

-- Acts as the user with this id (inside the transaction).
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

-- The household's suggestions as "name:author:status", in order.
create function pg_temp.suggestions(hid uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s', s.name, right(s.created_by::text, 2), s.status), ' ' order by s.name), '')
  from public.suggestions s where s.household_id = hid
$$;

\set owner '00000000-0000-4000-8000-0000000000f1'
\set partner '00000000-0000-4000-8000-0000000000f2'
\set stranger '00000000-0000-4000-8000-0000000000f3'
\set hid '00000000-0000-4000-8000-0000000000b1'
\set other '00000000-0000-4000-8000-0000000000b2'
\set curry '00000000-0000-4000-8000-0000000000e1'
\set theirs '00000000-0000-4000-8000-0000000000e3'
\set pho '00000000-0000-4000-8000-0000000000a1'
\set laksa '00000000-0000-4000-8000-0000000000a2'
insert into auth.users (id, email) values
  (:'owner', 'sug-owner@example.test'),
  (:'partner', 'sug-partner@example.test'),
  (:'stranger', 'sug-stranger@example.test');
insert into public.households (id, name) values (:'hid', 'Suggestion home'), (:'other', 'Other home');
insert into public.household_members (household_id, user_id, role) values
  (:'hid', :'owner', 'owner'),
  (:'hid', :'partner', 'member'),
  (:'other', :'stranger', 'owner');
insert into public.recipes (id, household_id, slug, name, course, serves) values
  (:'curry', :'hid', 'curry', 'Curry', 'main', 4),
  (:'theirs', :'other', 'theirs', 'Theirs', 'main', 4);

set local role authenticated;

-- 1. Each member suggests; the author defaults to the caller and the suggestion starts open.
select pg_temp.as_user(:'partner');
insert into public.suggestions (id, household_id, name, description) values (:'pho', :'hid', 'Pho', 'https://example.test/pho');
select pg_temp.as_user(:'owner');
insert into public.suggestions (id, household_id, name) values (:'laksa', :'hid', 'Laksa');
select pg_temp.expect('suggestions from both', pg_temp.suggestions(:'hid'), 'Laksa:f1:open Pho:f2:open');
select pg_temp.expect('a new one is not handled', (select handled_at from public.suggestions where id = :'pho'), null::timestamptz);

-- 2. A new suggestion can't be someone else's, already handled or linked, or nameless.
select pg_temp.refused(format($$insert into public.suggestions (household_id, name, created_by) values (%L, 'Ramen', %L)$$,
  :'hid', :'partner'), array['42501']);
select pg_temp.refused(format($$insert into public.suggestions (household_id, name, status) values (%L, 'Ramen', 'declined')$$,
  :'hid'), array['42501']);
select pg_temp.refused(format($$insert into public.suggestions (household_id, name, reply) values (%L, 'Ramen', 'Done')$$,
  :'hid'), array['42501']);
select pg_temp.refused(format($$insert into public.suggestions (household_id, name, recipe_id) values (%L, 'Ramen', %L)$$,
  :'hid', :'curry'), array['42501']);
select pg_temp.refused(format($$insert into public.suggestions (household_id, name) values (%L, '  ')$$, :'hid'), array['23514']);

-- 3. Only the author edits the name and description; nobody in the app sets status, reply or recipe.
update public.suggestions set name = 'Owner''s pho' where id = :'pho';
delete from public.suggestions where id = :'pho';
select pg_temp.expect('the owner could not edit or delete the partner''s', pg_temp.suggestions(:'hid'), 'Laksa:f1:open Pho:f2:open');
select pg_temp.as_user(:'partner');
update public.suggestions set name = 'Beef pho', description = 'The one from Saturday' where id = :'pho';
select pg_temp.expect('the author edited theirs',
  (select name || ' / ' || description from public.suggestions where id = :'pho'), 'Beef pho / The one from Saturday');
select pg_temp.refused(format($$update public.suggestions set status = 'added' where id = %L$$, :'pho'), array['42501']);
select pg_temp.refused(format($$update public.suggestions set reply = 'Added' where id = %L$$, :'pho'), array['42501']);
select pg_temp.refused(format($$update public.suggestions set recipe_id = %L where id = %L$$, :'curry', :'pho'), array['42501']);
select pg_temp.refused(format($$update public.suggestions set created_by = %L where id = %L$$, :'owner', :'pho'), array['42501']);

-- 4. Claude (the admin connection) handles them: the status is one of the fixed list, handling
-- stamps handled_at, and the recipe is the household's own.
reset role;
select pg_temp.refused(format($$update public.suggestions set status = 'added', reply = 'Added' where id = %L$$, :'laksa'), array['23502']);
update public.suggestions set status = 'added', reply = 'Added as Curry', recipe_id = :'curry' where id = :'laksa';
select pg_temp.expect('added stamps handled_at', (select handled_at is not null from public.suggestions where id = :'laksa'), true);
select pg_temp.refused(format($$update public.suggestions set status = 'maybe' where id = %L$$, :'pho'), array['23514']);
select pg_temp.refused(format($$update public.suggestions set recipe_id = %L where id = %L$$, :'theirs', :'pho'), array['23503']);
update public.suggestions set status = 'declined', reply = 'Too close to the beef ragù' where id = :'pho';
select pg_temp.expect('handled', pg_temp.suggestions(:'hid'), 'Beef pho:f2:declined Laksa:f1:added');

-- 5. A handled suggestion is no longer the author's to edit or delete.
set local role authenticated;
select pg_temp.as_user(:'partner');
update public.suggestions set name = 'Chicken pho' where id = :'pho';
delete from public.suggestions where id = :'pho';
select pg_temp.expect('the declined one is unchanged', pg_temp.suggestions(:'hid'), 'Beef pho:f2:declined Laksa:f1:added');

-- 6. An author deletes their own open suggestion.
insert into public.suggestions (household_id, name) values (:'hid', 'Ramen');
delete from public.suggestions where name = 'Ramen';
select pg_temp.expect('the open one deleted', pg_temp.suggestions(:'hid'), 'Beef pho:f2:declined Laksa:f1:added');

-- 7. Non-members see nothing and can't suggest, edit or delete in the household.
select pg_temp.as_user(:'stranger');
select pg_temp.expect('stranger sees no suggestions', (select count(*) from public.suggestions where household_id = :'hid'), 0::bigint);
select pg_temp.refused(format($$insert into public.suggestions (household_id, name) values (%L, 'Mine')$$, :'hid'), array['42501']);
update public.suggestions set name = 'Mine' where household_id = :'hid';
delete from public.suggestions where household_id = :'hid';
reset role;
select pg_temp.expect('stranger changed nothing', pg_temp.suggestions(:'hid'), 'Beef pho:f2:declined Laksa:f1:added');

-- 8. A suggestion outlives its recipe and its author.
delete from public.recipes where id = :'curry';
select pg_temp.expect('recipe link cleared', (select recipe_id from public.suggestions where id = :'laksa'), null::uuid);
delete from auth.users where id = :'partner';
select pg_temp.expect('author cleared', (select created_by from public.suggestions where id = :'pho'), null::uuid);

rollback;
\o
\echo 'Suggestion checks passed'
