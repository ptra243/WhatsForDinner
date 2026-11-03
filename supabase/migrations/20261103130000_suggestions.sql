-- Dinner suggestions (#18). Any member suggests a dinner by name; the owner refines open ones
-- into recipes through their Claude chat, which sets the status, a one-line reply and the
-- recipe. Members see the household's suggestions and edit or delete only their own open
-- ones, and only the name and description: status, reply and recipe are Claude's (it writes
-- through the admin connector, which bypasses these policies).

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'added', 'declined')),
  reply text not null default '',
  recipe_id uuid references public.recipes(id) on delete set null,
  -- When it was added or declined; the app shows handled ones for two weeks after.
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suggestions_household_idx on public.suggestions(household_id, created_at);
create index suggestions_created_by_idx on public.suggestions(created_by);
create index suggestions_recipe_idx on public.suggestions(recipe_id);

-- Stamps handled_at when the status changes, needs a recipe to mark one added, and keeps the
-- recipe to the household's own. (The recipe can go later: deleting it clears the link.)
create or replace function private.suggestion_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.handled_at := case when new.status = 'open' then null else now() end;
    if new.status = 'added' and new.recipe_id is null then
      raise exception 'An added suggestion needs its recipe_id' using errcode = '23502';
    end if;
  end if;
  if new.recipe_id is not null and not exists (
    select 1 from public.recipes r where r.id = new.recipe_id and r.household_id = new.household_id
  ) then
    raise exception 'A suggestion can only link to a recipe of its own household' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger suggestions_check before insert or update on public.suggestions for each row execute function private.suggestion_check();
create trigger suggestions_updated_at before update on public.suggestions for each row execute function private.set_updated_at();

alter table public.suggestions enable row level security;
create policy "members read suggestions" on public.suggestions for select to authenticated
  using ((select private.is_member(household_id)));
-- A new suggestion is open, by the member making it, with no reply or recipe yet.
create policy "members suggest" on public.suggestions for insert to authenticated
  with check (created_by = (select auth.uid()) and (select private.is_member(household_id))
              and status = 'open' and reply = '' and recipe_id is null);
-- Only the author, only while open. The grant below limits updates to name and description.
create policy "authors edit open suggestions" on public.suggestions for update to authenticated
  using (created_by = (select auth.uid()) and status = 'open' and (select private.is_member(household_id)))
  with check (created_by = (select auth.uid()) and status = 'open' and (select private.is_member(household_id)));
create policy "authors delete open suggestions" on public.suggestions for delete to authenticated
  using (created_by = (select auth.uid()) and status = 'open' and (select private.is_member(household_id)));

grant select, insert, delete on public.suggestions to authenticated;
grant update (name, description) on public.suggestions to authenticated;

alter publication supabase_realtime add table public.suggestions;
