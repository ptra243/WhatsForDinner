# Data model

Supabase Postgres. Relational for anything Claude writes or the list adds up; JSON only for small self-contained values. The schema of record is `supabase/migrations/`; this page explains it and must change with it.

## Tables (M1)

All tables have `id uuid` (except where noted), `created_at`, `updated_at`. Every household-owned table has `household_id` and Row Level Security: a user sees and changes only rows of households they belong to.

| Table | Key columns | Notes |
| --- | --- | --- |
| `households` | name | One per home |
| `household_members` | household_id, user_id → auth.users, role (`owner` / `member`) | Primary key (household_id, user_id) |
| `household_settings` | household_id (PK), settings jsonb | notes, dinnerTime, minutes per weekday, equipment, mealRule (`veg+carb` / `veg` / `off`) |
| `ingredients` | slug (PK), name, section | Shared reference list. `section` is a check-constrained enum (below) |
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
- **Ingredient names** are singular, lowercase and plain (`onion`, `crushed tomato`); variety and prep go in `note`. Every `recipe_ingredients` row references `ingredients`, so a new ingredient needs a section first.
- **Week start** is always a Monday.

## Derived shopping list

For a household and week: for each planned dish, scale each recipe ingredient by `servings / recipes.serves`, apply the dish's swaps, normalise `kg → g` and `l → ml`, then sum by `(ingredient, unit)`. The item key is `name|unit` (or `extra:<id>`). `list_marks` overlay ticks, bought amounts, missing and already-have. Logic lives in `web/src/lib/list.ts` with Vitest tests.

## Later (additive)

votes, suggestions, pantry (with location and best-before), ingredient shelf life and pack size columns, ingredient_substitutes, recipe_pairings, recipe_methods (equipment variants), per-night time overrides and locks.
