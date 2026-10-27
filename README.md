# What's for Dinner

A household dinner planner: plan the week's dinners, shop from one combined list grouped by supermarket section, cook step by step, and ask Claude to plan weeks, add recipes or suggest swaps.

## Where it runs

v1 is a Claude-hosted app (a claude.ai artifact). It calls Claude on the viewer's own Claude subscription and stores data in the artifact's built-in database.

- Live app: https://claude.ai/artifact/DkAY7CjiQxYSsiBbVg4Q1S (private to the owner)
- Design canvas (flows and theme directions): https://claude.ai/artifact/YTiV4wYFV5LzvxjRKFNXpm
- Plan doc: https://claude.ai/artifact/PvsCAYYfGGFVwm4Zj69FsU

## Layout

| Path | What it is |
| --- | --- |
| `app/dinner-planner.html` | The whole app: one self-contained page (HTML, CSS, vanilla JS). Published to the live app link above. |
| `seed/` | Example data loaded into the app's database: `recipes/<id>.json`, `meta/ingredients.json` (ingredient → supermarket section), `meta/household.json` (settings), `plans/<weekStart>.json`. |

## Data model (as built)

Documents in the artifact database:

- `recipes/<id>`: name, course (main / side), serves, activeMins, totalMins, provides (protein / veg / carb), spice, tags, source, ingredients `[{name, qty, unit, note}]`, steps `[{text, timerMins}]`, rating, notes, example.
- `plans/<weekStart>` (a Monday, `YYYY-MM-DD`): `nights.{mon..sun} = {dishes:[{recipeId, role, servings, swaps:[{from,to,qty,unit}]}], cooked, skipCheck}`.
- `lists/<weekStart>`: only what the shopper did — `marks{itemKey: {ticked, bought, boughtUnit, status, haveIt}}` and hand-added `extras[]`. The items themselves are derived live from the plan and recipes.
- `meta/ingredients`: `items{slug: {name, aisle}}`.
- `meta/household`: notes, dinnerTime, minutes per weekday, equipment, mealRule.

Units are limited to g, kg, ml, l, each, tsp, tbsp, bunch, tin. Ingredient names are singular and lowercase.

## Real data lives in the app, not here

Recipes and plans you add in the app stay in its database. Nothing personal is committed to this repo.
