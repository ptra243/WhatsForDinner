# 0001 · Build v1 as a Claude-hosted prototype first

**Date:** 2026-10-27 · **Status:** accepted; superseded for the long term by [0002](0002-supabase-early-hybrid.md)

**Context.** We wanted to try the planner quickly, with an in-app chat that runs on the owner's Claude subscription.

**Decision.** v1 is a single-page Claude artifact (Week, List, Recipes, Ask tabs) using the artifact's built-in database and calling Claude through the page's sample capability with tools.

**Consequences.** Zero setup and free AI for the owner, but it only lives at a claude.ai link, data sits in the artifact's store, and anyone else needs a Claude account. It stays running until the M1 app ships, then it is retired (no real data to migrate).
