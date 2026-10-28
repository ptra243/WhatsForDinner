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
| `web/` | The app: Vite + React + TypeScript, deployed to GitHub Pages from `master` |
| `app/dinner-planner.html` | v1 prototype (retired at the end of M1) |
| `seed/` | Example recipes, ingredient sections and a sample week, loaded as starting data |
| `supabase/migrations/` | Database schema (schema of record) |
| `supabase/seed/` | `seed.sql` loads `seed/` into the template household that new households copy; rebuild it with `node supabase/seed/build.mjs` |
| `docs/` | Project docs and decision records |
| `supabase/` | Migrations, CI checks (`tests/`) and local Supabase config |
| `.claude/skills/` | `/ship`, `/implement-issue`, `/review-pr`: the issue workflow (decision 0008) |

Real recipes and plans live in the database, not in this repo.

## Working on the app

In `web/`: `npm install`, then `npm run dev` (also the `web` entry in `.claude/launch.json`), `npm test`, `npm run lint`, `npm run build`. After a schema change, start the local database (`npx supabase db start --workdir ..`) and run `npm run gen:types` to regenerate `src/lib/database.types.ts`; CI fails while it is out of date. The site is https://ptra243.github.io/WhatsForDinner/.

To sign in locally, run the whole local stack (`npx supabase start --workdir ..`, needs Docker), load the examples (run `supabase/seed/seed.sql` against the local database), and copy `.env.example` to `.env.local` with the local publishable key from `npx supabase status --workdir ..`. Magic links land in the local inbox (Mailpit) at http://127.0.0.1:54324. Never create test users on the live project.
