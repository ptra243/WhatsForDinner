-- Pantry (#19). What the household has at home and where: the fridge, the freezer or the
-- pantry, with a best-before date. The app's Pantry tab adds, edits and removes items (Used
-- up); the shopping list says what is already there; Claude reads the pantry to plan the week
-- around what expires first, and never writes it. Members change everything (household_id +
-- Row Level Security), like the list's hand-added items.

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  ingredient_slug text not null references public.ingredients(slug) on update cascade on delete cascade,
  -- Null for an amount nobody measured ("some").
  qty numeric check (qty > 0),
  unit text not null default 'each' check (private.is_unit(unit)),
  location text not null default 'pantry' check (location in ('fridge', 'freezer', 'pantry')),
  -- The app fills it from the ingredient's shelf_days; null when nobody knows.
  best_before date,
  note text not null default '',
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pantry_items_household_idx on public.pantry_items(household_id, best_before);
create index pantry_items_ingredient_idx on public.pantry_items(ingredient_slug);
create index pantry_items_added_by_idx on public.pantry_items(added_by);

create trigger pantry_items_updated_at before update on public.pantry_items
  for each row execute function private.set_updated_at();

alter table public.pantry_items enable row level security;
create policy "members all" on public.pantry_items for all to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));

grant select, insert, update, delete on public.pantry_items to authenticated;

alter publication supabase_realtime add table public.pantry_items;
