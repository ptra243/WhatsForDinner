# Data model

Supabase Postgres. Relational for anything Claude writes or the list adds up; JSON only for small self-contained values. The schema of record is `supabase/migrations/`; this page explains it and must change with it.

## Tables (M1)

All tables have `id uuid` (except where noted), `created_at`, `updated_at`. Every household-owned table has `household_id` and Row Level Security: a user sees and changes only rows of households they belong to.

Table privileges are granted explicitly, because the live project gives `anon` and `authenticated` none by default: `authenticated` gets the operations its policies allow, `anon` gets nothing. A new table needs its own `grant` in the migration that creates it; CI checks this in `supabase/tests/checks.sql`.

| Table | Key columns | Notes |
| --- | --- | --- |
| `households` | name | One per home |
| `household_members` | household_id, user_id → auth.users, role (`owner` / `member`) | Primary key (household_id, user_id) |
| `household_settings` | household_id (PK), settings jsonb | notes, dinnerTime, minutes per weekday, equipment, mealRule (`veg+carb` / `veg` / `off`), avoid (allergens from the list below) |
| `ingredients` | slug (PK), name, section, allergens text[] | Shared reference list. `section` and `allergens` are checked against fixed lists (below) |
| `recipes` | household_id, slug, name, course (`main` / `side`), serves, active_mins, total_mins, provides text[] (`protein`/`veg`/`carb`), spice 0–3, tags text[], source, rating 1–5, notes, is_example, created_by | Unique (household_id, slug) |
| `recipe_ingredients` | recipe_id, position, ingredient_slug → ingredients, qty numeric null, unit, note | `unit` check-constrained (below) |
| `recipe_steps` | recipe_id, position, text, timer_mins | |
| `meal_plan_dishes` | household_id, week_start date (a Monday, checked), day (`mon`..`sun`), position, recipe_id → recipes, role (`main` / `side`), servings, swaps jsonb | swaps: `[{from, to, qty, unit}]` |
| `meal_plan_nights` | household_id, week_start, day, cooked, skip_check | PK (household_id, week_start, day) |
| `list_marks` | household_id, week_start, item_key, ticked, bought_qty, bought_unit, status (`missing` / null), have_it, updated_by | PK (household_id, week_start, item_key) |
| `list_extras` | household_id, week_start, name, qty, unit, section, added_by | Hand-added list items |

## Rules enforced by the database

- **Units:** `g, kg, ml, l, each, tsp, tbsp, bunch, tin`. Tins and packs are stored by weight or volume (a 400 g tin is `400 g`).
- **Sections** (in walking order): `fruit and veg, bakery, meat and seafood, dairy and fridge, canned veg, canned fruit, international, pantry, herbs and spices, frozen, other`.
- **Allergens** (Australia's mandatory allergens, `private.allergens()`): `egg, milk, peanut, tree nut, sesame, soy, wheat, gluten, fish, crustacean, mollusc, lupin`. An ingredient lists those it usually contains, erring towards tagging (`egg noodle` and `wonton wrapper` are `egg`). Tags are generic, not per brand, so the app and Claude say "check the label" rather than promising a dish is safe.
- **Ingredient names** are singular, lowercase and plain (`onion`, `crushed tomato`); variety and prep go in `note`. Every `recipe_ingredients` row references `ingredients`, so a new ingredient needs a section first.
- **Week start** is always a Monday.

## Derived shopping list

For a household and week: for each planned dish, scale each recipe ingredient by `servings / recipes.serves`, apply the dish's swaps, normalise `kg → g` and `l → ml`, then sum by `(ingredient, unit)`. The item key is `name|unit` (or `extra:<id>`). `list_marks` overlay ticks, bought amounts, missing and already-have. Logic lives in `web/src/lib/list.ts` with Vitest tests; loading and saving in `web/src/lib/shop.ts`. Marks are written column by column, so two shoppers ticking at once do not undo each other. Moving a planned item to another section changes `ingredients.section` for every list (an ingredient only known from a swap is added); moving a hand-added item changes only its `list_extras` row.

## Moving a night's dinner

The night sheet's **Move** calls `move_night(hid, from_week, from_day, to_week, to_day)`, one write that succeeds or fails as a whole. Every dish on the night moves to the other night (this week or another) keeping its role, position, servings and swaps; if the other night has dishes, the two nights swap, so nothing is merged or lost. The skip-check flag goes with the dinner; each night keeps its own cooked flag, and a cooked night on either side is refused. It runs as the caller and checks membership, so it is for the app, not the Claude connector (Claude moves rows with plain SQL). The shopping list follows because it is derived from the dishes; list marks stay with their week. CI checks it in `supabase/tests/move_night.sql`.

## Allergens to avoid

`household_settings.settings.avoid` lists the allergens the household avoids (the settings sheet picks them). A planned dish still contains one when an ingredient tagged with it has no swap, or is swapped to an ingredient tagged with it; a swapped ingredient counts as what it was swapped to. The Week tab warns on the night and the night sheet, and the recipe view names the ingredients ("Contains egg (egg noodle)"). Logic in `web/src/lib/allergens.ts` with Vitest tests.

## Seed data

`seed/` is the source of the example ingredients, recipes and household settings. `supabase/seed/seed.sql` loads them into the **template household** (`private.template_household_id()`, `00000000-0000-4000-8000-000000000001`, created by a migration). It has no members, so Row Level Security hides it from every user; it is not a real household. The seed is generated by `node supabase/seed/build.mjs`, which checks units and sections first; regenerate it whenever `seed/` changes, and run it after the migrations (the reviewer does this on the live project after merge). Re-running never duplicates rows and keeps existing ingredient sections and allergens; the template's recipes and settings are made to match `seed/` (recipes no longer there are removed). The sample week in `seed/plans/` is not loaded.

On first sign-in the app calls `create_household(name)`. It creates the household, makes the caller its `owner`, and copies the template's settings and recipes (with ingredients and steps, `is_example = true`, `created_by` null) into it. Each household gets its own copy: re-seeding never touches existing households, and a household's edits never reach the template or anyone else. In M1 a user has one household, so a caller who already belongs to one gets its id back and nothing is created. CI checks the copy in `supabase/tests/households.sql`.

## Export and clearing examples

The settings sheet (`web/src/lib/household.ts`) saves `household_settings.settings` keeping any keys it does not show. **Export** downloads one JSON file (`format: 1`) with the household, its members and settings, recipes with their ingredients and steps, plan nights and dishes, list marks and extras, and the shared `ingredients` list; rows are as stored and read a page at a time past the API row limit. **Clear examples** deletes the household's `is_example` recipes; their ingredients, steps and planned dishes go with them by `on delete cascade`.

## Later (additive)

votes, suggestions, pantry (with location and best-before), ingredient shelf life and pack size columns, ingredient_substitutes, recipe_pairings, recipe_methods (equipment variants), per-night time overrides and locks.
