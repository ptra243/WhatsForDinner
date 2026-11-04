-- A night's own time and a lock (#70). `minutes` is the hands-on time for that night only
-- ("only 20 minutes tonight"); null means the weekday's setting. `locked` tells Claude to
-- leave the night's dishes alone when replanning, unless asked.
alter table public.meal_plan_nights
  add column minutes integer check (minutes > 0),
  add column locked boolean not null default false;

-- move_night as before, and the lock now goes with the dinner like skip-check does. The
-- time override belongs to the day, so it stays where it is.
create or replace function public.move_night(
  hid uuid, from_week date, from_day text, to_week date, to_day text
) returns void language plpgsql set search_path = '' as $$
declare
  from_skip boolean;
  to_skip boolean;
  from_locked boolean;
  to_locked boolean;
  from_cooked boolean;
  to_cooked boolean;
begin
  if not (select private.is_member(hid)) then raise exception 'Not your household'; end if;
  if from_week = to_week and from_day = to_day then raise exception 'Pick another night'; end if;

  -- Lock both nights (making their rows if they have none) so a second move waits.
  insert into public.meal_plan_nights (household_id, week_start, day)
  values (hid, from_week, from_day), (hid, to_week, to_day)
  on conflict do nothing;
  select skip_check, locked, cooked into from_skip, from_locked, from_cooked from public.meal_plan_nights
  where household_id = hid and week_start = from_week and day = from_day for update;
  select skip_check, locked, cooked into to_skip, to_locked, to_cooked from public.meal_plan_nights
  where household_id = hid and week_start = to_week and day = to_day for update;
  if from_cooked or to_cooked then raise exception 'A cooked night cannot be moved'; end if;

  update public.meal_plan_dishes d
  set week_start = case when d.week_start = from_week and d.day = from_day then to_week else from_week end,
      day = case when d.week_start = from_week and d.day = from_day then to_day else from_day end
  where d.household_id = hid
    and ((d.week_start = from_week and d.day = from_day) or (d.week_start = to_week and d.day = to_day));

  update public.meal_plan_nights n
  set skip_check = case when n.week_start = from_week and n.day = from_day then to_skip else from_skip end,
      locked = case when n.week_start = from_week and n.day = from_day then to_locked else from_locked end
  where n.household_id = hid
    and ((n.week_start = from_week and n.day = from_day) or (n.week_start = to_week and n.day = to_day))
    and (from_skip is distinct from to_skip or from_locked is distinct from to_locked);
end $$;
