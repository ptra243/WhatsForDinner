-- Example recipes for new households (issue #5).
-- supabase/seed/seed.sql loads the examples from seed/ into a fixed template household
-- that has no members (so Row Level Security hides it from every user).
-- create_household() copies the template's recipes and settings into each new household.

create or replace function private.template_household_id()
returns uuid language sql immutable set search_path = '' as $$
  select '00000000-0000-4000-8000-000000000001'::uuid
$$;

insert into public.households (id, name)
values (private.template_household_id(), 'Example recipes (template)')
on conflict (id) do nothing;

-- Create a household with the caller as owner, holding a copy of the example recipes
-- (with their ingredients and steps) and the example settings. Returns its id.
-- In M1 a user belongs to one household: if the caller already has one, its id is
-- returned and nothing is created, so a repeated or racing first sign-in is harmless.
create or replace function public.create_household(household_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  tid uuid := private.template_household_id();
  hid uuid;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  perform pg_advisory_xact_lock(hashtextextended('create_household:' || uid::text, 0));
  select m.household_id into hid
    from public.household_members m
    where m.user_id = uid
    order by m.created_at
    limit 1;
  if hid is not null then return hid; end if;

  insert into public.households (name) values (household_name) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
  insert into public.household_settings (household_id, settings)
  values (hid, coalesce((select s.settings from public.household_settings s where s.household_id = tid), '{}'::jsonb));

  insert into public.recipes (household_id, slug, name, course, serves, active_mins, total_mins,
                              provides, spice, tags, source, rating, notes, is_example, created_by)
  select hid, t.slug, t.name, t.course, t.serves, t.active_mins, t.total_mins,
         t.provides, t.spice, t.tags, t.source, t.rating, t.notes, true, null
  from public.recipes t
  where t.household_id = tid;

  insert into public.recipe_ingredients (recipe_id, position, ingredient_slug, qty, unit, note)
  select n.id, ri.position, ri.ingredient_slug, ri.qty, ri.unit, ri.note
  from public.recipes t
  join public.recipes n on n.household_id = hid and n.slug = t.slug
  join public.recipe_ingredients ri on ri.recipe_id = t.id
  where t.household_id = tid;

  insert into public.recipe_steps (recipe_id, position, text, timer_mins)
  select n.id, rs.position, rs.text, rs.timer_mins
  from public.recipes t
  join public.recipes n on n.household_id = hid and n.slug = t.slug
  join public.recipe_steps rs on rs.recipe_id = t.id
  where t.household_id = tid;

  return hid;
end $$;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
