# 0002 · Supabase from M1; hybrid front-end

**Date:** 2026-10-28 · **Status:** accepted

**Context.** The owner wants a real database built in early. A Claude-hosted page cannot call Supabase directly (its network access is locked down); it could only go through the owner's admin connector, which is no good for a partner or other households.

**Decision.** Supabase lands in M1. The everyday app moves to GitHub Pages and talks to Supabase directly with logins and Row Level Security. Planning stays in Claude (chat + skill + Supabase connector) on the owner's subscription. Both share one database.

**Consequences.** The prototype's UI is rebuilt as a React app (logic and theme carry over). In-app AI is no longer on the subscription; the app hands off to Claude instead. The app no longer depends on Claude to load, and it is ready for a partner's login in M2. Firebase was considered (document store, offline) but has no Claude connector.
