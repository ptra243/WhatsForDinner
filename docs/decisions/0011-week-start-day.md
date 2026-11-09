# 0011 · Weeks start on the household's day, not always Monday

**Date:** 2026-11-04 · **Status:** accepted; changes the "week start is always a Monday" rule in [0003](0003-relational-schema.md)'s schema

**Context.** Plans, list marks and extras, and votes were keyed by a `week_start` checked to be a Monday. The household shops on weekends, so a Monday week splits one shop across two plans and two lists (#78).

**Decision.** (Owner, 2026-11-04.) The household chooses the day its week starts on: `household_settings.settings.weekStartsOn` (`mon`..`sun`, Monday when missing). `week_start` stays a date and is stored as the household's chosen start day. A trigger replaces the five Monday checks and refuses any other weekday, whoever writes. Changing the setting moves the household's weeks in the same write: dinners and nights keep their dates (`day` stays, `week_start` changes), and week-wide rows (list marks, list extras, votes) go to the new week that overlaps most with their old one.

**Consequences.** One shop buys one plan for any shopping day. `week_start` can no longer be worked out from a date alone: the app and the skill need the household's setting (`public.week_start_of(hid, date)` in SQL, `weekStartOf` in the app, which loads the setting before showing a week and keeps it on the device for offline use). Moving a list's ticks to an overlapping week is a best fit: ticks for nights that moved to the neighbouring week stay with the week they mostly belong to.
