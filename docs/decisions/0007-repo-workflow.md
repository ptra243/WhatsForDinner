# 0007 · Repo workflow

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** The repo is the source of truth. Docs live in `docs/` (vision, architecture, data model, roadmap, decision records, Claude instructions); the earlier Claude Doc plan is superseded. Tickets are GitHub Issues with milestones (M1 · Real use, M2 · Household, M3 · Other households, Later) and labels (feature, bug, chore, docs, area:*). M1 tickets are fully written; later ones are placeholders. Small fixes go to `master`; features go through a branch and PR. Schema changes are numbered migrations in `supabase/migrations/`.
