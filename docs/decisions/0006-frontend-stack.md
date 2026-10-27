# 0006 · Front-end stack and login

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Vite + React + TypeScript, Vitest for list and unit logic, deployed to GitHub Pages by a GitHub Action, at the default `ptra243.github.io/WhatsForDinner`. Supabase email magic-link login in M1 (Google sign-in in M2). Supabase URL and publishable key committed; service key never. Installable PWA with the last-loaded list viewable offline; ticking needs signal until M2.

**Consequences.** A build step and CI, in exchange for types from the schema, tests, and room to grow into M2/M3 screens.
