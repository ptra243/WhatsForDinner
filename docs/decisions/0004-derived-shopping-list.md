# 0004 · Derive the shopping list

**Date:** 2026-10-28 · **Status:** accepted

**Context.** A stored list has to be rebuilt whenever the plan, servings, swaps or recipes change, and can go stale.

**Decision.** The list is calculated live from the plan and recipes. Only shopper actions are stored: ticks, amount bought, couldn't get, already have (`list_marks`, keyed by `name|unit`) and hand-added items (`list_extras`).

**Consequences.** The list can never be out of date and Claude never needs to rebuild it. A mark whose item disappears (plan changed) is simply ignored. The derivation is pure code with unit tests.
