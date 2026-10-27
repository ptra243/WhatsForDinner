# Vision

What's for Dinner plans a household's weekly dinners, turns the plan into one shopping list grouped the way an Australian supermarket is laid out, and makes cooking from the plan easy on a phone. Claude does the thinking (planning, new recipes, swaps); the app does the everyday doing (looking, ticking, cooking).

## Who it's for

| Who | When | What they do |
| --- | --- | --- |
| Owner (M1) | Weekly planning, shopping, cooking | Plans with Claude, shops from the list, cooks from recipes |
| Partner (M2) | Shopping, cooking, voting | Uses the app with their own login; suggests dinners and votes |
| Other households (M3) | Their own weeks | Same app, fully separate data; their own AI via an import box |

## What it does

- **Plan:** a week of dinners, each night a main plus sides, with every night covering a vegetable and a carb, fitting the time available that night, and using what is already in the house.
- **Shop:** one list derived from the plan, amounts added up across recipes, grouped by supermarket section, ticked live; record what was actually bought; flag what could not be found and ask Claude for a swap.
- **Cook:** recipe view with a servings scaler, one-step-per-screen cook mode with timers, rating and notes afterwards.
- **Ask Claude:** planning, adding recipes from text or photos, swaps and changes happen in Claude chat on the owner's subscription, writing to the same database.

## What it does not do

- It is not a recipe website or social app; recipes are the household's own.
- It does not order groceries or track prices (maybe later).
- In-app AI for people other than the owner is not on the owner's subscription; others bring their own AI (see [architecture](architecture.md#claude-and-the-terms-of-use)).

## Principles

- **The schema protects the data.** Fixed units, one spelling per ingredient, every ingredient has a section; enforced by the database, because Claude writes with admin rights.
- **Derived, not duplicated.** The shopping list is calculated from the plan; only what the shopper did is stored.
- **Build what is painful to retrofit now** (households, user ids, ingredient references), defer what is additive.
- **Use it before polishing it.** Real weeks of dinners decide the order of later work.
