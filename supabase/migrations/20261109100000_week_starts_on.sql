-- The day a household's week starts on (#78): household_settings.settings.weekStartsOn,
-- 'mon'..'sun', Monday when missing. Every week_start (plans, list marks and extras, votes)
-- must be that day, checked by a trigger instead of the old Monday checks. Changing the
-- setting moves the household's weeks to the new boundaries in the same write:
--   * nights and dishes keep their dates (a day's dinner stays on that day, in whichever week
--     now holds it), so only week_start changes and day stays;
--   * list marks, list extras and votes belong to a whole week and move to the new week that
--     overlaps most with their old one (at most 3 days away).
-- Nothing collides while rows move: the old weeks all start on the old day and the new ones on
-- the new day, and both mappings are one-to-one.

-- ---------------------------------------------------------------- the setting

alter table public.household_settings add constraint household_settings_week_starts_on_check
  check (settings->'weekStartsOn' is null
         or settings->>'weekStartsOn' in ('mon','tue','wed','thu','fri','sat','sun'));

-- ISO weekday (1 = Monday .. 7 = Sunday) of a day code.
create or replace function private.isodow_of(day text)
returns integer language sql immutable set search_path = '' as $$
  select array_position(array['mon','tue','wed','thu','fri','sat','sun'], day)
$$;

-- ISO weekday the household's weeks start on. Definer, so the check below sees the real
-- setting whoever writes; only the triggers call it.
create or replace function private.week_start_isodow(hid uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select private.isodow_of(s.settings->>'weekStartsOn')
                   from public.household_settings s where s.household_id = hid), 1)
$$;
revoke execute on function private.week_start_isodow(uuid) from public, anon, authenticated;

-- The start of the household's week holding date d (for the Dinner Planner skill and tests).
-- Runs as the caller, so it reads only settings the caller can see.
create or replace function public.week_start_of(hid uuid, d date)
returns date language sql stable security invoker set search_path = '' as $$
  select d - ((extract(isodow from d)::integer
               - coalesce((select private.isodow_of(s.settings->>'weekStartsOn')
                           from public.household_settings s where s.household_id = hid), 1) + 7) % 7)
$$;
revoke execute on function public.week_start_of(uuid, date) from public, anon;
grant execute on function public.week_start_of(uuid, date) to authenticated;

-- ---------------------------------------------------------------- the check

alter table public.meal_plan_nights drop constraint if exists meal_plan_nights_week_start_check;
alter table public.meal_plan_dishes drop constraint if exists meal_plan_dishes_week_start_check;
alter table public.list_marks drop constraint if exists list_marks_week_start_check;
alter table public.list_extras drop constraint if exists list_extras_week_start_check;
alter table public.recipe_votes drop constraint if exists recipe_votes_week_start_check;

create or replace function private.check_week_start()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if extract(isodow from new.week_start) <> private.week_start_isodow(new.household_id) then
    raise exception 'week_start % is not a start of the household''s week', new.week_start
      using errcode = 'check_violation',
            hint = 'Weeks start on the day in household_settings.settings.weekStartsOn (Monday when missing).';
  end if;
  return new;
end $$;

create trigger meal_plan_nights_week_start before insert or update of week_start, household_id
  on public.meal_plan_nights for each row execute function private.check_week_start();
create trigger meal_plan_dishes_week_start before insert or update of week_start, household_id
  on public.meal_plan_dishes for each row execute function private.check_week_start();
create trigger list_marks_week_start before insert or update of week_start, household_id
  on public.list_marks for each row execute function private.check_week_start();
create trigger list_extras_week_start before insert or update of week_start, household_id
  on public.list_extras for each row execute function private.check_week_start();
create trigger recipe_votes_week_start before insert or update of week_start, household_id
  on public.recipe_votes for each row execute function private.check_week_start();

-- ---------------------------------------------------------------- moving weeks

-- Runs after the setting changes, as definer so a member's settings save can move rows it
-- could not write directly (other members' votes).
create or replace function private.move_weeks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_dow integer := coalesce(private.isodow_of(case when tg_op = 'UPDATE' then old.settings->>'weekStartsOn' end), 1);
  new_dow integer := coalesce(private.isodow_of(new.settings->>'weekStartsOn'), 1);
  hid uuid := new.household_id;
  -- Shift from an old week start to the new one that overlaps it most: -3..3 days.
  shift integer := ((new_dow - old_dow + 10) % 7) - 3;
begin
  if new_dow = old_dow then return null; end if;

  -- A night's date is the day in its week with that weekday; the new week is the one holding it.
  update public.meal_plan_nights n
    set week_start = x.d - ((extract(isodow from x.d)::integer - new_dow + 7) % 7)
    from (select week_start, day, week_start + ((private.isodow_of(day) - old_dow + 7) % 7) as d
          from public.meal_plan_nights where household_id = hid) x
    where n.household_id = hid and n.week_start = x.week_start and n.day = x.day;

  update public.meal_plan_dishes p
    set week_start = x.d - ((extract(isodow from x.d)::integer - new_dow + 7) % 7)
    from (select id, week_start + ((private.isodow_of(day) - old_dow + 7) % 7) as d
          from public.meal_plan_dishes where household_id = hid) x
    where p.id = x.id;

  update public.list_marks set week_start = week_start + shift where household_id = hid;
  update public.list_extras set week_start = week_start + shift where household_id = hid;
  update public.recipe_votes set week_start = week_start + shift where household_id = hid;
  return null;
end $$;

revoke execute on function private.check_week_start() from public, anon, authenticated;
revoke execute on function private.move_weeks() from public, anon, authenticated;

create trigger household_settings_move_weeks after insert or update of settings
  on public.household_settings for each row execute function private.move_weeks();

-- ---------------------------------------------------------------- keeping members in step

-- Another member's phone picks up a change of start day as it happens.
alter publication supabase_realtime add table public.household_settings;

-- Members read, add and change the settings row but never delete it: deleting it would put weeks
-- back on Monday without moving them. It goes with the household.
drop policy "members all" on public.household_settings;
create policy "members read settings" on public.household_settings for select to authenticated
  using ((select private.is_member(household_id)));
create policy "members add settings" on public.household_settings for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy "members change settings" on public.household_settings for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
