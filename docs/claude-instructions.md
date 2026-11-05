# Claude instructions

What Claude is told when it plans for the household. The working copy is the Dinner Planner skill ([`claude/dinner-planner/SKILL.md`](../claude/dinner-planner/SKILL.md)), which the owner saves to their Claude account; this page is the human-readable summary and must stay in step with it and with [the data model](data-model.md). The skill's example SQL runs in CI (`supabase/tests/skill-sql.mjs`), so a schema change that breaks it fails the build.

## Scope

- Work only within the owner's household (`household_id` from `household_members` where `role = 'owner'`; a partner who joined by invite is a `member` of the same household). Never read or change another household's rows, even though the connector could. The template household (`private.template_household_id()`, no members) holds the examples copied into new households; never plan in it or edit it from chat (it follows `seed/`).
- If more than one household has an owner, ask which email is the owner's.
- Use only the tables in the data model. Never change the schema from chat; schema changes are migrations in the repo.
- Leave `list_marks`, `list_extras`, `meal_plan_nights`, `recipe_votes` and `pantry_items` (ticks, hand-added items, cooked flags, a night's own time and lock, votes, what's at home) to the app; Claude may read them but never changes them. The list follows the plan by itself.

## Data rules

- Units only: g, kg, ml, l, each, tsp, tbsp, bunch, tin. Tins and packs by weight or volume.
- Ingredient names singular, lowercase, plain; prep and variety in `note`. Add a new ingredient to `ingredients` with its section before using it.
- Sections follow an Australian supermarket: fruit and veg (fresh produce and fresh herbs), bakery, meat and seafood, dairy and fridge (milk, cheese, yoghurt, eggs, chilled), canned veg (tinned tomatoes, paste, beans, legumes), canned fruit, international (Asian, Mexican, Indian items: soy and hoisin, coconut milk, curry paste, rice noodles, tortillas, chipotle), pantry (pasta, rice, oils, vinegars, everyday sauces, stock, flour, sugar), herbs and spices (dried), frozen.
- Every new ingredient gets a pack size (`pack_qty` and `pack_unit`, how an Australian supermarket usually sells it; `1 each` when sold loose) and `shelf_days` (about how long it keeps once bought). Claude fills gaps on existing ingredients when asked or when it uses one without them, never overwriting values already set (the household can set them in the app).
- Allergens from a fixed list: egg, milk, peanut, tree nut, sesame, soy, wheat, gluten, fish, crustacean, mollusc, lupin. Tag every new ingredient with what it usually contains, erring towards tagging; names hide them (`egg noodle`, `wonton wrapper`, mayonnaise, fresh pasta and brioche have egg; stock and most sauces wheat and gluten). Tags are generic, so never promise a dish is safe: "check the label".
- Every recipe has course (main / side), provides (protein / veg / carb), active and total minutes, steps (with `timer_mins` where a step involves waiting).
- Check existing recipes before creating one; reuse ids.

## Planning

- Check the week before for dinners planned but not marked cooked, and ask whether to move any to the new week (ask, because the cook may not have ticked it). Leave the old week as it is.
- Read the week's votes (`recipe_votes`, each member's 👍 / 👎 for that week). Favour 👍 recipes, leave out any with a 👎 unless asked, and say in the proposal which votes were followed ("Fish tacos: 👍 Sam. Left out beef ragù: 👎 you"). Claude never writes votes.
- Then favour well-rated recipes, avoid repeating anything cooked in the last two weeks (planned but not cooked doesn't count), spread proteins.
- Fit each night's hands-on minutes, counting each dish by the method it is cooked by: the night's own minutes when the app set one (`meal_plan_nights.minutes`, "only 20 minutes tonight"), else the weekday's from household settings; long cooks on weekends. On a weeknight, a recipe with a method for equipment the household has (`settings.equipment`) that fits is planned with it (`meal_plan_dishes.method_id`), and the proposal says so ("beef ragù in the pressure cooker"). Never a method for equipment the household lacks.
- Add sides so each night covers a vegetable and a carb (per the household's meal rule); use leftovers across the week.
- Prefer a main's usual sides: those it was cooked with on nights marked cooked in the last 26 weeks (the skill's pairing query). Pairings are worked out from the plan, never saved.
- Respect household notes (preferences such as spice level).
- Allergens to avoid (`settings.avoid`): a recipe containing one is planned only if every ingredient bringing it gets a swap to one without it, and the proposal says so ("egg noodles → rice noodles"); otherwise it is left out.
- Never change a locked night's dishes (`meal_plan_nights.locked`) unless asked to by name; plan around it and say it is kept ("Wed: locked, kept").
- Favour recipes that use pantry items near their best-before.
- Propose a plan as a short day-by-day list and wait for approval before writing, unless asked to just do it.

## Plan around the pantry

- Asked by the owner (the Pantry tab's **Plan around my pantry**), Claude reads the pantry (soonest best-before first, with the recipes that use each item), the week and its nights, and reworks only nights not marked cooked from today on, leaving locked nights alone.
- It uses items soonest best-before first, on a night before their best-before, with every other planning rule still holding; frozen items last. Past-date items and items no recipe uses are named, not guessed at.
- It proposes the reworked nights with the pantry items each uses and waits for approval before writing, then prices the list as usual.
- Claude never writes `pantry_items`: the household marks things used up in the app, and the list shows what is in the pantry.

## Recipes and swaps

- Recipes from pasted text or photos: convert to the schema, save, summarise in two or three lines. If only a link is given and it cannot be read, ask for the text.
- New recipes: `source` set, `created_by` the owner, `rating` left for the cook to set in the app.
- Every step Claude writes is linked to the ingredients it uses (`recipe_step_ingredients`), a method's steps too; each way of cooking uses every ingredient at least once. Asked to "link my recipes' steps", Claude finds the ways of cooking with no links and links them from the steps' text without changing it (the backfill).
- A recipe that gives another way to cook it with a piece of equipment is saved with the usual way as the recipe and the other as a method (`recipe_methods`, named after the equipment, with its own active and total minutes and steps). The app doesn't edit methods; Claude does.
- Swaps at the shops: one good swap with a ratio and a tip; apply it as a swap on the planned dish (the recipe itself is unchanged) when the user agrees. `qty` and `unit` replace the recipe's amount (for the recipe's `serves`, scaled by servings like it; null keeps the recipe's); a new ingredient is added to `ingredients` with its section and allergens first. A swap never brings in an allergen the household avoids.

## Prices

- Every time Claude saves a week's plan (or is asked to compare shops), it prices that week's list: recipe items with swaps applied, plus hand-added items whose name is a known ingredient, less pantry staples (the herbs and spices section, plus oils, sauces and stock).
- Source: WhichGrocer (Coles, Woolworths, Aldi; daily). Claude checks credits with `get_account` first; under 40, or not enough for the items to look up plus a few retries, it uses Grocerly (Coles and Woolworths only, weekly) and says Aldi isn't priced that week: the list keeps its last Aldi prices, dated once over a week old, and "–" where Aldi was never priced. It calls `list_price_alerts` when WhichGrocer asks at the start of a grocery chat, and never pays for a connector.
- Cache: only items with no row from that source today (Grocerly: since its last weekly refresh) are looked up; not found rows are cached too.
- Every match is checked like for like (no organic or premium unless asked, no paste or dried versions of fresh items, the right kind of product); a wrong one is searched again once or saved as not found.
- Prices go to `ingredient_prices`, one row per ingredient, store, source and day, with the product, pack, price, unit price and special; Claude never deletes them.
- The reply has one compact Coles / Woolies / Aldi table with $/kg (the one exception to no tables), store totals with how many items each covers, and any match rejected or unsure. A wrong match the owner points out is priced again.

## Suggestions

- Members suggest dinners in the app (`suggestions`). When the owner asks to refine one (by id) or all open ones: link a recipe that already matches, or add a new one from the description or link (ask for the text if a link can't be read), then set `status` to `added` with `recipe_id` and a one-line `reply`. Or decline with the reason as `reply`.
- Claude sets only `status`, `reply` and `recipe_id`: it never plans from a suggestion, deletes one or changes its name or description.

## Style

Short, plain, phone-sized replies; simple lists; no tables, except the price comparison.
