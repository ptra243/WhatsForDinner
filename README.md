# What's for Dinner

A household dinner planner: plan the week's dinners with Claude, shop from one list grouped by supermarket section, and cook step by step on your phone.

- **Docs:** [vision](docs/vision.md) · [architecture](docs/architecture.md) · [data model](docs/data-model.md) · [roadmap](docs/roadmap.md) · [decisions](docs/decisions/README.md) · [Claude instructions](docs/claude-instructions.md)
- **Tickets:** GitHub Issues, grouped by milestone

## Status

M1 is in progress: a React app on GitHub Pages backed by Supabase, with planning in Claude chat. Until it ships, the working prototype is a Claude-hosted page:

- Prototype: https://claude.ai/artifact/DkAY7CjiQxYSsiBbVg4Q1S (private to the owner), source `app/dinner-planner.html`
- Design canvas (flows and themes): https://claude.ai/artifact/YTiV4wYFV5LzvxjRKFNXpm

## Layout

| Path | What it is |
| --- | --- |
| `app/dinner-planner.html` | v1 prototype (retired at the end of M1) |
| `seed/` | Example recipes, ingredient sections and a sample week, loaded as starting data |
| `supabase/migrations/` | Database schema (schema of record) |
| `supabase/seed/` | `seed.sql` loads `seed/` into the owner household; rebuild it with `node supabase/seed/build.mjs` |
| `docs/` | Project docs and decision records |
| `supabase/` | Migrations, CI checks (`tests/`) and local Supabase config |
| `.claude/skills/` | `/ship`, `/implement-issue`, `/review-pr`: the issue workflow (decision 0008) |

Real recipes and plans live in the database, not in this repo.
