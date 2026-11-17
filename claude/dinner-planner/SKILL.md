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

`settings` holds `notes` (preferences such as spice level), `dinnerTime`, `minutes` (hands-on minutes per weekday, `mon`..`sun`), `equipment` (e.g. pressure cooker; decides which recipe methods you can plan), `mealRule` (`veg+carb`, `veg` or `off`), `avoid` (allergens to avoid, from the list below; missing means none) and `weekStartsOn` (`mon`..`sun`, the day the household's week starts on, to match when it shops; missing means Monday).

## Schema

- `recipes`: household_id, slug (lowercase-hyphenated, unique in the household), name, course (`main` / `side`), serves, active_mins, total_mins, provides text[] (`protein`, `veg`, `carb`), spice 0–3, tags text[], source, rating 1–5 (null until rated), notes, is_example, created_by.
- `recipe_ingredients`: recipe_id, position (from 0), ingredient_slug → `ingredients`, qty (null for "to taste"), unit, note.
- `recipe_steps`: recipe_id, method_id (null for the recipe's own steps), position (from 0 within each method), text, timer_mins (null unless the step involves waiting), optional (an extra that makes the dish better but takes longer, chosen per night), extra_mins (the minutes an optional step adds, required for one; the night counts them in both hands-on and total time, so include any waiting it adds), why (what it's worth, for an optional step: "silkier, more tender"). Only optional steps have extra_mins or why. cue (what done looks like: "browned at the edges", "a knife slides in"; null for none) and tip (the step's one usual problem and its fix: "Soaking up the oil is normal; keep going, don't add more"; null for none) are each at most 140 characters and never an empty string; cook mode shows them under the step as "Done when: …" and "If …", and the recipe view shows the cue. An ingredient that only optional steps use is optional: the shopping list and cook mode leave it out unless one of its steps is chosen.
- `recipe_methods`: recipe_id, name (unique in the recipe, e.g. `Pressure cooker`), equipment (as named in settings `equipment`; null when it needs nothing special), active_mins, total_mins. Another way to cook the recipe, with its own times and steps (`recipe_steps.method_id`). The recipe's own times and steps are its usual way.
- `recipe_step_ingredients`: step_id → `recipe_steps`, recipe_ingredient_id → `recipe_ingredients`. The ingredients each step uses, for every method's steps. The database refuses a link to another recipe's ingredient; deleting the step or the ingredient row deletes the link. Cook mode shows each step's ingredients, lists them to get ready before step 1, and flags any no step used.
- `ingredients`: slug (PK), name (unique), section, allergens text[] (below), pack_qty and pack_unit (how it is usually sold, both or neither), shelf_days (days it keeps once bought). Shared by all households.
- `meal_plan_dishes`: household_id, week_start (the first day of the household's week, the `weekStartsOn` day; the database refuses any other), day (`mon`..`sun`, the night in that week with that weekday), position (order in the night, from 0), recipe_id, role (`main` / `side`), servings, swaps jsonb `[{"from", "to", "qty", "unit"}]`, method_id (null for the recipe's usual way; the database refuses another recipe's method), extras uuid[] (the optional steps chosen for that night, by `recipe_steps.id`; the database refuses any step that isn't an optional step of the dish's own recipe and method, and drops the chosen ones when the method changes).
- `meal_plan_nights`: household_id, week_start, day, cooked, skip_check (no meal rule check that night), minutes (that night's own hands-on minutes, set in the app for a busy night; null means the weekday's `minutes` setting), locked (leave the night's dishes alone). Set in the app; read only for you.
- `recipe_votes`: household_id, week_start (the first day of the household's week), recipe_id, user_id, vote (`1` 👍, `-1` 👎). Each member's say on a recipe for a coming week, set in the app. Read only for you: never write votes.
- `suggestions`: id, household_id, created_by, name, description (may hold a link), status (`open` / `added` / `declined`), reply (your one line), recipe_id → recipes. Dinners members suggest in the app. You set only `status`, `reply` and `recipe_id` (Suggestions below).
- `ingredient_prices`: household_id, ingredient_slug → `ingredients`, store (`coles` / `woolworths` / `aldi`), source (`whichgrocer` / `grocerly` / `paid`), seen_on (date, defaults to today), product, pack_qty and pack_unit (a unit from the list), price (the pack's shelf price), unit_price and unit_basis (`kg` / `l` / `each`), on_special, source_updated_on (when the source last refreshed, where it says). One row per ingredient, store, source and day: saving again that day overwrites it. A not found row (no acceptable match at that store) has product, pack, price and unit price null. You write these (Prices below); the app only reads them, through the view `ingredient_prices_latest` (each ingredient's latest row per store), and shows them on the shopping list. They are the price history: never delete them.
- `pantry_items`: household_id, ingredient_slug → `ingredients`, qty (null when nobody measured it), unit, location (`fridge` / `freezer` / `pantry`), best_before (date; null when nobody knows), note. What the household has at home, kept in the app's Pantry tab (the app fills best_before from the ingredient's `shelf_days`; **Used up** deletes a row). Read only for you: never write the pantry.
- `household_settings`, `households`, `household_members`, `household_invites`: read only for you. A household can have members besides the owner (`role = 'member'`, a partner who joined by invite); they use the app, and you still plan for the household and set `created_by` to the owner.

## Units and sections

The database rejects anything else.

- Units: `g, kg, ml, l, each, tsp, tbsp, bunch, tin`. Tins and packs by weight or volume (a 400 g tin of tomatoes is `400 g`).
- `tbsp` is the 20 ml Australian tablespoon and `tsp` is 5 ml, so 4 tsp make 1 tbsp. Use them that way everywhere: in ingredient amounts, in step text and when you answer a question about an amount.
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
   Every week has at least one Asian dinner, Chinese when one fits. While the household has fewer than about 50 recipes, every pair's choices include a new recipe (Pairs and choices below).
4. Keep each night's hands-on minutes (`active_mins` of its dishes, by the method each is cooked by, plus the `extra_mins` of their chosen extras) within that night's minutes: its own when the app set one ("only 20 minutes tonight"), else the weekday's `minutes` (the nights query gives the right one). Put long cooks on weekends. On a weeknight, when a recipe's usual way takes too long and it has a method for equipment the household has (the methods query below), plan it with that method (`method_id`, query below) and say so ("Beef ragù in the pressure cooker, 1 h 20"). Never pick a method whose equipment isn't in `settings.equipment`.
   On a night with time to spare (a weekend, say), you may choose a dish's extras (the extras query below) when they still fit the night's minutes, and say so ("Sat: Pork stir-fry, velvet the pork +5 min"). Leave extras alone on a locked night, and don't choose one the owner unticked unless asked.
5. Follow `mealRule`: with `veg+carb` every night covers a vegetable and a carb (from the main's `provides` or added sides); with `veg` just a vegetable; `off` no rule.
   When a main needs sides, prefer the ones the household actually cooks with it (the pairing query below: nights marked cooked in the last 26 weeks), then other sides that fill the gap. Pairings are worked out from the plan; there is nothing to save.
6. Respect `notes`. Plan leftovers within a pair (Pairs and choices below): cook a big ragù Sunday, eat it again Monday.
7. If `avoid` lists allergens, find the recipes containing them (query below). Plan one only if every ingredient bringing an avoided allergen gets a swap to an ingredient without it, and say so in the proposal ("Wonton noodle soup, egg noodles → rice noodles; check the label"). Otherwise leave it out. Save those swaps on the dish once the night is written (swap SQL below), then check the week (query below) returns nothing.
8. Servings are usually the recipe's `serves`; scale to the household.
9. Never change a locked night's dishes (the nights query) unless asked to by name: plan the other nights around it, and in the proposal say it is kept ("Wed: locked, kept"). Writing a night replaces its dishes, so skip locked nights.
10. Propose the plan as pairs with three choices each (Pairs and choices below) and wait for the owner's pick before writing, unless asked to just do it. Then write each night and say it's saved, and price the week's list (Prices below).

## Pairs and choices

Plan the week as pairs of nights, so the owner makes three choices instead of seven and food bought in bulk or cooked once does two dinners.

- **Nights:** Saturday is free (no dinner planned) unless the owner asks for it or `settings.freeNights` says otherwise; locked and cooked nights are kept. The open nights pair up in week order, two next to each other at a time: from a Saturday start, Sun–Mon, Tue–Wed, Thu–Fri. A night left without a partner (a kept night between, a Monday start's Sunday) is a single.
- **A pair is one of:**
  - **twice:** one dish both nights with different sides (a stew with mash, then with crusty bread and greens). Cook enough for both; the second night is about 10 minutes to reheat. For recipes tagged `leftovers-ok` or `freezes well`.
  - **remake:** a big cook (a roast, tag `makes-leftovers`), then a dish that uses its leftovers (fried rice, wraps, a pasta bake; tag `uses-leftovers`), eaten the next night or the one after. Raise the big cook's servings to cover it and say what to keep ("Keep 300 g of the chicken for Mon"). Until #91 links the two dishes, the list still shows the second dish's leftover ingredient (`cooked meat`): say in the proposal to mark it as already have. With no big cook that week, a `uses-leftovers` recipe gets a swap from `cooked meat` to raw meat (`chicken thigh`, with an amount) so the list buys it.
  - **shared:** two dishes that share meat or a pack the first doesn't use up (a 1 kg chicken thigh pack for a stir-fry and a traybake; the rest of the cream or coriander).
  - **separate:** two dishes, when nothing pairs well.
  The big cook goes on the night with more time. A shared protein is fine within a pair; across pairs, spread proteins and mix the kinds (not three stews).
- **Specials first:** before choosing, search WhichGrocer specials (`search_specials`, with a category) for the proteins and two or three key veg, about 4–6 credits, and favour recipes that use what's on special. Compare on unit price, not discount: a Woolworths special can still cost more than Aldi's everyday price. Skip this when credits are short (Prices below).
- **Three choices per pair:** 1 your top pick; 2 another of the household's recipes that fits the same nights; 3 a new recipe idea, one line, that fits the nights' minutes, the meal rule and the week's specials and avoids the proteins the other pairs use. Under about 50 recipes every pair gets a new idea; from about 50, two pairs a week do.
- **The proposal:** per pair, the three choices with each night's dishes (sides included), the kind, an estimated cost from cached prices, and what's on special. Then free and kept nights, and the votes followed. For example:

  > **Sun–Mon** (120, 45 min)
  > 1 Roast chicken + roast potatoes → Mon fried rice from the leftovers · ~$24 · chicken on special at Aldi
  > 2 Beef ragù + pappardelle → Mon ragù + crusty bread, green salad · ~$28
  > 3 *New:* Char siu pork + rice → Mon pork noodle soup · ~$22
  > **Sat:** free

  The owner replies `OK` for all the top picks, or picks (`Sun–Mon 3, Thu–Fri 2`). Recheck the week after a change (no recipe twice, proteins spread, an Asian dinner, minutes), then write it. A picked new idea is written up and saved as a recipe first (Recipes below), tags included.
- **Tags:** give recipes the tags pairs use when you save or are asked to tidy them: `leftovers-ok` (reheats well), `makes-leftovers` (a big cook worth scaling up), `uses-leftovers` (takes cooked meat or another leftover), and the cuisine (`chinese`, `thai`, `indian`…).

### The planner script

When the chat can run code, let a script do the filtering and scoring. It never touches the database or a connector: you run the queries, hand it the results, and save what the owner picks.

1. Fetch the scripts: `curl -sSfO https://raw.githubusercontent.com/ptra243/WhatsForDinner/master/claude/dinner-planner/scripts/plan_week.py` (and `choose_shop.py`). If GitHub can't be reached or code can't run, plan by hand with the same rules.
2. Run the planner query below ("Everything the planner needs"), save its `planner_input` value to `planner.json` as returned, and run `python3 plan_week.py planner.json --specials "pork shoulder,broccoli"` with the ingredient names you found on special (`--plan-saturday` if asked).
3. It prints each pair's top pick and an alternative (kind, method on a short night, estimated cost, specials) and a brief for the new idea. It only plans mains: add sides for the meal rule, check allergens and notes, write the new ideas, and change anything that looks wrong (two pasta nights in a row) before proposing.

## Where to shop

After pricing a week (Prices below), say where to shop.

- **Discounts:** the owner's household gets 5% off at Woolworths, and once a month a 10% Woolworths shop. Take 5% off the Woolworths total when comparing. When planning, ask if this is the month's 10% shop; if so, use 10% for that week and offer a stock-up (pantry staples, rice, sauces, meat to freeze) so the 10% covers more. #93 will move these to settings; until then use these defaults unless `notes` says otherwise.
- **One shop or two:** default to the cheapest single shop after discounts. Suggest splitting between two only when it saves more than $15, or when one shop lacks items the others have (Aldi often lacks international items).
- **Script:** save the items-to-price query's rows (after saving the prices) as `items.json` and run `python3 choose_shop.py items.json` (`--monthly` for the 10% shop). It counts packs to buy × pack price as the list does and prints the totals, the recommendation and what isn't found there.

## Plan around the pantry

When the owner asks to plan around the pantry ("Plan around my What's for Dinner pantry for the week of …"), rework that week's nights to use up what is at home, soonest best-before first (a bargain bought on special, say).

1. Read the pantry (query below: soonest best-before first, with the household's recipes that use each item), the week (read-a-week query) and its nights (nights query: cooked and locked).
2. Rework only nights not marked cooked, from today on: a night before today may have been cooked and not ticked. Leave cooked and locked nights as they are, and say they are kept.
3. Go through the pantry soonest best-before first: plan a recipe that uses the item on a night before its best-before (past it: say so and let the owner decide), with enough servings or a second night to use it up. Frozen items keep; plan them last unless asked. An item no recipe uses: say so, and offer to add a recipe for it.
4. Every other planning rule still holds (time, meal rule, votes, allergens, notes, no repeats).
5. Propose the reworked nights day by day, naming the pantry items each one uses and their best-before ("Tue: Lemongrass chicken, uses the chicken thigh (best before Wed)"), and what is left unused. Wait for approval, then write each changed night and price the week's list (Prices below).
6. Never write `pantry_items`: the household marks things used up in the app. The shopping list shows what is in the pantry, so there is nothing to subtract.

## Recipes

- From pasted text or a photo: check the recipe list first and reuse an existing recipe rather than duplicating it. Otherwise convert it to the schema: course, provides, active and total minutes, serves, spice, steps with `timer_mins` where a step involves waiting and a cue where done is a judgement (below), units from the list. Add any new ingredients, save, and summarise in two or three lines.
- Tablespoons: a recipe from the US, the UK, New Zealand or anywhere else that uses a 15 ml tablespoon is converted to 20 ml tablespoons when you add it, in the ingredients and in any step that names an amount. Multiply its tablespoons by 0.75 and write the result in whole and quarter tbsp, or tbsp plus tsp when that is easier to measure: 3 US tbsp → 2 tbsp + 1 tsp (save it as `2.25 tbsp`), 1 US tbsp → 3 tsp, 2 US tbsp → 1.5 tbsp, 4 US tbsp → 3 tbsp. Teaspoons are 5 ml everywhere, so leave them. An Australian recipe already uses 20 ml: leave it. When you can't tell where a recipe is from, ask. Say in your summary that you converted the tablespoons. Don't convert recipes already saved.
- Keep spoon measures of butter, flour, sugar, honey and the like as spoons when the recipe gives them that way; the app shows the grams beside them ("2 tbsp ≈ 40 g").
- When the recipe has steps it calls optional or worth it if there's time ("optionally velvet the beef", "for extra flavour, toast the spices first"), save each as an optional step (`optional`, `extra_mins`, a short `why`), and leave its minutes out of the recipe's active and total minutes. Link its ingredients like any step's, so an ingredient only it uses is bought only on the nights it is chosen. Name the optional steps in your summary.
- Every recipe has at least one or two optional extras, sides included. When the source has none, add your own: something that makes the dish better if there's time (marinate ahead, salt overnight, a quick sauce or gravy, a garnish or topping), placed where it belongs in the method. Its extra ingredients go in the recipe's ingredients, linked only to that step, so they're bought only when it's chosen.
- If only a link is given and you can't read it, ask for the text.
- Set `source` (the link, book or "Photo") and `created_by` to the owner's id. Leave `rating` null; the cook rates it in the app. `is_example` is false.
- When a recipe gives another way to cook it with a piece of equipment ("or 45 minutes in the pressure cooker"), save the usual way as the recipe and the other as a method (query below), named after the equipment, with its own active and total minutes and its full steps. Name the equipment as the household does in `settings.equipment` when it has it. The app doesn't edit methods; you add and change them.
- Link every step you write to the ingredients it uses (`recipe_step_ingredients`), a method's steps too: each ingredient on the step where it goes in, and again on any later step that adds more of it. A step that only waits, rests or serves uses nothing. Each way of cooking the recipe uses every ingredient at least once; check with the query below and fix the links (or ask) when one is left over.
- Write a cue (`cue`) for every step where "done" is a judgement: browning, softening, thickening, reducing, cooked through, tender, set. Say what the cook sees, feels or smells ("deep golden and crisp all over", "a knife slides in", "coats the back of a spoon"), not the time again; the timer already has that. A step with nothing to judge (chop, mix, rest, serve) gets no cue. A method's steps get them too.
- Write a tip (`tip`) only where a step has a well-known way of going wrong, and say what to do about it: "Soaking up the oil is normal; keep going, don't add more", "If they are still crunchy, give them 10 more minutes". One tip a step at most, and most steps have none; never a general cooking tip or a safety warning for its own sake. Cook mode leads a tip in with "If it looks wrong:" unless it starts with "If".
- Cues and tips are short, 140 characters at most, lower case to start for a cue (it follows "Done when:"), a full sentence for a tip. Null when there is none, never an empty string.
- When asked to add cues to the household's recipes ("add cues to my recipes", "say what done looks like"), find the ways of cooking with none (query below), read each recipe in full, and add cues and tips by these rules without changing the steps' text. Keep any already there. Reply with one line per recipe.
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
6. **Reply** with one compact comparison table (the only table this skill uses): a row per item with each store's price and $/kg (or $/L, each), `–` for not found; then each store's total and how many items it covers ("Aldi $121 · 20 of 24 items"), counting an item as packs to buy × the pack price, as the list does; then any match you rejected or weren't sure of, one line each; then where to shop (Where to shop above).
7. When the owner says a match is wrong ("Coles mince should be the 500 g pack"), search again and save the right one (the same day overwrites). The app can't correct a price itself.

## Style

Short, plain, phone-sized replies. Simple lists, no tables (except the price comparison above). No SQL in replies unless asked.

## Example SQL

Replace `<household_id>`, `<owner_id>`, `<week_start>` (the first day of the household's week, `yyyy-mm-dd`) and `<suggestion_id>` with real values. Each block is one call to `execute_sql`.

Weeks start on the household's `weekStartsOn` day (Monday when missing), and a week's nights run in order from it (from Saturday: Sat, Sun, Mon … Fri). A date's week, this one and the next:

```sql
select week_start_of('<household_id>', current_date) as this_week,
       week_start_of('<household_id>', current_date) + 7 as next_week;
```

Use it for "this week", "next week" or a date the owner names, never a Monday worked out by hand. Never change `weekStartsOn`: it is set in the app's settings.

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
order by (array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day) - extract(isodow from d.week_start)::int + 7) % 7, d.position;
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
order by (d.i - extract(isodow from '<week_start>'::date)::int + 7) % 7;
```

Everything the planner needs, as one JSON value (`planner_input`) to save as `planner.json` for the planner script (Pairs and choices above): the settings, how many recipes the household has, the week's nights in order (minutes, locked, cooked, what's planned), the mains (with the quickest method the household has the equipment for, the date each was last cooked, the week's 👍 and 👎, and ingredients as `[name, qty, unit]` without staples), and the mains' ingredients with section, pack and each store's latest `[unit price, per, special]`:

```sql
select jsonb_build_object(
  'week_start', '<week_start>'::date,
  'settings', coalesce((select s.settings from household_settings s where s.household_id = '<household_id>'), '{}'::jsonb),
  'recipe_count', (select count(*) from recipes r where r.household_id = '<household_id>'),
  'nights', (
    select jsonb_agg(jsonb_build_object(
             'day', d.day,
             'minutes', coalesce(n.minutes, (s.settings->'minutes'->>d.day)::int),
             'locked', coalesce(n.locked, false),
             'cooked', coalesce(n.cooked, false),
             'planned', array(select r.slug from meal_plan_dishes x join recipes r on r.id = x.recipe_id
                              where x.household_id = '<household_id>' and x.week_start = '<week_start>'
                                and x.day = d.day order by x.position))
           order by (d.i - extract(isodow from '<week_start>'::date)::int + 7) % 7)
    from unnest(array['mon','tue','wed','thu','fri','sat','sun']) with ordinality as d(day, i)
    left join household_settings s on s.household_id = '<household_id>'
    left join meal_plan_nights n on n.household_id = '<household_id>'
     and n.week_start = '<week_start>' and n.day = d.day),
  'recipes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', r.slug, 'name', r.name, 'provides', r.provides, 'serves', r.serves,
             'active_mins', r.active_mins, 'total_mins', r.total_mins, 'spice', r.spice,
             'rating', r.rating, 'tags', r.tags,
             -- The quickest way to cook it with equipment the household has.
             'best_method', (select jsonb_build_object('name', m.name, 'active_mins', m.active_mins, 'total_mins', m.total_mins)
                             from recipe_methods m
                             where m.recipe_id = r.id and (m.equipment is null or exists (
                               select 1 from household_settings s, jsonb_array_elements_text(coalesce(s.settings->'equipment', '[]')) e
                               where s.household_id = r.household_id and lower(trim(e)) = lower(trim(m.equipment))))
                             order by m.active_mins, m.total_mins limit 1),
             -- The date of the last night it was cooked.
             'last_cooked', (select max(d.week_start + (array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day)
                                                        - extract(isodow from d.week_start)::int + 7) % 7)
                             from meal_plan_dishes d
                             join meal_plan_nights n on n.household_id = d.household_id
                              and n.week_start = d.week_start and n.day = d.day and n.cooked
                             where d.recipe_id = r.id),
             'likes', (select count(*) from public.recipe_votes v where v.recipe_id = r.id and v.week_start = '<week_start>' and v.vote = 1),
             'dislikes', (select count(*) from public.recipe_votes v where v.recipe_id = r.id and v.week_start = '<week_start>' and v.vote = -1),
             -- [name, qty, unit], staples left out (as when pricing).
             'ingredients', (select coalesce(jsonb_agg(jsonb_build_array(i.name, ri.qty, ri.unit) order by ri.position), '[]'::jsonb)
                             from recipe_ingredients ri join ingredients i on i.slug = ri.ingredient_slug
                             where ri.recipe_id = r.id and i.section <> 'herbs and spices'
                               and i.name !~ '(^|\s)(oil|sauce|stock)$')
           ) order by r.name), '[]'::jsonb)
    from recipes r
    where r.household_id = '<household_id>' and r.course = 'main'),
  -- Each ingredient the mains use: section, pack, and each store's latest [unit price, per, special].
  'ingredients', (
    select coalesce(jsonb_object_agg(i.name, jsonb_build_object(
             'section', i.section, 'pack', case when i.pack_qty is null then null else jsonb_build_array(i.pack_qty, i.pack_unit) end,
             'prices', (select coalesce(jsonb_object_agg(l.store, jsonb_build_array(l.unit_price, l.unit_basis, l.on_special)), '{}'::jsonb)
                        from ingredient_prices_latest l
                        where l.household_id = '<household_id>' and l.ingredient_slug = i.slug and l.unit_price is not null))), '{}'::jsonb)
    from ingredients i
    where i.section <> 'herbs and spices' and i.name !~ '(^|\s)(oil|sauce|stock)$'
      and exists (select 1 from recipe_ingredients ri join recipes r on r.id = ri.recipe_id
                  where ri.ingredient_slug = i.slug and r.household_id = '<household_id>' and r.course = 'main'))
) as planner_input;
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
order by (array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day) - extract(isodow from d.week_start)::int + 7) % 7, d.position;
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
order by (array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day) - extract(isodow from d.week_start)::int + 7) % 7, d.position, s.position;
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

Then the recipe, its ingredients, its steps (an optional one with its extra minutes and why; a cue where done is a judgement, and a tip where it often goes wrong) and the ingredients each step uses (step position, ingredient position) in one statement (an unknown ingredient name fails it, so nothing is half-saved):

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
  insert into recipe_steps (recipe_id, position, text, timer_mins, optional, extra_mins, why, cue, tip)
  select r.id, v.position, v.text, v.timer_mins, v.optional, v.extra_mins, v.why, v.cue, v.tip
  from r, (values
    (0, 'Mix the chicken with the lemongrass, garlic and fish sauce.', null::integer, false, null::integer, '', null::text, null::text),
    (1, 'Marinate.', 15, true, 15, 'more flavour, more tender', null, null),
    (2, 'Fry in the oil in a hot pan until golden and cooked through.', 10, false, null, '',
     'golden outside, with no pink in the thickest piece',
     'If it sticks, leave it a minute longer; it lets go once it has browned.')
  ) as v(position, text, timer_mins, optional, extra_mins, why, cue, tip)
  returning id, position
)
insert into recipe_step_ingredients (step_id, recipe_ingredient_id)
select st.id, ing.id
from (values (0, 0), (0, 1), (0, 2), (0, 3), (2, 4)) as u(step, ingredient)
join st on st.position = u.step
join ing on ing.position = u.ingredient;
```

Add another method to a saved recipe, with its own times, steps (with their cues) and the ingredients each step uses (by name), in one statement (the recipe's ingredients are shared):

```sql
with m as (
  insert into recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
  select r.id, 'Pressure cooker', 'pressure cooker', 10, 25
  from recipes r where r.household_id = '<household_id>' and r.slug = 'red-lentil-dal'
  returning id, recipe_id
), st as (
  insert into recipe_steps (recipe_id, method_id, position, text, timer_mins, cue)
  select m.recipe_id, m.id, v.position, v.text, v.timer_mins, v.cue
  from m, (values
    (0, 'Soften the onion, garlic, ginger and spices on the sauté setting.', 5::integer, 'the onion is soft and see-through'),
    (1, 'Add the lentils, crushed tomato, coconut milk and 400 ml water. Cook on high pressure, then release quickly.', 8, null),
    (2, 'Stir in the spinach until wilted and season.', null, null)
  ) as v(position, text, timer_mins, cue)
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

The ways of cooking a recipe with no cue or tip on any step yet, step by step (for "add cues to my recipes"):

```sql
select r.slug, r.name, coalesce(m.name, 'Usual way') as method, s.position, s.text, s.timer_mins
from recipes r
join recipe_steps s on s.recipe_id = r.id
left join recipe_methods m on m.id = s.method_id
where r.household_id = '<household_id>'
  and not exists (select 1 from recipe_steps x
                  where x.recipe_id = r.id and x.method_id is not distinct from s.method_id
                    and (x.cue is not null or x.tip is not null))
order by r.name, m.name nulls first, s.position;
```

Add cues and tips to a saved recipe's steps, by method (null for the usual way) and step position; null leaves that one alone, and a cue or tip already there is kept:

```sql
update recipe_steps s
set cue = coalesce(s.cue, v.cue), tip = coalesce(s.tip, v.tip)
from recipes r
cross join (values
  (null::text, 0, 'the water is gone and steam holes dot the surface', 'If it is still wet, cover it again for 2 more minutes.'),
  (null, 1, 'the grains are tender and separate', null)
) as v(method, step, cue, tip)
left join recipe_methods m on m.recipe_id = r.id and m.name = v.method
where r.household_id = '<household_id>' and r.slug = 'steamed-rice'
  and s.recipe_id = r.id and s.method_id is not distinct from m.id and s.position = v.step;
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
order by (array_position(array['mon','tue','wed','thu','fri','sat','sun'], d.day) - extract(isodow from d.week_start)::int + 7) % 7, d.position;
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
