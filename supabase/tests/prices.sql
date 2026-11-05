-- Ingredient price checks CI runs on a fresh local database. Raises on failure; rolls back at the end.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/prices.sql
-- Members read their household's prices and never write them; non-members and anon see nothing;
-- a not found row has no price, product or pack; one row per ingredient, store, source and day;
-- the latest view picks the newest day, then paid over WhichGrocer over Grocerly.

\set QUIET on
\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Price check failed: % is %, expected %', what, got, want;
  end if;
end $$;

-- Expects `stmt` to be refused with an error in `codes` (sqlstate).
create function pg_temp.refused(stmt text, codes text[]) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'Price check failed: % succeeded', stmt;
exception when others then
  if not sqlstate = any (codes) then raise; end if;
end $$;

-- Acts as the user with this id (inside the transaction).
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true)
$$;

\set owner '00000000-0000-4000-8000-0000000000f1'
\set partner '00000000-0000-4000-8000-0000000000f2'
\set stranger '00000000-0000-4000-8000-0000000000f3'
\set hid '00000000-0000-4000-8000-0000000000b1'
\set other '00000000-0000-4000-8000-0000000000b2'
insert into auth.users (id, email) values
  (:'owner', 'price-owner@example.test'),
  (:'partner', 'price-partner@example.test'),
  (:'stranger', 'price-stranger@example.test');
insert into public.households (id, name) values (:'hid', 'Price home'), (:'other', 'Other home');
insert into public.household_members (household_id, user_id, role) values
  (:'hid', :'owner', 'owner'),
  (:'hid', :'partner', 'member'),
  (:'other', :'stranger', 'owner');
insert into public.ingredients (slug, name, section) values
  ('price-mince', 'price mince', 'meat and seafood'),
  ('price-lemon', 'price lemon', 'fruit and veg')
on conflict do nothing;

-- 1. Claude (the connector, not the app's role) saves prices and not found rows.
insert into public.ingredient_prices
  (household_id, ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price, unit_price, unit_basis, on_special, source_updated_on)
values
  (:'hid', 'price-mince', 'coles', 'whichgrocer', '2026-11-04', 'Coles Beef Mince 500g', 500, 'g', 8.00, 16.00, 'kg', false, null),
  (:'hid', 'price-mince', 'woolworths', 'whichgrocer', '2026-11-04', 'Woolworths Beef Mince 1kg', 1, 'kg', 14.00, 14.00, 'kg', true, null),
  (:'hid', 'price-mince', 'aldi', 'whichgrocer', '2026-11-04', null, null, null, null, null, null, false, null),
  (:'hid', 'price-mince', 'coles', 'grocerly', '2026-11-05', 'Coles Beef Mince 500g', 500, 'g', 8.50, 17.00, 'kg', false, '2026-10-29'),
  (:'hid', 'price-mince', 'woolworths', 'grocerly', '2026-11-04', 'Woolworths Beef Mince 1kg', 1, 'kg', 15.00, 15.00, 'kg', false, '2026-10-29'),
  (:'hid', 'price-mince', 'woolworths', 'paid', '2026-11-04', 'Woolworths Beef Mince 1kg', 1, 'kg', 12.00, 12.00, 'kg', false, null),
  (:'other', 'price-lemon', 'coles', 'whichgrocer', '2026-11-04', 'Lemons each', 1, 'each', 0.90, 0.90, 'each', false, null);

-- 2. A re-price the same day overwrites the row (the skill's upsert).
insert into public.ingredient_prices (household_id, ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price, unit_price, unit_basis)
values (:'hid', 'price-mince', 'coles', 'whichgrocer', '2026-11-04', 'Coles Beef Mince 500g', 500, 'g', 7.50, 15.00, 'kg')
on conflict (household_id, ingredient_slug, store, source, seen_on) do update
set product = excluded.product, price = excluded.price, unit_price = excluded.unit_price;
select pg_temp.expect('rows for the household after the re-price',
  (select count(*) from public.ingredient_prices where household_id = :'hid'), 6::bigint);
select pg_temp.expect('the re-priced row',
  (select price from public.ingredient_prices where household_id = :'hid' and store = 'coles' and source = 'whichgrocer'), 7.50::numeric);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'whichgrocer', '2026-11-04', 'Again', 500, 'g', 1)$$, array['23505']);

-- 3. The checks: stores, sources and units from the lists; price, product and pack together.
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'iga', 'whichgrocer')$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'scraper')$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, product, pack_qty, pack_unit, price)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', 'Mince', 1, 'pack', 5)$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, product, price)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', 'Mince', 5)$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, pack_qty, pack_unit, price)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', 500, 'g', 5)$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, unit_price, unit_basis)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', 10, 'kg')$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, product, pack_qty, pack_unit, price, unit_price)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', 'Mince', 500, 'g', 5, 10)$$, array['23514']);
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source, on_special)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid', true)$$, array['23514']);

set local role authenticated;

-- 4. Members read their household's prices; the latest view gives one row per store.
select pg_temp.as_user(:'partner');
select pg_temp.expect('rows the partner sees', (select count(*) from public.ingredient_prices), 6::bigint);
select pg_temp.expect('latest per store: newest day, then paid over WhichGrocer over Grocerly',
  (select string_agg(store || ' ' || source || ' ' || seen_on || ' ' || coalesce(price::text, '-'), ', ' order by store)
   from public.ingredient_prices_latest),
  'aldi whichgrocer 2026-11-04 -, coles grocerly 2026-11-05 8.50, woolworths paid 2026-11-04 12.00');

-- 5. Members never write prices; the app only reads them.
select pg_temp.refused($$insert into public.ingredient_prices (household_id, ingredient_slug, store, source)
  values ('00000000-0000-4000-8000-0000000000b1', 'price-mince', 'coles', 'paid')$$, array['42501']);
select pg_temp.refused($$update public.ingredient_prices set price = 1 where household_id = '00000000-0000-4000-8000-0000000000b1'$$, array['42501']);
select pg_temp.refused($$delete from public.ingredient_prices where household_id = '00000000-0000-4000-8000-0000000000b1'$$, array['42501']);

-- 6. Another household sees only its own, through the table and the view.
select pg_temp.as_user(:'stranger');
select pg_temp.expect('rows the stranger sees', (select string_agg(ingredient_slug, ',') from public.ingredient_prices), 'price-lemon');
select pg_temp.expect('latest rows the stranger sees', (select count(*) from public.ingredient_prices_latest), 1::bigint);

-- 7. Anon gets nothing.
reset role;
set local role anon;
select pg_temp.refused('select 1 from public.ingredient_prices', array['42501']);
select pg_temp.refused('select 1 from public.ingredient_prices_latest', array['42501']);
reset role;

-- 8. Prices are realtime, so the list shows what Claude saves without a refresh.
select pg_temp.expect('in the realtime publication',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ingredient_prices'), true);

rollback;
\o
\echo 'Price checks passed'
