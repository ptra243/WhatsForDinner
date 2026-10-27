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

Partner's login and household invite, votes, suggestions (and the "check suggestions" skill flow), pantry with best-before and replanning around bargains, full offline ticking, hand-entry recipe form, Google sign-in, side-dish pairings, equipment method variants and per-night time overrides.

## M3 · Other households

Multiple households in practice, AI import box (copy prompt, paste JSON, validate), barcode scan for pantry, copying recipes between households, in-app pairing and substitutes.

## Later

Nightly suggestions scheduled task, keep-awake ping for the free tier, in-app AI via an API proxy, a custom connector for other people's AIs, custom domain.
