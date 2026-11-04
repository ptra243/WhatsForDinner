-- Ingredient shelf life and pack sizes (#25). How an ingredient is usually sold and how long it
-- keeps once bought, shared by every household like its section. The list shows packs
-- ("600 g · 2 × 500 g"); pantry items (#19) take a best-before from shelf_days.
-- All three are null until known. A pack size is a qty with its unit, so both or neither.

alter table public.ingredients
  add column pack_qty numeric check (pack_qty > 0),
  add column pack_unit text check (private.is_unit(pack_unit)),
  add column shelf_days integer check (shelf_days >= 0),
  add constraint ingredients_pack_check check ((pack_qty is null) = (pack_unit is null));
