# 0005 · Plan in Claude chat with a skill

**Date:** 2026-10-28 · **Status:** accepted

**Context.** Options were plain Claude chat with a skill, or a separate Claude-hosted planner page.

**Decision.** Planning, adding recipes and swaps happen in Claude chat using a Dinner Planner skill (source in `claude/dinner-planner/SKILL.md`) and the Supabase connector. The app's Ask Claude buttons open claude.ai with a prefilled prompt; if the prefill does not carry over on the phone, they copy the prompt instead.

**Consequences.** Nothing extra to build or host for AI, works on any device with Claude, stays within the terms (the owner using Claude's own features). One tap out to Claude and back. A dedicated planner page can be added later if the hand-off feels clunky.
