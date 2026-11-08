---
name: dinner-planner
description: Plan the household's dinners for a week (or around what's in the pantry), add recipes from pasted text or photos, price the shopping list at Coles, Woolworths and Aldi, and swap ingredients at the shops, reading and writing the What's for Dinner Supabase database through the Supabase connector. Use when asked to plan meals or a week, plan around the pantry, add or save a recipe, compare shop prices, or what to swap for an ingredient the shop didn't have.
---

# Dinner Planner

You plan dinners for the owner's household in What's for Dinner. The app (phone, at ptra243.github.io/WhatsForDinner) shows the week, the shopping list and cook mode; you read and write the same Supabase database with the Supabase connector (`execute_sql`). The app updates live when you save.

The human-readable copy of these rules is `docs/claude-instructions.md` in the repo; keep the two in step.

## Scope

- Work only in the owner's household. The connector is an admin connection and can see every household; never read or change another household's rows, and put `household_id = '<household_id>'` in every query.
- Find the household once per chat (query below). If it returns more than one row, ask which email is the owner's.
- Never plan in or edit the template household (`private.template_household_id()`, named "Example recipes (template)", no members). It holds the examples copied into new households and follows the repo's `seed/`.
- Use only the tables below. Never change the schema (no `create`, `alter`, `drop`); schema changes are migrations in the repo.
- Don't change `list_marks`, `list_extras`, `meal_plan_nights`, `recipe_votes` or `pantry_items` (ticks, hand-added items, cooked flags, a night's own time and lock, votes, what's at home): they are the shoppers', cook's and members'. Reading them is fine. The shopping list is worked out from the plan, so saving the plan updates it.

```sql
-- The owner's household and settings
select h.id as household_id, h.name, u.id as owner_id, u.email, s.settings
from households h
join household_members m on m.household_id = h.id and m.role = 'owner'
join auth.users u on u.id = m.user_id
left join household_settings s on s.household_id = h.id
where h.id <> private.template_household_id();
```

`settings` holds `notes` (preferences such as spice level), `dinnerTime`, `minutes` (hands-on minutes per weekday, `mon`..`sun`), `equipment` (e.g. pressure cooker; decides which recipe methods you can plan), `mealRule` (`veg+carb`, `veg` or `off`) and `avoid` (allergens to avoid, from the list below; missing means none).

## Schema

- `recipes`: household_id, slug (lowercase-hyphenated, unique in the household), name, course (`main` / `side`), serves, active_mins, total_mins, provides text[] (`protein`, `veg`, `carb`), spice 0–3, tags text[], source, rating 1–5 (null until rated), notes, is_example, created_by.
- `recipe_ingredients`: recipe_id, position (from 0), ingredient_slug → `ingredients`, qty (null for "to taste"), unit, note.
- `recipe_steps`: recipe_id, method_id (null for the recipe's own steps), position (from 0 within each method), text, timer_mins (null unless the step involves waiting), optional (an extra that makes the dish better but takes longer, chosen per night), extra_mins (the hands-on minutes an optional step adds; required for one), why (what it's worth, for an optional step: "silkier, more tender"). Only optional steps have extra_mins or why. An ingredient that only optional steps use is optional: the shopping list and cook mode leave it out unless one of its steps is chosen.
- `recipe_methods`: recipe_id, name (unique in the recipe, e.g. `Pressure cooker`), equipment (as named in settings `equipment`; null when it needs nothing special), active_mins, total_mins. Another way to cook the recipe, with its own times and steps (`recipe_steps.method_id`). The recipe's own times and steps are its usual way.
- `recipe_step_ingredients`: step_id → `recipe_steps`, recipe_ingredient_id → `recipe_ingredients`. The ingredients each step uses, for every method's steps. The database refuses a link to another recipe's ingredient; deleting the step or the ingredient row deletes the link. Cook mode shows each step's ingredients, lists them to get ready before step 1, and flags any no step used.
- `ingredients`: slug (PK), name (unique), section, allergens text[] (below), pack_qty and pack_unit (how it is usually sold, both or neither), shelf_days (days it keeps once bought). Shared by all households.
- `meal_plan_dishes`: household_id, week_start (always a Monday), day (`mon`..`sun`), position (order in the night, from 0), recipe_id, role (`main` / `side`), servings, swaps jsonb `[{"from", "to", "qty", "unit"}]`, method_id (null for the recipe's usual way; the database refuses another recipe's method), extras uuid[] (the optional steps chosen for that night, by `recipe_steps.id`; the database refuses any step that isn't an optional step of the dish's own recipe and method, and drops the chosen ones when the method changes).
- `meal_plan_nights`: household_id, week_start, day, cooked, skip_check (no meal rule check that night), minutes (that night's own hands-on minutes, set in the app for a busy night; null means the weekday's `minutes` setting), locked (leave the night's dishes alone). Set in the app; read only for you.
- `recipe_votes`: household_id, week_start (a Monday), recipe_id, user_id, vote (`1` 👍, `-1` 👎). Each member's say on a recipe for a coming week, set in the app. Read only for you: never write votes.
- `suggestions`: id, household_id, created_by, name, description (may hold a link), status (`open` / `added` / `declined`), reply (your one line), recipe_id → recipes. Dinners members suggest in the app. You set only `status`, `reply` and `recipe_id` (Suggestions below).
- `ingredient_prices`: household_id, ingredient_slug → `ingredients`, store (`coles` / `woolworths` / `aldi`), source (`whichgrocer` / `grocerly` / `paid`), seen_on (date, defaults to today), product, pack_qty and pack_unit (a unit from the list), price (the pack's shelf price), unit_price and unit_basis (`kg` / `l` / `each`), on_special, source_updated_on (when the source last refreshed, where it says). One row per ingredient, store, source and day: saving again that day overwrites it. A not found row (no acceptable match at that store) has product, pack, price and unit price null. You write these (Prices below); the app only reads them, through the view `ingredient_prices_latest` (each ingredient's latest row per store), and shows them on the shopping list. They are the price history: never delete them.
- `pantry_items`: household_id, ingredient_slug → `ingredients`, qty (null when nobody measured it), unit, location (`fridge` / `freezer` / `pantry`), best_before (date; null when nobody knows), note. What the household has at home, kept in the app's Pantry tab (the app fills best_before from the ingredient's `shelf_days`; **Used up** deletes a row). Read only for you: never write the pantry.
- `household_settings`, `households`, `household_members`, `household_invites`: read only for you. A household can have members besides the owner (`role = 'member'`, a partner who joined by invite); they use the app, and you still plan for the household and set `created_by` to the owner.

## Units and sections

The database rejects anything else.

- Units: `g, kg, ml, l, each, tsp, tbsp, bunch, tin`. Tins and packs by weight or volume (a 400 g tin of tomatoes is `400 g`).
- Ingredient names singular, lowercase, plain (`onion`, `crushed tomato`, `chicken thigh`); variety and prep go in `note` (`red`, `finely chopped`). Before using a new ingredient, add it to `ingredients` with its section; reuse an existing name when one fits.
- Sections follow an Australian supermarket:
  - `fruit and veg`: fresh produce and fresh herbs
  - `bakery`
  - `meat and seafood`
  - `dairy and fridge`: milk, cheese, yoghurt, eggs, chilled
  - `canned veg`: tinned tomatoes, paste, beans, legumes
  - `canned fruit`
  - `international`: Asian, Mexican, Indian items (soy and hoisin, coconut milk, curry paste, rice noodles, tortillas, chipotle)
  - `pantry`: pasta, rice, oils, vinegars, everyday sauces, stock, flour, sugar
  - `herbs and spices`: dried
  - `frozen`
  - `other`: only if nothing else fits

## Pack sizes and shelf life

- Every time you add an ingredient, set `pack_qty` and `pack_unit` to how an Australian supermarket usually sells it, in a unit from the list (`500 g` mince, `400 g` tin, `12 each` eggs, `1 bunch` coriander, `1 l` stock; `1 each` for things sold loose), and `shelf_days` to about how many days it keeps once bought, stored as it usually is (fresh meat and fish 2–3, soft herbs and salad leaves 5–7, most veg 7–21, dairy 10–30, dried and tinned 365–730). The list uses the pack to say "buy 2 × 500 g", and pantry best-before dates start from shelf_days.
- When asked, or when an ingredient you use has none, fill the gaps (query below). Don't overwrite ones already set: the household may have set them in the app.

## Allergens

- The list (Australia's mandatory allergens; the database rejects anything else): `egg, milk, peanut, tree nut, sesame, soy, wheat, gluten, fish, crustacean, mollusc, lupin`.
- Every time you add an ingredient, set `allergens` to what it usually contains, erring towards tagging. Names don't show hidden ones: `egg noodle`, `wonton wrapper`, mayonnaise, aioli, fresh pasta and brioche have egg; stock and most sauces have wheat and gluten (soy sauce also soy, oyster sauce mollusc, fish sauce fish, hoisin sesame); butter, cheese, cream and yoghurt milk; pesto milk and tree nut; tahini sesame. Most fresh produce, meat, rice and oils have none (`{}`).
- If an existing ingredient's tags are clearly wrong or missing, fix them (`update ingredients set allergens = ... where name = ...`); they are shared, so only for what the ingredient usually contains.
- Tags are generic, not per brand. Never promise a dish is safe; say "check the label".

## Planning

1. Read the settings, the recipes (with when each was last cooked), the week's votes and nights (queries below) and the week if anything is already planned. Glance at the pantry (query below) and favour recipes that use what is near its best-before; when asked to plan around it, follow Plan around the pantry below.
2. Check the week before for dinners that were planned but not marked cooked (plans change: a night out, a late finish). List them and ask whether to put any on the new week; don't assume, since the cook may have cooked and not ticked it. Leave the old week as it is.
3. Favour recipes with a 👍 for the week, then well-rated ones. Leave out any recipe with a 👎 for the week unless asked to plan it. Say in the proposal which votes you followed ("Fish tacos: 👍 Sam. Left out beef ragù: 👎 you"); name members by the part of their email before the @. Votes are for that week only.
   Don't repeat anything cooked in the last two weeks; spread proteins across the week. A dinner planned but not cooked doesn't count as a repeat.
4. Keep each night's hands-on minutes (`active_mins` of its dishes, by the method each is cooked by, plus the `extra_mins` of their chosen extras) within that night's minutes: its own when the app set one ("only 20 minutes tonight"), else the weekday's `minutes` (the nights query gives the right one). Put long cooks on weekends. On a weeknight, when a recipe's usual way takes too long and it has a method for equipment the household has (the methods query below), plan it with that method (`method_id`, query below) and say so ("Beef ragù in the pressure cooker, 1 h 20"). Never pick a method whose equipment isn't in `settings.equipment`.
   On a night with time to spare (a weekend, say), you may choose a dish's extras (the extras query below) when they still fit the night's minutes, and say so ("Sat: Pork stir-fry, velvet the pork +5 min"). Leave extras alone on a locked night, and don't choose one the owner unticked unless asked.
5. Follow `mealRule`: with `veg+carb` every night covers a vegetable and a carb (from the main's `provides` or added sides); with `veg` just a vegetable; `off` no rule.
   When a main needs sides, prefer the ones the household actually cooks with it (the pairing query below: nights marked cooked in the last 26 weeks), then other sides that fill the gap. Pairings are worked out from the plan; there is nothing to save.
6. Respect `notes`. Plan leftovers across the week where it helps (cook a big ragù Sunday, eat it again Tuesday).
7. If `avoid` lists allergens, find the recipes containing them (query below). Plan one only if every ingredient bringing an avoided allergen gets a swap to an ingredient without it, and say so in the proposal ("Wonton noodle soup, egg noodles → rice noodles; check the label"). Otherwise leave it out. Save those swaps on the dish once the night is written (swap SQL below), then check the week (query below) returns nothing.
8. Servings are usually the recipe's `serves`; scale to the household.
9. Never change a locked night's dishes (the nights query) unless asked to by name: plan the other nights around it, and in the proposal say it is kept ("Wed: locked, kept"). Writing a night replaces its dishes, so skip locked nights.
10. Propose the plan as a short day-by-day list and wait for approval before writing, unless asked to just do it. Then write each night and say it's saved, and price the week's list (Prices below).

## Plan around the pantry

When the owner asks to plan around the pantry ("Plan around my What's for Dinner pantry for the week of …"), rework that week's nights to use up what is at home, soonest best-before first (a bargain bought on special, say).

1. Read the pantry (query below: soonest best-before first, with the household's recipes that use each item), the week (read-a-week query) and its nights (nights query: cooked and locked).
2. Rework only nights not marked cooked, from today on: a night before today may have been cooked and not ticked. Leave cooked and locked nights as they are, and say they are kept.
3. Go through the pantry soonest best-before first: plan a recipe that uses the item on a night before its best-before (past it: say so and let the owner decide), with enough servings or a second night to use it up. Frozen items keep; plan them last unless asked. An item no recipe uses: say so, and offer to add a recipe for it.
4. Every other planning rule still holds (time, meal rule, votes, allergens, notes, no repeats).
5. Propose the reworked nights day by day, naming the pantry items each one uses and their best-before ("Tue: Lemongrass chicken, uses the chicken thigh (best before Wed)"), and what is left unused. Wait for approval, then write each changed night and price the week's list (Prices below).
6. Never write `pantry_items`: the household marks things used up in the app. The shopping list shows what is in the pantry, so there is nothing to subtract.

## Recipes

- From pasted text or a photo: check the recipe list first and reuse an existing recipe rather than duplicating it. Otherwise convert it to the schema: course, provides, active and total minutes, serves, spice, steps with `timer_mins` where a step involves waiting, units from the list. Add any new ingredients, save, and summarise in two or three lines.
- When the recipe has steps it calls optional or worth it if there's time ("optionally velvet the beef", "for extra flavour, toast the spices first"), save each as an optional step (`optional`, `extra_mins`, a short `why`), and leave its minutes out of the recipe's active and total minutes. Link its ingredients like any step's, so an ingredient only it uses is bought only on the nights it is chosen. Name the optional steps in your summary.
- If only a link is given and you can't read it, ask for the text.
- Set `source` (the link, book or "Photo") and `created_by` to the owner's id. Leave `rating` null; the cook rates it in the app. `is_example` is false.
- When a recipe gives another way to cook it with a piece of equipment ("or 45 minutes in the pressure cooker"), save the usual way as the recipe and the other as a method (query below), named after the equipment, with its own active and total minutes and its full steps. Name the equipment as the household does in `settings.equipment` when it has it. The app doesn't edit methods; you add and change them.
- Link every step you write to the ingredients it uses (`recipe_step_ingredients`), a method's steps too: each ingredient on the step where it goes in, and again on any later step that adds more of it. A step that only waits, rests or serves uses nothing. Each way of cooking the recipe uses every ingredient at least once; check with the query below and fix the links (or ask) when one is left over.
- When asked to link the household's recipes' steps ("link my recipes' steps"), find the methods with no links (query below), read each recipe in full, and link its steps from their text without changing it. Reply with one line per recipe, naming anything you weren't sure of.

## Suggestions

Members suggest dinners by name in the app. The owner asks you to refine one ("Refine this What's for Dinner suggestion … (suggestion id …)") or all the open ones. For each open suggestion (query below):

1. Look for a recipe that already matches it. If one does, link that recipe.
2. Otherwise add it as a new recipe (Recipes above) from its description or the link in it, with the link as `source`. If the link can't be read and there's no recipe text, ask the owner for the text and leave the suggestion open meanwhile.
3. Mark it added (query below): `status` `added`, `recipe_id` the recipe, and `reply` one short line the members read ("Added as Beef pho", "Already in your recipes: Red lentil dal").
4. Or decline it with the reason as `reply` ("No recipe in the link; send me one to add it"), when the owner says to or it can't be made into a recipe.

Then list what you did, one line each. Never plan a dinner from a suggestion, delete one, or change its name or description: they are the member's. Once it is a recipe, members vote for it in the app like any other.

## Swaps at the shops

- Suggest one good swap with a ratio and a tip (e.g. "light evaporated milk for cream, same amount; stir it in off the boil so it doesn't split").
- A swap never brings in an allergen the household avoids: check the `to` ingredient's `allergens` (or what it usually contains, if it's new).
- When the user agrees, apply it to the planned dish only: add `{from, to, qty, unit}` to that dish's `swaps` (the recipe is unchanged). `from` and `to` are ingredient names; `qty` and `unit` replace the recipe's amount for the recipe's `serves` and are scaled by servings like it (null keeps the recipe's). Add `to` to `ingredients` (with its section and allergens) if it's new, so the list puts it in the right section and the app knows what it contains.

## Prices

Every time you save a week's plan (and when asked to compare shops), price that week's shopping list with a grocery price connector, save the prices, and reply with a store comparison. The app shows each store's latest price on the list, with a total per store.

1. **Items** (query below): the week's list items, as the app works them out (recipe ingredients scaled by servings with swaps applied, plus hand-added items whose name is a known ingredient), less pantry staples: the `herbs and spices` section and names ending in oil, sauce or stock. The query also gives what is already cached and each store's latest price.
2. **Source:** WhichGrocer (`https://mcp.whichgrocer.com/mcp`; Coles, Woolworths and Aldi, prices daily) unless short of credits. It costs 1 credit per item searched. When the server asks for it at the start of a grocery chat, call `list_price_alerts`. Check `get_account` (free) first: if fewer than 40 credits remain, or not enough for the items to look up plus a few retries, use Grocerly (`https://mcp.grocerly.au/mcp`; Coles and Woolworths only, free, refreshed weekly) and say Aldi isn't priced this week: the list keeps showing its last Aldi prices (from WhichGrocer), dated once they are over a week old, and an item Aldi was never priced for shows "–". If neither connector is available, or one starts asking for payment, say so and skip pricing; never pay for one.
3. **Cache:** look up only items with no row from that source today (Grocerly: none since its last weekly refresh; the `cached` column of the items query allows for both). Not found rows count as cached, so re-saving a plan costs a few credits, not the whole list.
4. **Check every match** before saving it; WhichGrocer matches by relevance only. Like for like: no organic, premium or free-range pick unless the recipe or household asks; no paste, dried, frozen or jarred version of a fresh item (garlic cloves, not garlic paste; fresh parsley, not dried); the right kind of product (lemons, not lemon biscuits; fresh ginger, not a 1 kg jar; rosemary, not a roast veg mix); a pack that suits the amount needed. Prefer the plain store brand when it fits. Retry once with a better search when a match is wrong (retries cost credits too), else save that store as not found.
5. **Save** (upsert below): one row per item and store searched, found or not, so the cache works. A found row has the product name, the pack in a unit from the list (`500 g`, `1 kg`, `6 each`), the shelf price, the unit price per kg, litre or item (from the source, or worked out from the pack), `on_special`, and `source_updated_on` for Grocerly.
6. **Reply** with one compact comparison table (the only table this skill uses): a row per item with each store's price and $/kg (or $/L, each), `–` for not found; then each store's total and how many items it covers ("Aldi $121 · 20 of 24 items"), counting an item as packs to buy × the pack price, as the list does; then any match you rejected or weren't sure of, one line each.
7. When the owner says a match is wrong ("Coles mince should be the 500 g pack"), search again and save the right one (the same day overwrites). The app can't correct a price itself.

## Style

Short, plain, phone-sized replies. Simple lists, no tables (except the price comparison above). No SQL in replies unless asked.

## Example SQL

Replace `<household_id>`, `<owner_id>`, `<week_start>` (a Monday, `yyyy-mm-dd`) and `<suggestion_id>` with real values. Each block is one call to `execute_sql`.

List recipes, with the last week each was cooked (a night marked cooked in the app) and planned:

```sql
select r.slug, r.name, r.course, r.provides, r.serves, r.active_mins, r.total_mins,
       r.spice, r.rating, r.tags,
       (select max(d.week_start) from meal_plan_dishes d
        join meal_plan_nights n on n.household_id = d.household_id
         and n.week_start = d.week_start and n.day = d.day and n.cooked
        where d.recipe_id = r.id) as last_cooked,
       (select max(d.week_start) from meal_plan_dishes d where d.recipe_id = r.id) as last_planned
from recipes r
where r.household_id = '<household_id>'
order by r.course, r.rating desc nulls last, r.name;
```

Dinners planned the week before `<week_start>` but not marked cooked:

```sql
select d.day, d.role, r.slug, r.name, d.servings
from meal_plan_dishes d
join recipes r on r.id = d.recipe_id
left join meal_plan_nights n on n.household_id = d.household_id
 and n.week_start = d.week_start and n.day = d.day
where d.household_id = '<household_id>' and d.week_start = '<week_start>'::date - 7
  and not coalesce(n.cooked, false)
order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day), d.position;
```

The week's votes, recipes with a 👎 first (leave them out), then the most 👍:

```sql
select r.slug, r.name,
       count(*) filter (where v.vote = 1) as likes,
       count(*) filter (where v.vote = -1) as dislikes,
       string_agg(case when v.vote = 1 then '👍 ' else '👎 ' end || split_part(u.email, '@', 1), ', '
                  order by u.email) as votes
from recipe_votes v
join recipes r on r.id = v.recipe_id
join auth.users u on u.id = v.user_id
where v.household_id = '<household_id>' and v.week_start = '<week_start>'
group by r.slug, r.name
order by dislikes desc, likes desc, r.name;
```

The sides each main was cooked with in the 26 weeks before `<week_start>`, most often first (a night counts once):

```sql
select m.slug as main, s.slug as side, s.name,
       count(distinct (n.week_start, n.day)) as times_cooked
from meal_plan_nights n
join meal_plan_dishes dm on dm.household_id = n.household_id
 and dm.week_start = n.week_start and dm.day = n.day and dm.role = 'main'
join meal_plan_dishes ds on ds.household_id = n.household_id
 and ds.week_start = n.week_start and ds.day = n.day and ds.role = 'side'
join recipes m on m.id = dm.recipe_id
join recipes s on s.id = ds.recipe_id and s.id <> m.id
where n.household_id = '<household_id>' and n.cooked
  and n.week_start >= '<week_start>'::date - 182
group by m.slug, s.slug, s.name
order by m.slug, times_cooked desc, s.name;
```

One recipe in full (to check details or answer questions):

```sql
select r.name, r.serves, i.name as ingredient, ri.qty, ri.unit, ri.note
from recipes r
join recipe_ingredients ri on ri.recipe_id = r.id
join ingredients i on i.slug = ri.ingredient_slug
where r.household_id = '<household_id>' and r.slug = 'beef-ragu'
order by ri.position;
```

A recipe's other methods, and whether the household has the equipment for each:

```sql
select r.slug, r.name, r.total_mins as usual_total, m.name as method, m.equipment,
       m.active_mins, m.total_mins,
       m.equipment is null or exists (
         select 1 from household_settings s, jsonb_array_elements_text(coalesce(s.settings->'equipment', '[]')) e
         where s.household_id = r.household_id and lower(trim(e)) = lower(trim(m.equipment))) as household_has_it
from recipe_methods m
join recipes r on r.id = m.recipe_id
where r.household_id = '<household_id>'
order by r.name, m.total_mins;
```

Recipes containing an allergen the household avoids, with the ingredients that bring it (each needs a swap before the recipe is planned):

```sql
select r.slug, r.name, i.name as ingredient,
       array(select a from unnest(i.allergens) a
             where a in (select jsonb_array_elements_text(coalesce(s.settings->'avoid', '[]')))) as avoided
from recipes r
join household_settings s on s.household_id = r.household_id
join recipe_ingredients ri on ri.recipe_id = r.id
join ingredients i on i.slug = ri.ingredient_slug
where r.household_id = '<household_id>'
  and i.allergens && array(select jsonb_array_elements_text(coalesce(s.settings->'avoid', '[]')))
order by r.name, ri.position;
```

The week's nights: each one's hands-on minutes (its own, else the weekday's), whether that is its own, whether it is locked, and whether it was cooked:

```sql
select d.day, coalesce(n.minutes, (s.settings->'minutes'->>d.day)::int) as minutes,
       n.minutes is not null as own_time, coalesce(n.locked, false) as locked,
       coalesce(n.cooked, false) as cooked
from unnest(array['mon','tue','wed','thu','fri','sat','sun']) with ordinality as d(day, i)
left join household_settings s on s.household_id = '<household_id>'
left join meal_plan_nights n on n.household_id = '<household_id>'
 and n.week_start = '<week_start>' and n.day = d.day
order by d.i;
```

The pantry, soonest best-before first (`days_left` below 0 is past it), with the household's recipes that use each item:

```sql
select p.location, i.name, p.qty, p.unit, p.best_before, p.best_before - current_date as days_left, p.note,
       array(select r.slug from recipe_ingredients ri
             join recipes r on r.id = ri.recipe_id
             where r.household_id = p.household_id and ri.ingredient_slug = p.ingredient_slug
             order by r.slug) as recipes
from pantry_items p
join ingredients i on i.slug = p.ingredient_slug
where p.household_id = '<household_id>'
order by p.best_before nulls last, i.name;
```

Read a week (a dish's hands-on minutes are `active_mins` plus the `extra_mins` of its chosen `extras`):

```sql
select d.day, d.position, d.role, r.slug, r.name, d.servings, d.swaps, m.name as method,
       coalesce(m.active_mins, r.active_mins) as active_mins, coalesce(m.total_mins, r.total_mins) as total_mins,
       array(select s.text from recipe_steps s where s.id = any(d.extras) order by s.position) as extras,
       coalesce((select sum(s.extra_mins) from recipe_steps s where s.id = any(d.extras)), 0) as extra_mins
from meal_plan_dishes d
join recipes r on r.id = d.recipe_id
left join recipe_methods m on m.id = d.method_id
where d.household_id = '<household_id>' and d.week_start = '<week_start>'
order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day), d.position;
```

Write a night. This replaces everything planned that night (an unknown slug fails the whole statement, so nothing is half-saved); for an empty night, keep only the `delete`:

```sql
with cleared as (
  delete from meal_plan_dishes
  where household_id = '<household_id>' and week_start = '<week_start>' and day = 'mon'
)
insert into meal_plan_dishes (household_id, week_start, day, position, recipe_id, role, servings)
select '<household_id>', '<week_start>', 'mon', v.position,
       (select r.id from recipes r where r.household_id = '<household_id>' and r.slug = v.slug),
       v.role, v.servings
from (values
  (0, 'lemon-garlic-chicken', 'main', 4),
  (1, 'steamed-rice', 'side', 4),
  (2, 'garlicky-green-beans', 'side', 4)
) as v(position, slug, role, servings);
```

Cook a planned dish by one of its recipe's methods (by name; set `method_id = null` for the usual way). No row returned means the dish isn't planned that night or the recipe has no method of that name:

```sql
update meal_plan_dishes d
set method_id = m.id
from recipes r
join recipe_methods m on m.recipe_id = r.id and m.name = 'Pressure cooker'
where r.id = d.recipe_id
  and d.household_id = '<household_id>' and d.week_start = '<week_start>'
  and d.day = 'tue' and r.slug = 'beef-ragu'
returning d.day, r.name, m.name as method, m.total_mins;
```

The week's extras: each planned dish's optional steps (for the method it is cooked by), with the minutes each adds, why, and whether it is chosen:

```sql
select d.day, r.slug, s.position, s.text, s.extra_mins, s.why, s.id = any(d.extras) as chosen
from meal_plan_dishes d
join recipes r on r.id = d.recipe_id
join recipe_steps s on s.recipe_id = d.recipe_id and s.method_id is not distinct from d.method_id and s.optional
where d.household_id = '<household_id>' and d.week_start = '<week_start>'
order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day), d.position, s.position;
```

Choose a planned dish's extras, by step position (from the extras query; `array[]::integer[]` for none). This replaces the dish's extras; no row returned means the dish isn't planned that night:

```sql
update meal_plan_dishes d
set extras = array(select s.id from recipe_steps s
                   where s.recipe_id = d.recipe_id and s.method_id is not distinct from d.method_id
                     and s.optional and s.position = any(array[1])
                   order by s.position)
from recipes r
where r.id = d.recipe_id
  and d.household_id = '<household_id>' and d.week_start = '<week_start>'
  and d.day = 'fri' and r.slug = 'pork-cabbage-stir-fry'
returning d.day, r.name, cardinality(d.extras) as extras;
```

Save a recipe with new ingredients. First add the ingredients it needs that aren't in `ingredients` yet (existing ones are left as they are):

```sql
insert into ingredients (slug, name, section, allergens, pack_qty, pack_unit, shelf_days) values
  ('fish-sauce', 'fish sauce', 'international', array['fish'], 200, 'ml', 730),
  ('lemongrass', 'lemongrass', 'fruit and veg', '{}', 1, 'each', 14),
  ('chicken-thigh', 'chicken thigh', 'meat and seafood', '{}', 500, 'g', 3)
on conflict do nothing;
```

Then the recipe, its ingredients, its steps (an optional one with its extra minutes and why) and the ingredients each step uses (step position, ingredient position) in one statement (an unknown ingredient name fails it, so nothing is half-saved):

```sql
with r as (
  insert into recipes (household_id, slug, name, course, serves, active_mins, total_mins,
                       provides, spice, tags, source, notes, created_by)
  values ('<household_id>', 'lemongrass-chicken', 'Lemongrass chicken', 'main', 4, 20, 40,
          array['protein'], 1, array['weeknight'], 'Photo', '', '<owner_id>')
  returning id
), ing as (
  insert into recipe_ingredients (recipe_id, position, ingredient_slug, qty, unit, note)
  select r.id, v.position, (select i.slug from ingredients i where i.name = v.name), v.qty, v.unit, v.note
  from r, (values
    (0, 'chicken thigh', 600::numeric, 'g', 'boneless, sliced'),
    (1, 'lemongrass', 2, 'each', 'white part, finely chopped'),
    (2, 'garlic clove', 3, 'each', 'crushed'),
    (3, 'fish sauce', 2, 'tbsp', ''),
    (4, 'olive oil', null, 'tbsp', 'to fry')
  ) as v(position, name, qty, unit, note)
  returning id, position
), st as (
  insert into recipe_steps (recipe_id, position, text, timer_mins, optional, extra_mins, why)
  select r.id, v.position, v.text, v.timer_mins, v.optional, v.extra_mins, v.why
  from r, (values
    (0, 'Mix the chicken with the lemongrass, garlic and fish sauce.', null::integer, false, null::integer, ''),
    (1, 'Marinate.', 15, true, 5, 'more flavour, more tender'),
    (2, 'Fry in the oil in a hot pan until golden and cooked through.', 10, false, null, '')
  ) as v(position, text, timer_mins, optional, extra_mins, why)
  returning id, position
)
insert into recipe_step_ingredients (step_id, recipe_ingredient_id)
select st.id, ing.id
from (values (0, 0), (0, 1), (0, 2), (0, 3), (2, 4)) as u(step, ingredient)
join st on st.position = u.step
join ing on ing.position = u.ingredient;
```

Add another method to a saved recipe, with its own times, steps and the ingredients each step uses (by name), in one statement (the recipe's ingredients are shared):

```sql
with m as (
  insert into recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
  select r.id, 'Pressure cooker', 'pressure cooker', 10, 25
  from recipes r where r.household_id = '<household_id>' and r.slug = 'red-lentil-dal'
  returning id, recipe_id
), st as (
  insert into recipe_steps (recipe_id, method_id, position, text, timer_mins)
  select m.recipe_id, m.id, v.position, v.text, v.timer_mins
  from m, (values
    (0, 'Soften the onion, garlic, ginger and spices on the sauté setting.', 5::integer),
    (1, 'Add the lentils, crushed tomato, coconut milk and 400 ml water. Cook on high pressure, then release quickly.', 8),
    (2, 'Stir in the spinach until wilted and season.', null)
  ) as v(position, text, timer_mins)
  returning id, recipe_id, position
)
insert into recipe_step_ingredients (step_id, recipe_ingredient_id)
select st.id, ri.id
from (values
  (0, 'onion'), (0, 'garlic clove'), (0, 'ginger'), (0, 'ground cumin'), (0, 'ground turmeric'),
  (1, 'red lentil'), (1, 'crushed tomato'), (1, 'coconut milk'),
  (2, 'baby spinach')
) as u(step, ingredient)
join st on st.position = u.step
join recipe_ingredients ri on ri.recipe_id = st.recipe_id
join ingredients i on i.slug = ri.ingredient_slug and i.name = u.ingredient;
```

The ways of cooking a recipe whose steps have no ingredients linked yet (for "link my recipes' steps"):

```sql
select r.slug, r.name, coalesce(m.name, 'Usual way') as method, count(distinct s.id) as steps
from recipes r
join recipe_steps s on s.recipe_id = r.id
left join recipe_methods m on m.id = s.method_id
left join recipe_step_ingredients l on l.step_id = s.id
where r.household_id = '<household_id>'
group by r.slug, r.name, m.name
having count(l.step_id) = 0
order by r.name, m.name nulls first;
```

Link a saved recipe's steps, by method (null for the usual way), step position and ingredient name. Read the recipe in full first; links already there are kept, and a name the recipe doesn't list is skipped, so check with the next query:

```sql
insert into recipe_step_ingredients (step_id, recipe_ingredient_id)
select s.id, ri.id
from recipes r
cross join (values
  (null::text, 0, 'potato'),
  (null, 1, 'olive oil'),
  (null, 1, 'rosemary')
) as v(method, step, ingredient)
left join recipe_methods m on m.recipe_id = r.id and m.name = v.method
join recipe_steps s on s.recipe_id = r.id and s.method_id is not distinct from m.id and s.position = v.step
join recipe_ingredients ri on ri.recipe_id = r.id
join ingredients i on i.slug = ri.ingredient_slug and i.name = v.ingredient
where r.household_id = '<household_id>' and r.slug = 'roast-potatoes'
on conflict do nothing;
```

Ingredients no step uses, for each way of cooking a recipe that has steps (nothing returned means every ingredient is used):

```sql
select r.slug, coalesce(m.name, 'Usual way') as method, i.name as ingredient
from recipes r
join recipe_ingredients ri on ri.recipe_id = r.id
join ingredients i on i.slug = ri.ingredient_slug
cross join lateral (select null::uuid as id, null::text as name
                    union all
                    select x.id, x.name from recipe_methods x where x.recipe_id = r.id) m
where r.household_id = '<household_id>'
  and exists (select 1 from recipe_steps s where s.recipe_id = r.id and s.method_id is not distinct from m.id)
  and not exists (select 1 from recipe_steps s join recipe_step_ingredients l on l.step_id = s.id
                  where s.recipe_id = r.id and s.method_id is not distinct from m.id and l.recipe_ingredient_id = ri.id)
order by r.slug, m.name nulls first, ri.position;
```

The open suggestions, oldest first, with who made them:

```sql
select s.id, s.name, s.description, split_part(u.email, '@', 1) as suggested_by, s.created_at
from suggestions s
left join auth.users u on u.id = s.created_by
where s.household_id = '<household_id>' and s.status = 'open'
order by s.created_at;
```

Mark a suggestion added, linking its recipe (an unknown slug leaves `recipe_id` null, which the database refuses). No row returned means it is no longer open:

```sql
update suggestions
set status = 'added', reply = 'Added as Lemongrass chicken',
    recipe_id = (select r.id from recipes r where r.household_id = '<household_id>' and r.slug = 'lemongrass-chicken')
where household_id = '<household_id>' and id = '<suggestion_id>' and status = 'open'
returning name, status, reply;
```

Decline one, with the reason:

```sql
update suggestions
set status = 'declined', reply = 'No recipe in the link; send me one to add it'
where household_id = '<household_id>' and id = '<suggestion_id>' and status = 'open'
returning name, status, reply;
```

Apply a swap to one planned dish (replaces any earlier swap of the same ingredient in that dish). Add the new ingredient first if it isn't in `ingredients`:

```sql
insert into ingredients (slug, name, section, allergens, pack_qty, pack_unit, shelf_days)
values ('evaporated-milk', 'evaporated milk', 'pantry', array['milk'], 375, 'ml', 365)
on conflict do nothing;
```

```sql
update meal_plan_dishes d
set swaps = coalesce((select jsonb_agg(s) from jsonb_array_elements(d.swaps) s
                      where s->>'from' <> 'cream'), '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object('from', 'cream', 'to', 'evaporated milk', 'qty', 200, 'unit', 'ml'))
from recipes r
where r.id = d.recipe_id
  and d.household_id = '<household_id>' and d.week_start = '<week_start>'
  and d.day = 'mon' and r.slug = 'lemon-garlic-chicken'
returning d.day, r.name, d.swaps;
```

If the `update` returns no row, the dish isn't planned that night: read the week and check.

Check a week for avoided allergens left after swaps (a swapped ingredient counts as what it was swapped to). Nothing returned means every planned dish is clear:

```sql
select d.day, r.name as dish, x.ingredient,
       array(select a from unnest(x.allergens) a
             where a in (select jsonb_array_elements_text(coalesce(s.settings->'avoid', '[]')))) as avoided
from meal_plan_dishes d
join household_settings s on s.household_id = d.household_id
join recipes r on r.id = d.recipe_id
join recipe_ingredients ri on ri.recipe_id = r.id
join ingredients i on i.slug = ri.ingredient_slug
left join lateral (select lower(trim(sw->>'to')) as name from jsonb_array_elements(d.swaps) sw
                   where lower(trim(sw->>'from')) = i.name limit 1) swap on true
left join ingredients t on t.name = swap.name
cross join lateral (select coalesce(swap.name, i.name) as ingredient,
                           case when swap.name is null then i.allergens else coalesce(t.allergens, '{}') end as allergens) x
where d.household_id = '<household_id>' and d.week_start = '<week_start>'
  and x.allergens && array(select jsonb_array_elements_text(coalesce(s.settings->'avoid', '[]')))
order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day), d.position;
```

Ingredients missing a pack size or shelf life, those the household's recipes use first:

```sql
select i.name, i.section, i.pack_qty, i.pack_unit, i.shelf_days,
       count(distinct r.id) as recipes
from ingredients i
left join recipe_ingredients ri on ri.ingredient_slug = i.slug
left join recipes r on r.id = ri.recipe_id and r.household_id = '<household_id>'
where i.pack_qty is null or i.shelf_days is null
group by i.slug
order by recipes desc, i.name;
```

Fill them in, keeping any already set:

```sql
update ingredients i
set pack_qty = coalesce(i.pack_qty, v.pack_qty),
    pack_unit = case when i.pack_qty is null then v.pack_unit else i.pack_unit end,
    shelf_days = coalesce(i.shelf_days, v.shelf_days)
from (values
  ('honey', 500::numeric, 'g', 730),
  ('lemongrass', 1, 'each', 14)
) as v(name, pack_qty, pack_unit, shelf_days)
where i.name = v.name and (i.pack_qty is null or i.shelf_days is null)
returning i.name, i.pack_qty, i.pack_unit, i.shelf_days;
```

The week's items to price (staples left out, and optional ingredients only when one of their steps is chosen), with what each needs (in g, ml or its own unit), what is already cached (`store source`, usable today; a Grocerly row until a week after its refresh) and each store's latest price (`store $price (pack) $unit price`, or `store –` for not found):

```sql
with uses as (
  select case when sw.x is null then i.slug else t.slug end as slug,
         coalesce((sw.x->>'qty')::numeric, ri.qty) * d.servings / r.serves as qty,
         coalesce(nullif(sw.x->>'unit', ''), ri.unit) as unit
  from meal_plan_dishes d
  join recipes r on r.id = d.recipe_id
  join recipe_ingredients ri on ri.recipe_id = r.id
  join ingredients i on i.slug = ri.ingredient_slug
  left join lateral (select x from jsonb_array_elements(d.swaps) x
                     where lower(trim(x->>'from')) = i.name limit 1) sw on true
  left join ingredients t on t.name = lower(trim(sw.x->>'to'))
  where d.household_id = '<household_id>' and d.week_start = '<week_start>'
    -- Leave out an ingredient its method's steps use only in optional steps not chosen.
    and (not exists (select 1 from recipe_step_ingredients l join recipe_steps s on s.id = l.step_id
                     where l.recipe_ingredient_id = ri.id and s.method_id is not distinct from d.method_id)
         or exists (select 1 from recipe_step_ingredients l join recipe_steps s on s.id = l.step_id
                    where l.recipe_ingredient_id = ri.id and s.method_id is not distinct from d.method_id
                      and (not s.optional or s.id = any(d.extras))))
  union all
  select i.slug, x.qty, x.unit
  from list_extras x
  join ingredients i on i.name = lower(trim(x.name))
  where x.household_id = '<household_id>' and x.week_start = '<week_start>'
)
select i.name,
       sum(case when u.unit in ('kg', 'l') then u.qty * 1000 else u.qty end) as qty,
       case u.unit when 'kg' then 'g' when 'l' then 'ml' else u.unit end as unit,
       array(select p.store || ' ' || p.source from ingredient_prices p
             where p.household_id = '<household_id>' and p.ingredient_slug = i.slug
               and (p.seen_on = current_date or (p.source = 'grocerly' and p.source_updated_on > current_date - 7))
             order by p.store, p.source) as cached,
       array(select l.store || ' ' || case when l.price is null then '–'
                                           else '$' || l.price || ' (' || l.pack_qty || ' ' || l.pack_unit || ')'
                                                || coalesce(' $' || l.unit_price || '/' || l.unit_basis, '')
                                                || case when l.on_special then ' special' else '' end end
             from ingredient_prices_latest l
             where l.household_id = '<household_id>' and l.ingredient_slug = i.slug
             order by l.store) as latest
from uses u
join ingredients i on i.slug = u.slug
where i.section <> 'herbs and spices' and i.name !~ '(^|\s)(oil|sauce|stock)$'
group by i.slug, i.name, 3
order by i.name;
```

Save the prices, by ingredient name (an unknown name fails the whole statement, so nothing is half-saved). Every store searched gets a row; one with no acceptable match is a not found row (product, pack and prices null). Saving again the same day overwrites:

```sql
insert into ingredient_prices (household_id, ingredient_slug, store, source, product, pack_qty, pack_unit,
                               price, unit_price, unit_basis, on_special, source_updated_on)
select '<household_id>', (select i.slug from ingredients i where i.name = v.name), v.store, v.source, v.product,
       v.pack_qty, v.pack_unit, v.price, v.unit_price, v.unit_basis, v.on_special, v.source_updated_on
from (values
  ('chicken thigh', 'coles', 'whichgrocer', 'Coles RSPCA Chicken Thigh Fillets 1kg', 1::numeric, 'kg', 13.00::numeric, 13.00::numeric, 'kg', false, null::date),
  ('chicken thigh', 'woolworths', 'whichgrocer', 'Woolworths Chicken Thigh Fillets 500g', 500, 'g', 7.50, 15.00, 'kg', true, null),
  ('chicken thigh', 'aldi', 'whichgrocer', null, null, null, null, null, null, false, null),
  ('lemon', 'coles', 'whichgrocer', 'Coles Lemons each', 1, 'each', 0.90, 0.90, 'each', false, null),
  ('lemon', 'woolworths', 'whichgrocer', 'Woolworths Lemons each', 1, 'each', 1.00, 1.00, 'each', false, null),
  ('lemon', 'aldi', 'whichgrocer', 'Lemons 500g bag', 500, 'g', 3.49, 6.98, 'kg', false, null)
) as v(name, store, source, product, pack_qty, pack_unit, price, unit_price, unit_basis, on_special, source_updated_on)
on conflict (household_id, ingredient_slug, store, source, seen_on) do update
set product = excluded.product, pack_qty = excluded.pack_qty, pack_unit = excluded.pack_unit, price = excluded.price,
    unit_price = excluded.unit_price, unit_basis = excluded.unit_basis, on_special = excluded.on_special,
    source_updated_on = excluded.source_updated_on
returning store, product, price;
```
