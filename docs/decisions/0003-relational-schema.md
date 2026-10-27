# 0003 · Relational schema with database-enforced rules

**Date:** 2026-10-28 · **Status:** accepted

**Context.** Claude writes through the connector with admin rights, bypassing the app's validation. Document-style recipes (ingredients as JSON) would be quicker to port but leave the rules to code.

**Decision.** Recipes, recipe ingredients, steps, the ingredient/section list and planned dishes are relational tables with check constraints (units, sections, Monday week starts) and foreign keys. JSON only for small self-contained values: swaps on a planned dish, household settings.

**Consequences.** Bad data (wrong units, unknown recipes, ingredients without a section) is rejected by the database whoever writes it. Queries like "recipes using coriander" are plain SQL. Slightly more porting work.
