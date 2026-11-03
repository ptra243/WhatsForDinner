-- Household invite checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invites.sql
-- An invite works once; expired and cancelled ones are refused; only the owner invites,
-- cancels and removes; a member can leave; joining from an empty household deletes it and
-- from a non-empty one is refused; a removed member loses access to every household table.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Invite check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with `msg`.
create function pg_temp.refused(stmt text, msg text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Invite check failed: % succeeded', stmt;
exception when raise_exception then
  if sqlerrm <> msg then raise; end if;
end $$;

-- Acts as the user with this id (inside the transaction).
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

-- Rows the current user can see in each household-owned table for this household.
create function pg_temp.visible(hid uuid) returns text language sql as $$
  select format('%s households, %s members, %s settings, %s recipes, %s ingredients, %s steps, %s nights, %s dishes, %s marks, %s extras, %s invites',
    (select count(*) from public.households where id = hid),
    (select count(*) from public.household_members where household_id = hid),
    (select count(*) from public.household_settings where household_id = hid),
    (select count(*) from public.recipes where household_id = hid),
    (select count(*) from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.household_id = hid),
    (select count(*) from public.recipe_steps rs join public.recipes r on r.id = rs.recipe_id where r.household_id = hid),
    (select count(*) from public.meal_plan_nights where household_id = hid),
    (select count(*) from public.meal_plan_dishes where household_id = hid),
    (select count(*) from public.list_marks where household_id = hid),
    (select count(*) from public.list_extras where household_id = hid),
    (select count(*) from public.household_invites where household_id = hid))
$$;

\ir ../seed/seed.sql

\set owner '00000000-0000-4000-8000-0000000000d1'
\set partner '00000000-0000-4000-8000-0000000000d2'
\set busy '00000000-0000-4000-8000-0000000000d3'
\set fresh '00000000-0000-4000-8000-0000000000d4'
insert into auth.users (id, email) values
  (:'owner', 'invite-owner@example.test'),
  (:'partner', 'invite-partner@example.test'),
  (:'busy', 'invite-busy@example.test'),
  (:'fresh', 'invite-fresh@example.test');

set local role authenticated;

-- The owner's household, with a planned dish, a list mark and a list extra.
select pg_temp.as_user(:'owner');
select public.create_household('Owner home') as hid \gset
insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, servings)
select :'hid', '2026-11-02', 'mon', id, 4 from public.recipes where household_id = :'hid' order by slug limit 1;
insert into public.meal_plan_nights (household_id, week_start, day) values (:'hid', '2026-11-02', 'mon');
insert into public.list_marks (household_id, week_start, item_key, ticked) values (:'hid', '2026-11-02', 'onion|each', true);
insert into public.list_extras (household_id, week_start, name) values (:'hid', '2026-11-02', 'milk');

-- 1. The partner has signed in before and has an untouched household of examples: it is
--    deleted and they join as a member. The invite works once.
select pg_temp.as_user(:'partner');
select public.create_household('Partner home') as partner_hid \gset
select pg_temp.as_user(:'owner');
select public.create_invite(:'hid') as token \gset
select pg_temp.expect('token length (256 bits, base64url)', length(:'token'), 43);
select pg_temp.expect('owner sees the open invite', (select count(*) from public.household_invites where household_id = :'hid'), 1::bigint);

reset role;
select pg_temp.expect('only the hash is stored',
  (select count(*) from public.household_invites where token_hash = :'token' or token_hash like '%' || :'token' || '%'), 0::bigint);
set local role anon;
select pg_temp.expect('signed-out invite info', (select format('%s: %s', household_name, status) from public.invite_info(:'token')), 'Owner home: open'::text);
select pg_temp.expect('unknown token info', (select count(*) from public.invite_info('not-a-token')), 0::bigint);
set local role authenticated;

select pg_temp.as_user(:'partner');
select public.accept_invite(:'token') as joined \gset
select pg_temp.expect('joined household', :'joined'::uuid, :'hid'::uuid);
select pg_temp.expect('partner sees the plan', (select count(*) from public.meal_plan_dishes where household_id = :'hid'), 1::bigint);
select pg_temp.expect('partner memberships', (select string_agg(household_id || ':' || role, ',') from public.household_members
  where user_id = :'partner'), :'hid' || ':member');
select pg_temp.expect('member list', (select string_agg(email || ':' || role, ',') from public.household_member_list(:'hid')),
  'invite-owner@example.test:owner,invite-partner@example.test:member'::text);
select pg_temp.expect('a member sees no invites', (select count(*) from public.household_invites), 0::bigint);
select pg_temp.expect('accepting again as a member is harmless', public.accept_invite(:'token'), :'hid'::uuid);
reset role;
select pg_temp.expect('partner old household deleted', (select count(*) from public.households where id = :'partner_hid'), 0::bigint);
select pg_temp.expect('invite used by', (select used_by from public.household_invites where household_id = :'hid'), :'partner'::uuid);
set local role authenticated;
select pg_temp.as_user(:'fresh');
select pg_temp.refused(format('select public.accept_invite(%L)', :'token'), 'This invite has already been used');
set local role anon;
select pg_temp.expect('used invite info', (select status from public.invite_info(:'token')), 'used'::text);
set local role authenticated;

-- 2. Only the owner invites, cancels and removes; members cannot write household_members directly.
select set_config('my.hid', :'hid', true);
select pg_temp.as_user(:'partner');
select pg_temp.refused(format('select public.create_invite(%L)', :'hid'), 'Only the owner can invite people');
select pg_temp.refused(format('select public.remove_member(%L, %L)', :'hid', :'owner'), 'Only the owner can remove members');
do $$
begin
  insert into public.household_members (household_id, user_id, role)
  values (current_setting('my.hid')::uuid, '00000000-0000-4000-8000-0000000000d4', 'member');
  raise exception 'Invite check failed: member inserted into household_members';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_user(:'busy');
select pg_temp.refused(format('select public.create_invite(%L)', :'hid'), 'Only the owner can invite people');
select pg_temp.refused(format('select public.household_member_list(%L)', :'hid'), 'Not your household');
select pg_temp.as_user(:'owner');
select pg_temp.refused(format('select public.remove_member(%L, %L)', :'hid', :'owner'), 'The owner can''t leave the household');

-- 3. Cancelled and expired invites are refused and say so.
select public.create_invite(:'hid') as cancelled_token \gset
select id as cancelled_id from public.household_invites where used_at is null order by created_at limit 1 \gset
select public.cancel_invite(:'cancelled_id');
select pg_temp.as_user(:'partner');
select pg_temp.refused(format('select public.cancel_invite(%L)', :'cancelled_id'), 'Only the owner can cancel invites');
select pg_temp.as_user(:'fresh');
select pg_temp.refused(format('select public.accept_invite(%L)', :'cancelled_token'), 'This invite was cancelled');
select pg_temp.expect('cancelled invite info', (select status from public.invite_info(:'cancelled_token')), 'cancelled'::text);

select pg_temp.as_user(:'owner');
select public.create_invite(:'hid') as expired_token \gset
reset role;
update public.household_invites set expires_at = now() - interval '1 minute'
where token_hash = private.invite_hash(:'expired_token');
select pg_temp.expect('invites expire after 7 days',
  (select expires_at - created_at from public.household_invites where token_hash = private.invite_hash(:'cancelled_token')),
  interval '7 days');
set local role authenticated;
select pg_temp.as_user(:'fresh');
select pg_temp.refused(format('select public.accept_invite(%L)', :'expired_token'), 'This invite has expired');
select pg_temp.expect('expired invite info', (select status from public.invite_info(:'expired_token')), 'expired'::text);
select pg_temp.refused('select public.accept_invite(''not-a-token'')', 'This invite link is not valid');

-- 4. A caller whose household is not empty is refused, and the invite stays open. Each kind
--    of use counts: an own recipe, an edited example, a planned dish, a list mark or extra, a member.
select pg_temp.as_user(:'owner');
select public.create_invite(:'hid') as open_token \gset
select pg_temp.as_user(:'busy');
select public.create_household('Busy home') as busy_hid \gset
reset role;
create function pg_temp.busy_refused(what text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000d3');
  set local role authenticated;
  perform pg_temp.refused(format('select public.accept_invite(%L)', current_setting('my.open_token')),
    'You already have a household with your own recipes or plans in it, so you can''t join another one');
  reset role;
  if (select used_at from public.household_invites where token_hash = private.invite_hash(current_setting('my.open_token'))) is not null then
    raise exception 'Invite check failed: refused join (%) used the invite', what;
  end if;
end $$;
select set_config('my.open_token', :'open_token', true);
select set_config('my.busy_hid', :'busy_hid', true);

insert into public.recipes (household_id, slug, name) values (:'busy_hid', 'own-dish', 'Own dish');
select pg_temp.busy_refused('own recipe');
delete from public.recipes where household_id = :'busy_hid' and slug = 'own-dish';

-- created_at moved back, as now() is fixed in this transaction: the example reads as edited later.
update public.recipes set rating = 5, created_at = created_at - interval '1 day'
where id = (select id from public.recipes where household_id = :'busy_hid' order by slug limit 1);
select pg_temp.busy_refused('edited example');
update public.recipes set created_at = updated_at where household_id = :'busy_hid';

insert into public.meal_plan_dishes (household_id, week_start, day, recipe_id, servings)
select :'busy_hid', '2026-11-02', 'tue', id, 4 from public.recipes where household_id = :'busy_hid' order by slug limit 1;
select pg_temp.busy_refused('planned dish');
delete from public.meal_plan_dishes where household_id = :'busy_hid';

insert into public.list_marks (household_id, week_start, item_key, ticked) values (:'busy_hid', '2026-11-02', 'onion|each', true);
select pg_temp.busy_refused('list mark');
delete from public.list_marks where household_id = :'busy_hid';

insert into public.list_extras (household_id, week_start, name) values (:'busy_hid', '2026-11-02', 'bread');
select pg_temp.busy_refused('list extra');
delete from public.list_extras where household_id = :'busy_hid';

insert into public.household_members (household_id, user_id, role) values (:'busy_hid', :'fresh', 'member');
select pg_temp.busy_refused('another member');
delete from public.household_members where household_id = :'busy_hid' and user_id = :'fresh';
select pg_temp.expect('busy household kept', (select count(*) from public.households where id = :'busy_hid'), 1::bigint);

-- Emptied again, the same household can join (its examples are untouched).
set local role authenticated;
select pg_temp.as_user(:'busy');
select pg_temp.expect('busy joins once empty', public.accept_invite(:'open_token'), :'hid'::uuid);
reset role;
select pg_temp.expect('busy old household deleted', (select count(*) from public.households where id = :'busy_hid'), 0::bigint);
set local role authenticated;

-- 5. A removed member, and a member who leaves, lose access to every household table.
select pg_temp.as_user(:'owner');
select pg_temp.visible(:'hid') as owner_sees \gset
select pg_temp.as_user(:'partner');
select pg_temp.expect('member sees what the owner sees, bar invites', pg_temp.visible(:'hid'),
  regexp_replace(:'owner_sees', '\d+ invites$', '0 invites'));
select pg_temp.as_user(:'owner');
select public.remove_member(:'hid', :'partner');
select pg_temp.as_user(:'partner');
select pg_temp.expect('removed member sees', pg_temp.visible(:'hid'),
  '0 households, 0 members, 0 settings, 0 recipes, 0 ingredients, 0 steps, 0 nights, 0 dishes, 0 marks, 0 extras, 0 invites'::text);
update public.recipes set notes = 'still here?' where household_id = :'hid';
select pg_temp.refused(format('select public.household_member_list(%L)', :'hid'), 'Not your household');

select pg_temp.as_user(:'busy');
select public.remove_member(:'hid', :'busy');
select pg_temp.expect('member who left sees', pg_temp.visible(:'hid'),
  '0 households, 0 members, 0 settings, 0 recipes, 0 ingredients, 0 steps, 0 nights, 0 dishes, 0 marks, 0 extras, 0 invites'::text);
reset role;
select pg_temp.expect('removed member wrote nothing', (select count(*) from public.recipes where household_id = :'hid' and notes = 'still here?'), 0::bigint);
select pg_temp.expect('members left', (select string_agg(user_id::text, ',') from public.household_members where household_id = :'hid'), :'owner'::text);

\echo 'Invite checks passed'
rollback;
