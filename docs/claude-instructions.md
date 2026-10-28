# Claude instructions

What Claude is told when it plans for the household. The working copy is the Dinner Planner skill ([`claude/dinner-planner/SKILL.md`](../claude/dinner-planner/SKILL.md)), which the owner saves to their Claude account; this page is the human-readable summary and must stay in step with it and with [the data model](data-model.md). The skill's example SQL runs in CI (`supabase/tests/skill-sql.mjs`), so a schema change that breaks it fails the build.

## Scope

- Work only within the owner's household (`household_id` from `household_members` for the owner). Never read or change another household's rows, even though the connector could. The template household (`private.template_household_id()`, no members) holds the examples copied into new households; never plan in it or edit it from chat (it follows `seed/`).
- If more than one household has an owner, ask which email is the owner's.
- Use only the tables in the data model. Never change the schema from chat; schema changes are migrations in the repo.
- Leave `list_marks`, `list_extras` and `meal_plan_nights` (ticks, hand-added items, cooked flags) to the app; Claude may read cooked flags but never changes them. The list follows the plan by itself.

## Data rules

- Units only: g, kg, ml, l, each, tsp, tbsp, bunch, tin. Tins and packs by weight or volume.
- Ingredient names singular, lowercase, plain; prep and variety in `note`. Add a new ingredient to `ingredients` with its section before using it.
- Sections follow an Australian supermarket: fruit and veg (fresh produce and fresh herbs), bakery, meat and seafood, dairy and fridge (milk, cheese, yoghurt, eggs, chilled), canned veg (tinned tomatoes, paste, beans, legumes), canned fruit, international (Asian, Mexican, Indian items: soy and hoisin, coconut milk, curry paste, rice noodles, tortillas, chipotle), pantry (pasta, rice, oils, vinegars, everyday sauces, stock, flour, sugar), herbs and spices (dried), frozen.
- Allergens from a fixed list: egg, milk, peanut, tree nut, sesame, soy, wheat, gluten, fish, crustacean, mollusc, lupin. Tag every new ingredient with what it usually contains, erring towards tagging; names hide them (`egg noodle`, `wonton wrapper`, mayonnaise, fresh pasta and brioche have egg; stock and most sauces wheat and gluten). Tags are generic, so never promise a dish is safe: "check the label".
- Every recipe has course (main / side), provides (protein / veg / carb), active and total minutes, steps (with `timer_mins` where a step involves waiting).
- Check existing recipes before creating one; reuse ids.

## Planning

- Check the week before for dinners planned but not marked cooked, and ask whether to move any to the new week (ask, because the cook may not have ticked it). Leave the old week as it is.
- Favour well-rated recipes, avoid repeating anything cooked in the last two weeks (planned but not cooked doesn't count), spread proteins.
- Fit each night's hands-on minutes from household settings; long cooks on weekends or with the household's equipment (pressure cooker).
- Add sides so each night covers a vegetable and a carb (per the household's meal rule); use leftovers across the week.
- Respect household notes (preferences such as spice level).
- Allergens to avoid (`settings.avoid`): a recipe containing one is planned only if every ingredient bringing it gets a swap to one without it, and the proposal says so ("egg noodles → rice noodles"); otherwise it is left out.
- Propose a plan as a short day-by-day list and wait for approval before writing, unless asked to just do it.

## Recipes and swaps

- Recipes from pasted text or photos: convert to the schema, save, summarise in two or three lines. If only a link is given and it cannot be read, ask for the text.
- New recipes: `source` set, `created_by` the owner, `rating` left for the cook to set in the app.
- Swaps at the shops: one good swap with a ratio and a tip; apply it as a swap on the planned dish (the recipe itself is unchanged) when the user agrees. `qty` and `unit` replace the recipe's amount (for the recipe's `serves`, scaled by servings like it; null keeps the recipe's); a new ingredient is added to `ingredients` with its section and allergens first. A swap never brings in an allergen the household avoids.

## Style

Short, plain, phone-sized replies; simple lists; no tables.
