-- Partner login and household invites (#16).
-- The owner makes a single-use link (`…/?invite=<token>`). Only a hash of the token is stored.
-- Joining, leaving and removing go through the security-definer functions below, which check
-- the caller; household_members still has no insert or delete policy for the app.

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  cancelled_at timestamptz
);
create index household_invites_household_idx on public.household_invites(household_id);
create index household_invites_created_by_idx on public.household_invites(created_by);
create index household_invites_used_by_idx on public.household_invites(used_by);

-- Whether the caller owns the household.
create or replace function private.is_owner(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid()) and m.role = 'owner'
  )
$$;
grant execute on function private.is_owner(uuid) to authenticated;

-- A token's hash, as stored in household_invites.token_hash.
create or replace function private.invite_hash(token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;

-- What a link's invite is now: open, used, cancelled or expired.
create or replace function private.invite_status(i public.household_invites)
returns text language sql stable set search_path = '' as $$
  select case
    when i.used_at is not null then 'used'
    when i.cancelled_at is not null then 'cancelled'
    when i.expires_at <= now() then 'expired'
    else 'open'
  end
$$;

alter table public.household_invites enable row level security;
-- The owner sees the household's invites (to list and cancel open ones); writes go through functions.
create policy "owner reads invites" on public.household_invites for select to authenticated
  using ((select private.is_owner(household_id)));
grant select on public.household_invites to authenticated;

-- ---------------------------------------------------------------- functions the app calls

-- Make an invite for the caller's household and return its token (256 random bits, base64url).
-- Only the owner can invite.
create or replace function public.create_invite(hid uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare token text;
begin
  if not (select private.is_owner(hid)) then raise exception 'Only the owner can invite people'; end if;
  token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.household_invites (household_id, token_hash, created_by)
  values (hid, private.invite_hash(token), (select auth.uid()));
  return token;
end $$;
revoke execute on function public.create_invite(uuid) from public, anon;
grant execute on function public.create_invite(uuid) to authenticated;

-- Cancel an open invite. Only the owner of its household can.
create or replace function public.cancel_invite(invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  select i.household_id into hid from public.household_invites i where i.id = invite_id;
  if hid is null or not (select private.is_owner(hid)) then raise exception 'Only the owner can cancel invites'; end if;
  update public.household_invites set cancelled_at = now()
  where id = invite_id and used_at is null and cancelled_at is null;
end $$;
revoke execute on function public.cancel_invite(uuid) from public, anon;
grant execute on function public.cancel_invite(uuid) to authenticated;

-- What the sign-in screen shows for a link: the household's name and whether the invite is
-- open, used, cancelled or expired. No row for a token that matches no invite. Callable
-- signed out, since the link is opened before signing in; it reveals nothing without the token.
create or replace function public.invite_info(token text)
returns table (household_name text, status text) language sql stable security definer set search_path = '' as $$
  select h.name, private.invite_status(i)
  from public.household_invites i
  join public.households h on h.id = i.household_id
  where i.token_hash = private.invite_hash(token)
$$;
revoke execute on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- Join the household an open invite is for, as a member, and use the invite up. Returns the
-- household's id. A caller already in a household can join only if it is empty: they are its
-- only member, it has only untouched example recipes and no planned dishes, list marks or
-- extras. That household is deleted. Otherwise the invite is refused and stays open.
create or replace function public.accept_invite(token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.household_invites;
  old_hid uuid;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  -- The same lock as create_household, so a racing first sign-in cannot make a household meanwhile.
  perform pg_advisory_xact_lock(hashtextextended('create_household:' || uid::text, 0));
  select * into inv from public.household_invites i where i.token_hash = private.invite_hash(token) for update;
  if inv.id is null then raise exception 'This invite link is not valid'; end if;
  if exists (select 1 from public.household_members m where m.household_id = inv.household_id and m.user_id = uid) then
    return inv.household_id;
  end if;
  case private.invite_status(inv)
    when 'used' then raise exception 'This invite has already been used';
    when 'cancelled' then raise exception 'This invite was cancelled';
    when 'expired' then raise exception 'This invite has expired';
    else null;
  end case;

  for old_hid in select m.household_id from public.household_members m where m.user_id = uid loop
    if exists (select 1 from public.household_members m where m.household_id = old_hid and m.user_id <> uid)
       or exists (select 1 from public.recipes r where r.household_id = old_hid
                  and (not r.is_example or r.updated_at <> r.created_at))
       or exists (select 1 from public.meal_plan_dishes d where d.household_id = old_hid)
       or exists (select 1 from public.list_marks l where l.household_id = old_hid)
       or exists (select 1 from public.list_extras e where e.household_id = old_hid) then
      raise exception 'You already have a household with your own recipes, plans, shopping list or members in it, so you can''t join another one';
    end if;
  end loop;
  delete from public.households h
  where h.id in (select m.household_id from public.household_members m where m.user_id = uid);

  insert into public.household_members (household_id, user_id, role) values (inv.household_id, uid, 'member');
  update public.household_invites set used_by = uid, used_at = now() where id = inv.id;
  return inv.household_id;
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- The household's members with their emails (the app cannot read auth.users). Members only.
create or replace function public.household_member_list(hid uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_member(hid)) then raise exception 'Not your household'; end if;
  return query
    select m.user_id, u.email::text, m.role, m.created_at
    from public.household_members m
    join auth.users u on u.id = m.user_id
    where m.household_id = hid
    order by m.role = 'owner' desc, m.created_at;
end $$;
revoke execute on function public.household_member_list(uuid) from public, anon;
grant execute on function public.household_member_list(uuid) to authenticated;

-- Remove a member from the household. The owner can remove any member; a member can remove
-- only themself (leave). The owner cannot leave or be removed.
create or replace function public.remove_member(hid uuid, member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  member_role text;
begin
  if not (select private.is_member(hid)) then raise exception 'Not your household'; end if;
  if member_id <> uid and not (select private.is_owner(hid)) then
    raise exception 'Only the owner can remove members';
  end if;
  select m.role into member_role from public.household_members m where m.household_id = hid and m.user_id = member_id;
  if member_role is null then raise exception 'Not a member of this household'; end if;
  if member_role = 'owner' then raise exception 'The owner can''t leave the household'; end if;
  delete from public.household_members m where m.household_id = hid and m.user_id = member_id;
end $$;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
