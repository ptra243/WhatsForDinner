-- Shopping list prices (#84). What an ingredient cost at Coles, Woolworths or Aldi on a day, as
-- Claude found it through a grocery price connector (WhichGrocer, or Grocerly as the fallback).
-- It is the price history and the cache: Claude reuses a row it saved today (Grocerly: until its
-- next weekly refresh) instead of searching again. The shopping list shows each store's latest.
-- Prices are the household's own (household_id + Row Level Security). Members read them; only
-- Claude writes them, through the connector, so `authenticated` gets select only.

create table public.ingredient_prices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  ingredient_slug text not null references public.ingredients(slug) on update cascade on delete cascade,
  store text not null check (store in ('coles', 'woolworths', 'aldi')),
  source text not null check (source in ('whichgrocer', 'grocerly', 'paid')),
  seen_on date not null default current_date,
  -- The matched product. Null with the price and pack for a not found row (no acceptable match).
  product text check (product <> ''),
  pack_qty numeric check (pack_qty > 0),
  pack_unit text check (private.is_unit(pack_unit)),
  price numeric(10, 2) check (price >= 0),
  -- The shelf price per kg, litre or item, for comparing stores and weeks across pack sizes.
  unit_price numeric(10, 2) check (unit_price >= 0),
  unit_basis text check (unit_basis in ('kg', 'l', 'each')),
  on_special boolean not null default false,
  -- When the source last refreshed its prices, where it says (Grocerly refreshes weekly).
  source_updated_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per ingredient, store, source and day: a re-price that day overwrites it.
  unique (household_id, ingredient_slug, store, source, seen_on),
  -- Price, product and pack are all there or, for a not found row, all null.
  constraint ingredient_prices_found_check check (
    (price is null) = (product is null) and (price is null) = (pack_qty is null) and (pack_qty is null) = (pack_unit is null)
  ),
  constraint ingredient_prices_basis_check check ((unit_price is null) = (unit_basis is null)),
  constraint ingredient_prices_not_found_check check (
    price is not null or (unit_price is null and not on_special)
  )
);
create index ingredient_prices_ingredient_idx on public.ingredient_prices(ingredient_slug);

create trigger ingredient_prices_updated_at before update on public.ingredient_prices
  for each row execute function private.set_updated_at();

alter table public.ingredient_prices enable row level security;
create policy "members read prices" on public.ingredient_prices for select to authenticated
  using ((select private.is_member(household_id)));

grant select on public.ingredient_prices to authenticated;

-- Each ingredient's latest row per store, across sources: the most recent seen_on, and on the
-- same day a price paid over WhichGrocer's daily price over Grocerly's weekly one. A not found
-- row is the latest too, so a store that stopped matching shows "–". Runs as the caller, so
-- Row Level Security on the table applies.
create view public.ingredient_prices_latest with (security_invoker = true) as
select distinct on (p.household_id, p.ingredient_slug, p.store) p.*
from public.ingredient_prices p
order by p.household_id, p.ingredient_slug, p.store, p.seen_on desc,
         array_position(array['paid', 'whichgrocer', 'grocerly'], p.source), p.updated_at desc;

grant select on public.ingredient_prices_latest to authenticated;

alter publication supabase_realtime add table public.ingredient_prices;
