# What's for Dinner — notes for Claude sessions

Read `docs/` before changing anything: `vision.md`, `architecture.md`, `data-model.md`, `roadmap.md`, `decisions/`.

## Workflow

- The repo is the source of truth. Tickets are GitHub Issues (milestones M1 · Real use, M2 · Household, M3 · Other households, Later). Use the REST API (`gh api repos/ptra243/WhatsForDinner/...`); GraphQL is not available here.
- Small fixes may go straight to `master`; features go on a branch with a PR that references its issue.
- Schema changes are new numbered files in `supabase/migrations/`. Update `docs/data-model.md`, `docs/claude-instructions.md` and the skill in the same change.
- Add a decision record in `docs/decisions/` when a settled decision changes.

## Hard rules

- Never commit the Supabase service (secret) key or the database password. The project URL and publishable key are fine to commit.
- Every household-owned table has `household_id` and Row Level Security.
- Units and sections are fixed lists enforced by the database; keep code, skill and docs in step with them.
- Do not drive claude.ai from scripts or route other people's requests through the owner's subscription (see `docs/architecture.md`).

## Prototype

`app/dinner-planner.html` is the v1 Claude-hosted prototype, published to https://claude.ai/artifact/DkAY7CjiQxYSsiBbVg4Q1S. It is retired at the end of M1; do not add features to it.
