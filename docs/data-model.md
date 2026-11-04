# Data model

Supabase Postgres. Relational for anything Claude writes or the list adds up; JSON only for small self-contained values. The schema of record is `supabase/migrations/`; this page explains it and must change with it.

## Tables (M1)

All tables have `id uuid` (except where noted), `created_at`, `updated_at`. Every household-owned table has `household_id` and Row Level Security: a user sees and changes only rows of households they belong to.

Table privileges are granted explicitly, because the live project gives `anon` and `authenticated` none by default: `authenticated` gets the operations its policies allow, `anon` gets nothing. A new table needs its own `grant` in the migration that creates it; CI checks this in `supabase/tests/checks.sql`.

| Table | Key columns | Notes |
| --- | --- | --- |
| `households` | name | One per home |
| `household_members` | household_id, user_id → auth.users, role (`owner` / `member`) | Primary key (household_id, user_id). No insert or delete policy: joining, leaving and removing go through functions (below) |
| `household_invites` | household_id, token_hash, created_by, expires_at, used_by, used_at, cancelled_at | Single-use invite links. Only the owner can read them; writes go through functions |
| `household_settings` | household_id (PK), settings jsonb | notes, dinnerTime, minutes per weekday, equipment, mealRule (`veg+carb` / `veg` / `off`), avoid (allergens from the list below) |
| `ingredients` | slug (PK), name, section, allergens text[], pack_qty numeric null, pack_unit null, shelf_days integer null | Shared reference list. `section` and `allergens` are checked against fixed lists (below). A pack size (how it is usually sold, `pack_qty` > 0 in a unit from the list) is both columns or neither; `shelf_days` (≥ 0) is how long it keeps once bought |
| `recipes` | household_id, slug, name, course (`main` / `side`), serves, active_mins, total_mins, provides text[] (`protein`/`veg`/`carb`), spice 0–3, tags text[], source, rating 1–5, notes, is_example, created_by | Unique (household_id, slug) |
| `recipe_ingredients` | recipe_id, position, ingredient_slug → ingredients, qty numeric null, unit, note | `unit` check-constrained (below) |
| `recipe_steps` | recipe_id, method_id → recipe_methods (null = the recipe's own steps), position, text, timer_mins | Unique (recipe_id, method_id, position), nulls not distinct: positions count within each method |
| `recipe_methods` | recipe_id, name, equipment, active_mins, total_mins | Another way to cook the recipe ([below](#equipment-methods)). Unique (recipe_id, name); total ≥ hands-on |
| `recipe_step_ingredients` | step_id → recipe_steps, recipe_ingredient_id → recipe_ingredients | PK (step_id, recipe_ingredient_id); no `id` or `updated_at`. The ingredients a step uses ([below](#step-ingredients)); only its own recipe's, checked by a trigger. Goes with the step or the ingredient row |
| `meal_plan_dishes` | household_id, week_start date (a Monday, checked), day (`mon`..`sun`), position, recipe_id → recipes, role (`main` / `side`), servings, swaps jsonb, method_id → recipe_methods | swaps: `[{from, to, qty, unit}]`. method_id null = the recipe's usual way; it must be a method of the same recipe |
| `meal_plan_nights` | household_id, week_start, day, cooked, skip_check, minutes, locked | PK (household_id, week_start, day). minutes: that night's own hands-on time (> 0; null = the weekday's setting); locked: Claude leaves the night's dishes alone ([below](#a-nights-time-and-lock)) |
| `list_marks` | household_id, week_start, item_key, ticked, bought_qty, bought_unit, status (`missing` / null), have_it, updated_by | PK (household_id, week_start, item_key) |
| `list_extras` | household_id, week_start, name, qty, unit, section, added_by | Hand-added list items |
| `recipe_votes` | household_id, week_start (a Monday, checked), recipe_id → recipes, user_id → auth.users, vote (`1` 👍 / `-1` 👎) | PK (household_id, week_start, recipe_id, user_id); no `id`. Members read all the household's votes and write only their own (`user_id = auth.uid()`), for the household's own recipes. Goes with the recipe or the user |
| `suggestions` | id, household_id, created_by → auth.users, name, description, status (`open` / `added` / `declined`, checked), reply, recipe_id → recipes, handled_at | Members read the household's; the author edits name and description (column grant) or deletes, only while open. A new one is open with no reply or recipe. Status, reply and recipe are Claude's. `added` needs a recipe of the same household; deleting the recipe or the author clears the link |

## Rules enforced by the database

- **Units:** `g, kg, ml, l, each, tsp, tbsp, bunch, tin`. Tins and packs are stored by weight or volume (a 400 g tin is `400 g`).
- **Sections** (in walking order): `fruit and veg, bakery, meat and seafood, dairy and fridge, canned veg, canned fruit, international, pantry, herbs and spices, frozen, other`.
- **Allergens** (Australia's mandatory allergens, `private.allergens()`): `egg, milk, peanut, tree nut, sesame, soy, wheat, gluten, fish, crustacean, mollusc, lupin`. An ingredient lists those it usually contains, erring towards tagging (`egg noodle` and `wonton wrapper` are `egg`). Tags are generic, not per brand, so the app and Claude say "check the label" rather than promising a dish is safe.
- **Ingredient names** are singular, lowercase and plain (`onion`, `crushed tomato`); variety and prep go in `note`. Every `recipe_ingredients` row references `ingredients`, so a new ingredient needs a section first.
- **Week start** is always a Monday.

## Derived shopping list

For a household and week: for each planned dish, scale each recipe ingredient by `servings / recipes.serves`, apply the dish's swaps, normalise `kg → g` and `l → ml`, then sum by `(ingredient, unit)`. The item key is `name|unit` (or `extra:<id>`). `list_marks` overlay ticks, bought amounts, missing and already-have. Logic lives in `web/src/lib/list.ts` with Vitest tests; loading and saving in `web/src/lib/shop.ts`. Marks are written column by column, so two shoppers ticking at once do not undo each other. Moving a planned item to another section changes `ingredients.section` for every list (an ingredient only known from a swap is added); moving a hand-added item changes only its `list_extras` row.

When an ingredient has a pack size in the same unit as an item (kg and l compared as g and ml), the list adds the packs to buy, rounded up: `600 g · 2 × 500 g`. Amounts in another unit, a single pack (`1 each`, `1 bunch`) and items with no amount show as before; the question to Claude for a swap leaves packs out. The item sheet sets or clears the ingredient's pack size and shelf life for every household, like its section (a planned item only known from a swap is added; a hand-added item only when it is a known ingredient).

## Moving a night's dinner

The night sheet's **Move** calls `move_night(hid, from_week, from_day, to_week, to_day)`, one write that succeeds or fails as a whole. Every dish on the night moves to the other night (this week or another) keeping its role, position, servings and swaps; if the other night has dishes, the two nights swap, so nothing is merged or lost. The skip-check flag and the lock go with the dinner; each night keeps its own cooked flag and time override (it belongs to the day), and a cooked night on either side is refused. It runs as the caller and checks membership, so it is for the app, not the Claude connector (Claude moves rows with plain SQL). The shopping list follows because it is derived from the dishes; list marks stay with their week. CI checks it in `supabase/tests/move_night.sql`.

### A night's time and lock

A busy night can have its own hands-on time: the night sheet's **Time tonight** stepper (5-minute steps) sets `meal_plan_nights.minutes`, and stepping back to the weekday's setting or **Reset** clears it to null. The night's budget, the over-budget check and the Week tab row ("20 min tonight") follow it (`nightInfo` in `web/src/lib/plan.ts`). **Lock this dinner** sets `locked`, shown as "Locked" on the row; the Dinner Planner skill never changes a locked night's dishes unless asked. Both are the household's: Claude reads them and never writes them.

## Adding and editing recipes by hand

**Add recipe** (the Recipes tab's header) and **Edit** (the recipe view) open the same form (`web/src/components/RecipeForm.tsx`, logic in `web/src/lib/recipeForm.ts` with Vitest tests) with every recipe field except the rating, which the recipe view keeps. Ingredient names autocomplete from `ingredients`; the unit is a dropdown of the fixed units; a name not on the list asks for its section (required) and allergens. Rows reorder with up and down buttons. Problems show next to their field before anything is sent: a missing name, a name another of the household's recipes has (case aside), serves not above 0, minutes that aren't whole, total less than hands-on, unreadable amounts (`2`, `1.5`, `1/2` and `1 1/2` are fine; blank is "to taste").

Each step has a row of ingredient chips (the ingredient rows named so far) to mark which it uses; they follow the rows when they are reordered or removed.

The form edits the recipe's own steps only; a recipe's [methods](#equipment-methods) and their steps are kept as they are.

Saving is one call, `save_recipe(hid, recipe jsonb)`, which succeeds or fails as a whole: a bad unit, a new ingredient without a section or a duplicate name rejects everything. It runs as the caller, so Row Level Security keeps it to the caller's household. Adding makes a unique slug from the name (`chicken-leek-pie`, then `chicken-leek-pie-2`) and sets `created_by` to the caller. Editing keeps the slug, sets `is_example = false` (so **Clear examples** keeps it) and `created_by` if it had none, and keeps the ids of ingredient and step rows that are still there (reordered by `position`), adding and removing the rest, so anything linked to a row survives. A step's `uses` lists positions in the `ingredients` sent (so a new ingredient can be linked before it has an id) and replaces that step's [links](#step-ingredients); a step sent without `uses` keeps its links, and a position past the ingredients rejects the save. The recipe's id doesn't change, so planned dishes and their swaps (by ingredient name) carry on. New ingredients go into the shared `ingredients` list. The Claude connector keeps writing recipes with plain SQL. CI checks it in `supabase/tests/save_recipe.sql`.

## Equipment methods

A recipe can have other ways to cook it with a piece of equipment (beef ragù: 3 h on the stovetop, or 1 h 20 in the pressure cooker). The recipe's own times and its steps without a `method_id` are its usual way; each `recipe_methods` row is another, with its own hands-on and total minutes and its own steps (`recipe_steps.method_id`). The ingredients are the recipe's. `equipment` names what the method needs as the household's settings do (`equipment`, compared without case); null means nothing special. Claude adds methods; the form doesn't edit them.

A planned dish picks one with `meal_plan_dishes.method_id` (null = the usual way). A foreign key on (method_id, recipe_id) keeps it to a method of the dish's own recipe, as it does for a step's method; deleting a method puts its dishes back on the usual way and takes its steps. The night sheet shows a dish's methods when the household has the equipment for one (the usual way, those methods, and one already chosen) and saves the choice; the night's hands-on and total minutes, the over-budget check and "start by" follow it. The recipe view has a switcher for every method, starting on the dish's when opened from a night; it shows that method's times and steps and cook mode follows it, without changing the plan. Moving a night keeps each dish's method. Logic in `web/src/lib/methods.ts` with Vitest tests; CI checks the rules in `supabase/tests/methods.sql`.

## Step ingredients

`recipe_step_ingredients` links a step (of any method) to the recipe's ingredient rows it uses. A trigger refuses a link to another recipe's ingredient, and to a step or ingredient the caller cannot see; Row Level Security goes through the step's recipe. Deleting a step or an ingredient row deletes its links.

Cook mode (`web/src/components/CookMode.tsx`, logic in `web/src/lib/cook.ts` with Vitest tests) opens on **Get these ready**: each ingredient under the first step that needs it, then any no step needs ("Also"). Each step shows the ingredients it uses, scaled to the servings, above its instruction. When a method's steps have links, those are what each step uses (a step with none uses nothing) and the last step names any ingredient no step used ("Didn't use: butter"). A method with no links at all falls back to guessing from each step's text (`stepUses`, the last word of the name), with no left-over check, since the guess misses "the veg". The recipe view lists each step's ingredients the same way. The examples are all linked; the Dinner Planner skill links every recipe it writes and, on request, backfills the household's older recipes. CI checks the rules in `supabase/tests/step_ingredients.sql`.

## Allergens to avoid

`household_settings.settings.avoid` lists the allergens the household avoids (the settings sheet picks them). A planned dish still contains one when an ingredient tagged with it has no swap, or is swapped to an ingredient tagged with it; a swapped ingredient counts as what it was swapped to. The Week tab warns on the night and the night sheet, and the recipe view names the ingredients ("Contains egg (egg noodle)"). Logic in `web/src/lib/allergens.ts` with Vitest tests.

## Seed data

`seed/` is the source of the example ingredients, recipes and household settings. `supabase/seed/seed.sql` loads them into the **template household** (`private.template_household_id()`, `00000000-0000-4000-8000-000000000001`, created by a migration). It has no members, so Row Level Security hides it from every user; it is not a real household. The seed is generated by `node supabase/seed/build.mjs`, which checks units and sections first; regenerate it whenever `seed/` changes, and run it after the migrations (the reviewer does this on the live project after merge). Re-running never duplicates rows and keeps existing ingredient sections and allergens, and existing pack sizes and shelf lives (it fills them only where they are missing); the template's recipes and settings are made to match `seed/` (recipes no longer there are removed). A recipe file may list `methods` (name, equipment, activeMins, totalMins, steps); the beef ragù has its pressure cooker method. Every step lists the ingredients it uses by name (`uses`, empty for a step that uses none); the build refuses a name the recipe doesn't list and a way of cooking that leaves an ingredient unused. The sample week in `seed/plans/` is not loaded.

On first sign-in the app calls `create_household(name)`. It creates the household, makes the caller its `owner`, and copies the template's settings and recipes (with ingredients, steps, methods and step links, `is_example = true`, `created_by` null) into it. Each household gets its own copy: re-seeding never touches existing households, and a household's edits never reach the template or anyone else. A user has one household, so a caller who already belongs to one gets its id back and nothing is created. CI checks the copy in `supabase/tests/households.sql`.

## Members and invites

A household has one `owner` (who made it) and any number of `member`s, who see and change everything the owner does except invites and members. The settings sheet's **Household** section (`web/src/components/HouseholdMembers.tsx`, `web/src/lib/invites.ts`) lists the members; their emails come from `household_member_list(hid)`, since the app cannot read `auth.users`.

- **Invite:** the owner's **Invite someone** calls `create_invite(hid)`, which returns a random token (256 bits, base64url); only its SHA-256 hash is stored. The link is `…/WhatsForDinner/?invite=<token>`; the app copies it and opens the share sheet where there is one. An invite expires after 7 days, works once, and the owner can cancel an open one (`cancel_invite(id)`).
- **Opening the link signed out:** `invite_info(token)` (callable signed out, but only with the token) gives the household's name and whether the invite is open, used, cancelled or expired. The sign-in screen says "You've been invited to <household>" and the magic link returns to the invite link; the token is also kept in local storage in case the link drops it. A link that cannot be used says so, and signing in carries on as usual.
- **Joining:** signed in, the app calls `accept_invite(token)` before looking for a household, and the caller joins as a `member`. **Joining rule:** a caller already in a household can join only if that household is empty: they are its only member, its recipes are all examples never edited (`updated_at = created_at`), and it has no planned dishes, list marks or extras. That household is deleted. Otherwise the join is refused with a plain message and the invite stays open.
- **Leaving and removing:** `remove_member(hid, user_id)`. The owner removes a member; a member removes themself (leaves). The owner cannot leave. A removed member loses access to every household table at once (Row Level Security checks membership), and on their next load the app makes them a new household.
- **Ask Claude** buttons show only to the owner: they open the owner's Claude project, and other people's requests never go through the owner's subscription ([architecture](architecture.md)).

These functions are security definer and check the caller. CI checks them in `supabase/tests/invites.sql`.

## Export and clearing examples

The settings sheet (`web/src/lib/household.ts`) saves `household_settings.settings` keeping any keys it does not show. **Export** downloads one JSON file (`format: 1`) with the household, its members and settings, recipes with their ingredients, steps (with the ingredients each uses) and methods, plan nights and dishes, list marks and extras, votes, suggestions, and the shared `ingredients` list; rows are as stored and read a page at a time past the API row limit. **Clear examples** deletes the household's `is_example` recipes; their ingredients, steps and planned dishes go with them by `on delete cascade`.

## Votes

Each member says 👍 or 👎 to a recipe for a week; no row means no vote, and tapping the same vote again deletes the row. The recipe view (`web/src/components/RecipeVotes.tsx`) votes for the coming week (next Monday's) with a switch to this week, and shows who voted what ("👍 you · 👎 Sam"; a member's name is their email before the @). The Recipes tab filters to recipes with a 👍 from anyone for a week, and the Week tab shows that week's tally ("4 liked, 1 not this week": recipes with a 👍, recipes with a 👎; one with both counts in each), which opens the filtered list. Votes update live for the other member. Logic in `web/src/lib/votes.ts` with Vitest tests. The Dinner Planner skill reads the week's votes when planning and never writes them. CI checks the policies in `supabase/tests/votes.sql`.

## Suggestions

Any member suggests a dinner by name, with an optional description (a link can go there): **Suggest a dinner** on the Week and Recipes tabs (`web/src/components/Suggestions.tsx`). The list beside it shows each suggestion with who made it, its status and Claude's one-line reply; open ones first, then handled ones (added or declined) for two weeks after `handled_at`, which a trigger stamps when the status changes. Older handled ones stay in the table, just off the list. The author edits or deletes their own while it is open. The owner sees "N to refine" and the Ask Claude buttons **Refine this** (the prompt carries the name, description and id) and **Refine all**; members don't. The Dinner Planner skill links an existing recipe or adds one, then sets `status`, `reply` and `recipe_id`, or declines with a reason; it never plans from a suggestion, deletes one or changes its text. An added suggestion opens its recipe, where members vote for it. Suggestions update live. Logic in `web/src/lib/suggestions.ts` with Vitest tests; CI checks the policies in `supabase/tests/suggestions.sql`.

## Side-dish pairings

Pairings are derived, not stored: a main's usual sides are the sides planned with it on nights marked cooked (`meal_plan_dishes` joined to `meal_plan_nights` where `cooked`) in the last 26 weeks, counted once a night. The app works them out in `web/src/lib/plan.ts` (`pairedSides`); the Dinner Planner skill has the same query.

## Later (additive)

pantry (with location and best-before, defaulting from `ingredients.shelf_days`), ingredient_substitutes, per-night time overrides and locks.
