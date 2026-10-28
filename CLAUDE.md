# What's for Dinner — notes for Claude sessions

Read `docs/` before changing anything: `vision.md`, `architecture.md`, `data-model.md`, `roadmap.md`, `decisions/`.

## Workflow

- The repo is the source of truth. Tickets are GitHub Issues (milestones M1 · Real use, M2 · Household, M3 · Other households, Later). Use the REST API (`gh api repos/ptra243/WhatsForDinner/...`); GraphQL is not available here.
- Small fixes may go straight to `master`; features go on a branch with a PR that references its issue.
- Issues are worked through `/ship #N` (or `/ship M1`): a dispatcher starts an author session (`/implement-issue`) and a separate reviewer (`/review-pr`), which merges once it approves and CI is green. A session never merges a PR it wrote. Milestones run in waves of up to 3 issues, and authors and reviewers use changed screens in a browser. See decisions 0008 and 0009.
- Before merge, the live database is for dry runs that roll back; the reviewer applies migrations and seed changes after merging.
- Schema changes are new numbered files in `supabase/migrations/`. Update `docs/data-model.md`, `docs/claude-instructions.md`, the skill and `web/src/lib/database.types.ts` (`npm run gen:types` in `web/`) in the same change.
- Add a decision record in `docs/decisions/` when a settled decision changes.

## Hard rules

- Never commit the Supabase service (secret) key or the database password. The project URL and publishable key are fine to commit.
- Every household-owned table has `household_id` and Row Level Security.
- Units and sections are fixed lists enforced by the database; keep code, skill and docs in step with them.
- Do not drive claude.ai from scripts or route other people's requests through the owner's subscription (see `docs/architecture.md`).

## Prototype

The v1 Claude-hosted prototype is retired. Its link, https://claude.ai/artifact/DkAY7CjiQxYSsiBbVg4Q1S, shows `prototype/moved.html`, a note pointing to the app. The old page is kept in `prototype/dinner-planner.html` for reference; do not change it or publish it again.
