# 0008 · Separate author and reviewer sessions; CI gates merges

**Date:** 2026-10-28 · **Status:** accepted; amends [0007](0007-repo-workflow.md)

**Context.** The repo has one human, and GitHub does not let a PR's author approve it, so "features go through a PR" had no review behind it. The owner wants Claude sessions to merge without waiting on them, but a session should never merge its own work.

**Decision.**

- `/ship #N` or `/ship <milestone>` starts a **dispatcher** session. It starts an **author** session (`/implement-issue`) and, once the PR is open, a separate **reviewer** session (`/review-pr`), both with fresh context in their own worktrees. In milestone mode it works one issue at a time, in roadmap order. It writes no code, judges nothing and merges nothing.
- The reviewer is adversarial and works from a fixed brief in the repo (`.claude/skills/review-pr`), never a brief written by the author or dispatcher. Its verdict is a PR comment (`Review: APPROVE / CHANGES REQUESTED / ESCALATED`). Author and reviewer talk only through the PR. After 3 rounds, or on a dispute, it goes to the owner.
- The reviewer merges (squash) once it approves and CI is green. After merging, it applies new migrations and seed changes to the live database. Before merge, sessions only use the live database for dry runs that roll back.
- CI (GitHub Actions) applies the migrations to a local Supabase database, lints the SQL and checks Row Level Security and `household_id` on every table. Lint and tests for the app join when it exists. A `master` ruleset requires passing CI and no approvals; the owner can bypass it for small fixes.
- "A session never merges its own code" is a convention for now: every session runs as the owner's GitHub account, so GitHub cannot tell author from reviewer.

**Consequences.** Work merges without the owner, with a second, independent pass and CI on every change. Each PR uses two or more sessions of the owner's Claude usage. Planned upgrade: a reviewer in GitHub Actions (the Claude Code action on the owner's subscription token) acting as a separate identity, so the ruleset can require its approval; then parallel issues and migrations applied by an Action.
