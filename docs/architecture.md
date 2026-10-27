# Architecture

```mermaid
flowchart LR
  Phone["Owner's phone"] -->|everyday use| App["GitHub Pages app<br/>Vite + React + TS"]
  Phone -->|planning chat| Claude["Claude chat<br/>Dinner Planner skill"]
  App -->|supabase-js, publishable key,<br/>login + Row Level Security| DB[("Supabase Postgres<br/>Singapore")]
  Claude -->|Supabase connector<br/>(admin, owner only)| DB
  App -->|Ask Claude buttons:<br/>prefilled claude.ai link| Claude
```

## Pieces

| Piece | What it is | Notes |
| --- | --- | --- |
| Everyday app | Static React app on GitHub Pages at `ptra243.github.io/WhatsForDinner`, deployed by a GitHub Action on push to `master` | Installable (PWA); last-loaded list viewable offline |
| Database | Supabase Postgres (free tier, Singapore region; project ref `fckheksaemriadvrveoj`) with Auth (email magic link) | Schema as migrations in `supabase/migrations/` |
| Planning | Claude chat (any device) with the Dinner Planner skill and the Supabase connector | Skill source in `claude/dinner-planner/SKILL.md` |
| Hand-off | "Ask Claude" buttons open a claude.ai link with the prompt prefilled | Falls back to copying the prompt |

## Data flow

- The app reads and writes through `supabase-js` as the signed-in user; Row Level Security limits every row to the user's household.
- Claude writes through the Supabase connector, which has admin access and bypasses Row Level Security. The database's own constraints (units, foreign keys, required fields) are the guard; the skill also tells Claude to stay within the owner's household.
- The shopping list is not stored: the app derives it from `meal_plan_dishes` + `recipe_ingredients` (scaled by servings, swaps applied) and overlays `list_marks` and `list_extras`.
- Realtime: the app subscribes to plan and list changes so a plan Claude saves appears without a refresh.

## Keys

- The project URL and **publishable (anon) key** are committed in `web/src/config.ts`. They are public by design; Row Level Security protects the data.
- The **service (secret) key is never committed** and never used by the app.

## Who pays for what

| Thing | Paid by |
| --- | --- |
| GitHub Pages, Supabase free tier | Free |
| Claude planning chat, skill, connector | Owner's Claude subscription |
| Partner or friends' AI (import box, M3) | Their own AI |
| Optional in-app AI button (Later) | Claude API credit, billed separately, with a spending limit |

## Claude and the terms of use

- Fine: the owner using Claude in Claude's own apps with official features (connectors, skills, scheduled tasks) for their own household.
- Not done: automating claude.ai from outside (scripts driving the account), sharing the owner's login, or running other people's requests through the owner's subscription. Anything like that uses the API instead.

## Supabase free tier

- Projects pause after about a week with no activity. Weekly use keeps it awake; if it pauses, restore it from the Supabase dashboard. A keep-awake ping is a Later ticket.
- No downloadable backups on the free tier, so the app has an Export button.

## Migration triggers (beyond M1)

Move or add infrastructure only when one of these happens: partner needs AI without a Claude account; a custom domain; full offline ticking; in-app AI for non-owners (API proxy on a Cloudflare Worker).
