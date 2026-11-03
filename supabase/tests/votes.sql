-- Recipe vote checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/votes.sql
-- A member sets, changes and clears only their own vote; the week must be a Monday; a vote
-- is only for the household's own recipes; non-members see and change nothing.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Vote check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with an error in `codes` (sqlstate).
create function pg_temp.refused(stmt text, codes text[]) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Vote check failed: % succeeded', stmt;
exception when others then
  if not sqlstate = any (codes) then raise; end if;
end $$;

-- Acts as the user with this id (inside the transaction).
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

-- The household's votes for the week as "recipe:user:vote", in order.
create function pg_temp.votes(hid uuid, wk date) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s', r.slug, right(v.user_id::text, 2), v.vote), ' '
                             order by r.slug, v.user_id), '')
  from public.recipe_votes v join public.recipes r on r.id = v.recipe_id
  where v.household_id = hid and v.week_start = wk
$$;

\set owner '00000000-0000-4000-8000-0000000000f1'
\set partner '00000000-0000-4000-8000-0000000000f2'
\set stranger '00000000-0000-4000-8000-0000000000f3'
\set hid '00000000-0000-4000-8000-0000000000b1'
\set other '00000000-0000-4000-8000-0000000000b2'
\set curry '00000000-0000-4000-8000-0000000000e1'
\set stew '00000000-0000-4000-8000-0000000000e2'
\set theirs '00000000-0000-4000-8000-0000000000e3'
insert into auth.users (id, email) values
  (:'owner', 'vote-owner@example.test'),
  (:'partner', 'vote-partner@example.test'),
  (:'stranger', 'vote-stranger@example.test');
insert into public.households (id, name) values (:'hid', 'Vote home'), (:'other', 'Other home');
insert into public.household_members (household_id, user_id, role) values
  (:'hid', :'owner', 'owner'),
  (:'hid', :'partner', 'member'),
  (:'other', :'stranger', 'owner');
insert into public.recipes (id, household_id, slug, name, course, serves) values
  (:'curry', :'hid', 'curry', 'Curry', 'main', 4),
  (:'stew', :'hid', 'stew', 'Stew', 'main', 4),
  (:'theirs', :'other', 'theirs', 'Theirs', 'main', 4);

set local role authenticated;

-- 1. Each member votes; the user id defaults to the caller.
select pg_temp.as_user(:'owner');
insert into public.recipe_votes (household_id, week_start, recipe_id, vote) values (:'hid', '2026-11-09', :'curry', 1);
select pg_temp.as_user(:'partner');
insert into public.recipe_votes (household_id, week_start, recipe_id, vote) values
  (:'hid', '2026-11-09', :'curry', -1),
  (:'hid', '2026-11-09', :'stew', 1);
select pg_temp.expect('votes after both voted', pg_temp.votes(:'hid', '2026-11-09'), 'curry:f1:1 curry:f2:-1 stew:f2:1');

-- 2. A member changes and clears only their own vote.
update public.recipe_votes set vote = 1 where week_start = '2026-11-09' and recipe_id = :'curry';
delete from public.recipe_votes where week_start = '2026-11-09' and recipe_id = :'stew';
select pg_temp.as_user(:'owner');
delete from public.recipe_votes where week_start = '2026-11-09' and recipe_id = :'stew';
update public.recipe_votes set vote = -1 where week_start = '2026-11-09' and recipe_id = :'curry' and user_id = :'partner';
select pg_temp.expect('the partner changed and cleared theirs; the owner could not touch them',
  pg_temp.votes(:'hid', '2026-11-09'), 'curry:f1:1 curry:f2:1');
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, user_id, vote)
  values (%L, '2026-11-09', %L, %L, 1)$$, :'hid', :'stew', :'partner'), array['42501']);
select pg_temp.refused(format($$update public.recipe_votes set user_id = %L
  where week_start = '2026-11-09' and recipe_id = %L and user_id = %L$$, :'stranger', :'curry', :'owner'), array['42501']);
-- Upsert, as the app writes a vote: replaces the caller's own.
insert into public.recipe_votes (household_id, week_start, recipe_id, user_id, vote) values (:'hid', '2026-11-09', :'curry', :'owner', -1)
on conflict (household_id, week_start, recipe_id, user_id) do update set vote = excluded.vote;
select pg_temp.expect('the owner''s vote replaced by upsert', pg_temp.votes(:'hid', '2026-11-09'), 'curry:f1:-1 curry:f2:1');

-- 3. The week must be a Monday; the vote is 1 or -1.
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, vote)
  values (%L, '2026-11-10', %L, 1)$$, :'hid', :'stew'), array['23514']);
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, vote)
  values (%L, '2026-11-09', %L, 0)$$, :'hid', :'stew'), array['23514']);

-- 4. A vote is only for the household's own recipes.
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, vote)
  values (%L, '2026-11-09', %L, 1)$$, :'hid', :'theirs'), array['42501']);

-- 5. Non-members see nothing and can't vote or clear votes in the household.
select pg_temp.as_user(:'stranger');
select pg_temp.expect('stranger sees no votes', (select count(*) from public.recipe_votes where household_id = :'hid'), 0::bigint);
select pg_temp.refused(format($$insert into public.recipe_votes (household_id, week_start, recipe_id, vote)
  values (%L, '2026-11-09', %L, 1)$$, :'hid', :'curry'), array['42501']);
delete from public.recipe_votes where household_id = :'hid';
reset role;
select pg_temp.expect('stranger cleared nothing', pg_temp.votes(:'hid', '2026-11-09'), 'curry:f1:-1 curry:f2:1');

-- 6. Votes go with the recipe, and with a member who leaves.
delete from public.household_members where household_id = :'hid' and user_id = :'partner';
set local role authenticated;
select pg_temp.as_user(:'partner');
select pg_temp.expect('a removed member sees no votes', (select count(*) from public.recipe_votes where household_id = :'hid'), 0::bigint);
reset role;
delete from public.recipes where id = :'curry';
select pg_temp.expect('votes deleted with the recipe', pg_temp.votes(:'hid', '2026-11-09'), '');

rollback;
\o
\echo 'Vote checks passed'
