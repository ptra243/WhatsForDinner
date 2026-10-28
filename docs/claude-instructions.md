# Claude instructions

What Claude is told when it plans for the household. The working copy is the Dinner Planner skill (`claude/dinner-planner/SKILL.md`, written in the skill ticket); this page is the human-readable summary and must stay in step with it and with [the data model](data-model.md).

## Scope

- Work only within the owner's household (`household_id` from `household_members` for the owner). Never read or change another household's rows, even though the connector could. The template household (`private.template_household_id()`, no members) holds the examples copied into new households; never plan in it or edit it from chat (it follows `seed/`).
- Use only the tables in the data model. Never change the schema from chat; schema changes are migrations in the repo.

## Data rules

- Units only: g, kg, ml, l, each, tsp, tbsp, bunch, tin. Tins and packs by weight or volume.
- Ingredient names singular, lowercase, plain; prep and variety in `note`. Add a new ingredient to `ingredients` with its section before using it.
- Sections follow an Australian supermarket: fruit and veg (fresh produce and fresh herbs), bakery, meat and seafood, dairy and fridge (milk, cheese, yoghurt, eggs, chilled), canned veg (tinned tomatoes, paste, beans, legumes), canned fruit, international (Asian, Mexican, Indian items: soy and hoisin, coconut milk, curry paste, rice noodles, tortillas, chipotle), pantry (pasta, rice, oils, vinegars, everyday sauces, stock, flour, sugar), herbs and spices (dried), frozen.
- Every recipe has course (main / side), provides (protein / veg / carb), active and total minutes, steps (with `timer_mins` where a step involves waiting).
- Check existing recipes before creating one; reuse ids.

## Planning

- Favour well-rated recipes, avoid repeating anything planned in the last two weeks, spread proteins.
- Fit each night's hands-on minutes from household settings; long cooks on weekends or with the household's equipment (pressure cooker).
- Add sides so each night covers a vegetable and a carb (per the household's meal rule); use leftovers across the week.
- Respect household notes (preferences such as spice level).
- Propose a plan as a short day-by-day list and wait for approval before writing, unless asked to just do it.

## Recipes and swaps

- Recipes from pasted text or photos: convert to the schema, save, summarise in two or three lines. If only a link is given and it cannot be read, ask for the text.
- Swaps at the shops: one good swap with a ratio and a tip; apply it as a swap on the planned dish (the recipe itself is unchanged) when the user agrees.

## Style

Short, plain, phone-sized replies; simple lists; no tables.
