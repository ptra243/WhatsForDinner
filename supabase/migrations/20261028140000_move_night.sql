-- Move a night's dinner to another night (#61). One call, so the move succeeds or fails
-- as a whole: every dish on the night goes to the other night with its role, position,
-- servings and swaps, and the other night's dishes come back (the nights swap). The
-- skip-check flag goes with the dinner. A cooked night cannot be moved or swapped with.
-- Runs as the caller, so Row Level Security keeps it to the caller's household.

create or replace function public.move_night(
  hid uuid, from_week date, from_day text, to_week date, to_day text
) returns void language plpgsql set search_path = '' as $$
declare
  from_skip boolean;
  to_skip boolean;
  from_cooked boolean;
  to_cooked boolean;
begin
  if not (select private.is_member(hid)) then raise exception 'Not your household'; end if;
  if from_week = to_week and from_day = to_day then raise exception 'Pick another night'; end if;

  -- Lock both nights (making their rows if they have none) so a second move waits.
  insert into public.meal_plan_nights (household_id, week_start, day)
  values (hid, from_week, from_day), (hid, to_week, to_day)
  on conflict do nothing;
  select skip_check, cooked into from_skip, from_cooked from public.meal_plan_nights
  where household_id = hid and week_start = from_week and day = from_day for update;
  select skip_check, cooked into to_skip, to_cooked from public.meal_plan_nights
  where household_id = hid and week_start = to_week and day = to_day for update;
  if from_cooked or to_cooked then raise exception 'A cooked night cannot be moved'; end if;

  update public.meal_plan_dishes d
  set week_start = case when d.week_start = from_week and d.day = from_day then to_week else from_week end,
      day = case when d.week_start = from_week and d.day = from_day then to_day else from_day end
  where d.household_id = hid
    and ((d.week_start = from_week and d.day = from_day) or (d.week_start = to_week and d.day = to_day));

  update public.meal_plan_nights n
  set skip_check = case when n.week_start = from_week and n.day = from_day then to_skip else from_skip end
  where n.household_id = hid
    and ((n.week_start = from_week and n.day = from_day) or (n.week_start = to_week and n.day = to_day))
    and from_skip is distinct from to_skip;
end $$;

revoke execute on function public.move_night(uuid, date, text, date, text) from public, anon;
grant execute on function public.move_night(uuid, date, text, date, text) to authenticated;
