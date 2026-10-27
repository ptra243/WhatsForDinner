-- What's for Dinner · M1 schema
-- See docs/data-model.md. Units and sections are fixed lists enforced here because
-- Claude writes through an admin connector that bypasses the app's checks.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- helpers

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_unit(u text)
returns boolean language sql immutable set search_path = '' as $$
  select u in ('g','kg','ml','l','each','tsp','tbsp','bunch','tin')
$$;

create or replace function private.is_section(s text)
returns boolean language sql immutable set search_path = '' as $$
  select s in ('fruit and veg','bakery','meat and seafood','dairy and fridge','canned veg',
               'canned fruit','international','pantry','herbs and spices','frozen','other')
$$;

-- ---------------------------------------------------------------- households

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_id_idx on public.household_members(user_id);

create table public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

-- Membership check used by every policy. Security definer so policies on
-- household_members itself do not recurse.
create or replace function private.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  )
$$;
grant execute on function private.is_member(uuid) to authenticated;

-- ---------------------------------------------------------------- ingredients (shared reference)

create table public.ingredients (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique check (name = lower(trim(name)) and length(name) > 0),
  section text not null default 'other' check (private.is_section(section)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- recipes

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  course text not null default 'main' check (course in ('main','side')),
  serves numeric not null default 4 check (serves > 0),
  active_mins integer check (active_mins >= 0),
  total_mins integer check (total_mins >= 0),
  provides text[] not null default '{}' check (provides <@ array['protein','veg','carb']),
  spice smallint check (spice between 0 and 3),
  tags text[] not null default '{}',
  source text not null default '',
  rating smallint check (rating between 1 and 5),
  notes text not null default '',
  is_example boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, slug),
  unique (id, household_id)
);
create index recipes_created_by_idx on public.recipes(created_by);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  ingredient_slug text not null references public.ingredients(slug) on update cascade,
  qty numeric check (qty >= 0),
  unit text not null check (private.is_unit(unit)),
  note text not null default '',
  unique (recipe_id, position)
);
create index recipe_ingredients_ingredient_slug_idx on public.recipe_ingredients(ingredient_slug);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  text text not null check (length(trim(text)) > 0),
  timer_mins integer check (timer_mins > 0),
  unique (recipe_id, position)
);

-- ---------------------------------------------------------------- meal plan

create table public.meal_plan_nights (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  cooked boolean not null default false,
  skip_check boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (household_id, week_start, day)
);

create table public.meal_plan_dishes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  position integer not null default 0 check (position >= 0),
  recipe_id uuid not null,
  role text not null default 'main' check (role in ('main','side')),
  servings numeric not null check (servings > 0),
  swaps jsonb not null default '[]'::jsonb check (jsonb_typeof(swaps) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the planned recipe must belong to the same household
  foreign key (recipe_id, household_id) references public.recipes(id, household_id) on delete cascade
);
create index meal_plan_dishes_week_idx on public.meal_plan_dishes(household_id, week_start);
create index meal_plan_dishes_recipe_idx on public.meal_plan_dishes(recipe_id, household_id);

-- ---------------------------------------------------------------- shopping list (shopper actions only)

create table public.list_marks (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  item_key text not null,
  ticked boolean not null default false,
  bought_qty numeric check (bought_qty >= 0),
  bought_unit text check (bought_unit is null or private.is_unit(bought_unit)),
  status text check (status is null or status = 'missing'),
  have_it boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (household_id, week_start, item_key)
);

create table public.list_extras (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  name text not null check (name = lower(trim(name)) and length(name) > 0),
  qty numeric check (qty >= 0),
  unit text not null default 'each' check (private.is_unit(unit)),
  section text not null default 'other' check (private.is_section(section)),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index list_extras_week_idx on public.list_extras(household_id, week_start);

-- ---------------------------------------------------------------- updated_at triggers

create trigger households_updated_at before update on public.households for each row execute function private.set_updated_at();
create trigger household_settings_updated_at before update on public.household_settings for each row execute function private.set_updated_at();
create trigger ingredients_updated_at before update on public.ingredients for each row execute function private.set_updated_at();
create trigger recipes_updated_at before update on public.recipes for each row execute function private.set_updated_at();
create trigger meal_plan_nights_updated_at before update on public.meal_plan_nights for each row execute function private.set_updated_at();
create trigger meal_plan_dishes_updated_at before update on public.meal_plan_dishes for each row execute function private.set_updated_at();
create trigger list_marks_updated_at before update on public.list_marks for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- row level security

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_settings enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.meal_plan_nights enable row level security;
alter table public.meal_plan_dishes enable row level security;
alter table public.list_marks enable row level security;
alter table public.list_extras enable row level security;

-- households: members read and rename; creation goes through create_household()
create policy "members read household" on public.households for select to authenticated using ((select private.is_member(id)));
create policy "members update household" on public.households for update to authenticated using ((select private.is_member(id))) with check ((select private.is_member(id)));

-- members: see co-members; joining goes through functions (invites are M2)
create policy "members read members" on public.household_members for select to authenticated using ((select private.is_member(household_id)));

-- household-owned tables: full access for members
create policy "members all" on public.household_settings for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy "members all" on public.recipes for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy "members all" on public.meal_plan_nights for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy "members all" on public.meal_plan_dishes for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy "members all" on public.list_marks for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy "members all" on public.list_extras for all to authenticated using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));

-- recipe children: through their recipe's household
create policy "members all" on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and (select private.is_member(r.household_id))))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and (select private.is_member(r.household_id))));
create policy "members all" on public.recipe_steps for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and (select private.is_member(r.household_id))))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and (select private.is_member(r.household_id))));

-- ingredients: shared reference list; any signed-in user can read, add and re-section
-- (per-household section overrides are an M3 concern)
create policy "signed in read" on public.ingredients for select to authenticated using (true);
create policy "signed in insert" on public.ingredients for insert to authenticated with check (true);
create policy "signed in update" on public.ingredients for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------- functions the app calls

-- Create a household with the caller as owner. Returns its id.
create or replace function public.create_household(household_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  insert into public.households(name) values (household_name) returning id into hid;
  insert into public.household_members(household_id, user_id, role) values (hid, (select auth.uid()), 'owner');
  insert into public.household_settings(household_id) values (hid);
  return hid;
end $$;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.meal_plan_dishes, public.meal_plan_nights,
  public.list_marks, public.list_extras, public.recipes;
