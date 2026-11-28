# Roadmap

Milestones match GitHub milestones. Each phase works on its own before the next starts; real use decides the order after M1.

## M1 · Real use (owner only)

Goal: the owner plans, shops and cooks real weeks from the new app, with Claude planning through the skill.

Build order:

1. Docs, decision records, `CLAUDE.md`
2. Supabase project, first migration, Row Level Security, seed data
3. Vite + React + TypeScript scaffold, recipe-card theme, GitHub Pages deploy
4. Magic-link login and household setup
5. Recipes and cook mode
6. Week
7. Shopping list
8. Settings, export, clear examples
9. Dinner Planner skill and Ask Claude hand-off, tested end to end on the owner's phone
10. Installable app, list viewable offline
11. Retire the Claude-hosted prototype

## M2 · Household

Partner's login and household invite, votes, suggestions (and the "check suggestions" skill flow), pantry with best-before and replanning around bargains, full offline ticking, hand-entry recipe form, Google sign-in, side-dish pairings, equipment method variants, per-night time overrides, and shopping list prices from Coles, Woolworths and Aldi (priced by Claude through grocery price connectors, with price history).

## M2.5 · Everyday use

Goal: smoother weeks for the owner using the app alone, before anyone else joins. Chosen from three weeks of real use: dinners rarely got marked cooked, the household's own recipes had no ratings, and the pantry and prices were empty.

- **Close the loop:** a morning-after check-in (cooked, rating, note), one sheet to add a shop's leftovers to the pantry, and finding out why no prices were saved.
- **Shop:** which recipe each item is for.
- **Cook:** step cues and fixes, grams beside spoon measures, rescaling mid-cook, a back button that closes screens.
- **Plan:** leftovers (lunch serves and planned-overs), settings for store discounts, free nights and splitting the shop, and the nightly suggestions task.
- **Keep it running:** the keep-awake ping for the free tier.

What is left of M2 (partner login in practice, Google sign-in, the veg add-in, cooking with what's on hand) waits until after this.

## M3 · Other households

Multiple households in practice, AI import box (copy prompt, paste JSON, validate), barcode scan for pantry, copying recipes between households, in-app pairing and substitutes.

## Later

In-app AI via an API proxy, a custom connector for other people's AIs, custom domain.
