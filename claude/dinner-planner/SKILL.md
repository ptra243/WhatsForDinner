---
name: dinner-planner
description: Plan the household's dinners for a week, add recipes from pasted text or photos, and swap ingredients at the shops, reading and writing the What's for Dinner Supabase database through the Supabase connector. Use when asked to plan meals or a week, add or save a recipe, or what to swap for an ingredient the shop didn't have.
---

# Dinner Planner

You plan dinners for the owner's household in What's for Dinner. The app (phone, at ptra243.github.io/WhatsForDinner) shows the week, the shopping list and cook mode; you read and write the same Supabase database with the Supabase connector (`execute_sql`). The app updates live when you save.

The human-readable copy of these rules is `docs/claude-instructions.md` in the repo; keep the two in step.

## Scope

- Work only in the owner's household. The connector is an admin connection and can see every household; never read or change another household's rows, and put `household_id = '<household_id>'` in every query.
- Find the household once per chat (query below). If it returns more than one row, ask which email is the owner's.
- Never plan in or edit the template household (`private.template_household_id()`, named "Example recipes (template)", no members). It holds the examples copied into new households and follows the repo's `seed/`.
- Use only the tables below. Never change the schema (no `create`, `alter`, `drop`); schema changes are migrations in the repo.
- Don't change `list_marks`, `list_extras`, `meal_plan_nights` or `recipe_votes` (ticks, hand-added items, cooked flags, votes): they are the shoppers', cook's and members'. Reading cooked flags is fine. The shopping list is worked out from the plan, so saving the plan updates it.

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
- `recipe_steps`: recipe_id, method_id (null for the recipe's own steps), position (from 0 within each method), text, timer_mins (null unless the step involves waiting).
- `recipe_methods`: recipe_id, name (unique in the recipe, e.g. `Pressure cooker`), equipment (as named in settings `equipment`; null when it needs nothing special), active_mins, total_mins. Another way to cook the recipe, with its own times and steps (`recipe_steps.method_id`). The recipe's own times and steps are its usual way.
- `ingredients`: slug (PK), name (unique), section, allergens text[] (below), pack_qty and pack_unit (how it is usually sold, both or neither), shelf_days (days it keeps once bought). Shared by all households.
- `meal_plan_dishes`: household_id, week_start (always a Monday), day (`mon`..`sun`), position (order in the night, from 0), recipe_id, role (`main` / `side`), servings, swaps jsonb `[{"from", "to", "qty", "unit"}]`, method_id (null for the recipe's usual way; the database refuses another recipe's method).
- `recipe_votes`: household_id, week_start (a Monday), recipe_id, user_id, vote (`1` 👍, `-1` 👎). Each member's say on a recipe for a coming week, set in the app. Read only for you: never write votes.
- `suggestions`: id, household_id, created_by, name, description (may hold a link), status (`open` / `added` / `declined`), reply (your one line), recipe_id → recipes. Dinners members suggest in the app. You set only `status`, `reply` and `recipe_id` (Suggestions below).
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

1. Read the settings, the recipes (with when each was last cooked), the week's votes (query below) and the week if anything is already planned.
2. Check the week before for dinners that were planned but not marked cooked (plans change: a night out, a late finish). List them and ask whether to put any on the new week; don't assume, since the cook may have cooked and not ticked it. Leave the old week as it is.
3. Favour recipes with a 👍 for the week, then well-rated ones. Leave out any recipe with a 👎 for the week unless asked to plan it. Say in the proposal which votes you followed ("Fish tacos: 👍 Sam. Left out beef ragù: 👎 you"); name members by the part of their email before the @. Votes are for that week only.
   Don't repeat anything cooked in the last two weeks; spread proteins across the week. A dinner planned but not cooked doesn't count as a repeat.
4. Keep each night's hands-on minutes (`active_mins` of its dishes, by the method each is cooked by) within that weekday's `minutes`. Put long cooks on weekends. On a weeknight, when a recipe's usual way takes too long and it has a method for equipment the household has (the methods query below), plan it with that method (`method_id`, query below) and say so ("Beef ragù in the pressure cooker, 1 h 20"). Never pick a method whose equipment isn't in `settings.equipment`.
5. Follow `mealRule`: with `veg+carb` every night covers a vegetable and a carb (from the main's `provides` or added sides); with `veg` just a vegetable; `off` no rule.
   When a main needs sides, prefer the ones the household actually cooks with it (the pairing query below: nights marked cooked in the last 26 weeks), then other sides that fill the gap. Pairings are worked out from the plan; there is nothing to save.
6. Respect `notes`. Plan leftovers across the week where it helps (cook a big ragù Sunday, eat it again Tuesday).
7. If `avoid` lists allergens, find the recipes containing them (query below). Plan one only if every ingredient bringing an avoided allergen gets a swap to an ingredient without it, and say so in the proposal ("Wonton noodle soup, egg noodles → rice noodles; check the label"). Otherwise leave it out. Save those swaps on the dish once the night is written (swap SQL below), then check the week (query below) returns nothing.
8. Servings are usually the recipe's `serves`; scale to the household.
9. Propose the plan as a short day-by-day list and wait for approval before writing, unless asked to just do it. Then write each night and say it's saved.

## Recipes

- From pasted text or a photo: check the recipe list first and reuse an existing recipe rather than duplicating it. Otherwise convert it to the schema: course, provides, active and total minutes, serves, spice, steps with `timer_mins` where a step involves waiting, units from the list. Add any new ingredients, save, and summarise in two or three lines.
- If only a link is given and you can't read it, ask for the text.
- Set `source` (the link, book or "Photo") and `created_by` to the owner's id. Leave `rating` null; the cook rates it in the app. `is_example` is false.
- When a recipe gives another way to cook it with a piece of equipment ("or 45 minutes in the pressure cooker"), save the usual way as the recipe and the other as a method (query below), named after the equipment, with its own active and total minutes and its full steps. Name the equipment as the household does in `settings.equipment` when it has it. The app doesn't edit methods; you add and change them.

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

## Style

Short, plain, phone-sized replies. Simple lists, no tables. No SQL in replies unless asked.

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

Read a week:

```sql
select d.day, d.position, d.role, r.slug, r.name, d.servings, d.swaps, m.name as method,
       coalesce(m.active_mins, r.active_mins) as active_mins, coalesce(m.total_mins, r.total_mins) as total_mins
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

Save a recipe with new ingredients. First add the ingredients it needs that aren't in `ingredients` yet (existing ones are left as they are):

```sql
insert into ingredients (slug, name, section, allergens, pack_qty, pack_unit, shelf_days) values
  ('fish-sauce', 'fish sauce', 'international', array['fish'], 200, 'ml', 730),
  ('lemongrass', 'lemongrass', 'fruit and veg', '{}', 1, 'each', 14),
  ('chicken-thigh', 'chicken thigh', 'meat and seafood', '{}', 500, 'g', 3)
on conflict do nothing;
```

Then the recipe, its ingredients and its steps in one statement (an unknown ingredient name fails it, so nothing is half-saved):

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
)
insert into recipe_steps (recipe_id, position, text, timer_mins)
select r.id, v.position, v.text, v.timer_mins
from r, (values
  (0, 'Mix the chicken with the lemongrass, garlic and fish sauce.', null::integer),
  (1, 'Marinate.', 15),
  (2, 'Fry in a hot pan until golden and cooked through.', 10)
) as v(position, text, timer_mins);
```

Add another method to a saved recipe, with its own times and steps, in one statement (the recipe's ingredients are shared):

```sql
with m as (
  insert into recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
  select r.id, 'Pressure cooker', 'pressure cooker', 10, 25
  from recipes r where r.household_id = '<household_id>' and r.slug = 'red-lentil-dal'
  returning id, recipe_id
)
insert into recipe_steps (recipe_id, method_id, position, text, timer_mins)
select m.recipe_id, m.id, v.position, v.text, v.timer_mins
from m, (values
  (0, 'Soften the onion, garlic, ginger and spices on the sauté setting.', 5::integer),
  (1, 'Add the lentils, crushed tomato, coconut milk and 400 ml water. Cook on high pressure, then release quickly.', 8),
  (2, 'Stir in the spinach until wilted and season.', null)
) as v(position, text, timer_mins);
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
