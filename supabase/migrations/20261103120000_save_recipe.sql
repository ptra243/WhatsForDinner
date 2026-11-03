-- Hand-entry recipe form (#21). One call saves a recipe with its ingredients and steps, so a
-- save succeeds or fails as a whole (a bad unit or a missing section rejects all of it).
-- Runs as the caller, so Row Level Security keeps it to the caller's household and the
-- shared ingredient list's own policies apply to new ingredients.
--
-- `recipe` is {id?, name, course, serves, active_mins, total_mins, provides, spice, tags,
-- source, notes, ingredients: [{id?, name, qty, unit, note, section?, allergens?}],
-- steps: [{id?, text, timer_mins}]}. Without `id` it adds a recipe with a unique slug made from
-- its name and the caller as `created_by`. With `id` it edits that recipe: the slug stays, the
-- recipe becomes the household's own (`is_example = false`), ingredient and step rows whose ids
-- are given keep them (so anything linked to a row survives), and the rest are added or removed.
-- An ingredient name not in `ingredients` is added with the given section and allergens.
-- Returns the recipe's id.

-- A lowercase-hyphenated slug from a name ("Chicken & leek pie" → chicken-leek-pie).
create or replace function private.slugify(s text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(s), '[^a-z0-9]+', '-', 'g')), ''), 'recipe')
$$;

create or replace function public.save_recipe(hid uuid, recipe jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  rid uuid := nullif(recipe->>'id', '')::uuid;
  rname text := trim(coalesce(recipe->>'name', ''));
  active integer := (recipe->>'active_mins')::integer;
  total integer := (recipe->>'total_mins')::integer;
  base text;
  rslug text;
  n integer := 1;
  item jsonb;
  pos integer;
  iname text;
  islug text;
  kept uuid;
begin
  if not (select private.is_member(hid)) then raise exception 'Not your household'; end if;
  if rname = '' then raise exception 'Give the recipe a name'; end if;
  if total < active then raise exception 'Total minutes can''t be less than hands-on minutes'; end if;
  if exists (select 1 from public.recipes r
             where r.household_id = hid and lower(r.name) = lower(rname) and r.id is distinct from rid) then
    raise exception 'A recipe called % already exists', rname;
  end if;

  if rid is null then
    base := private.slugify(rname);
    rslug := base;
    while exists (select 1 from public.recipes r where r.household_id = hid and r.slug = rslug) loop
      n := n + 1;
      rslug := base || '-' || n;
    end loop;
    insert into public.recipes (household_id, slug, name, course, serves, active_mins, total_mins,
                                provides, spice, tags, source, notes, is_example, created_by)
    values (hid, rslug, rname, coalesce(recipe->>'course', 'main'), coalesce((recipe->>'serves')::numeric, 4),
            active, total,
            array(select jsonb_array_elements_text(coalesce(recipe->'provides', '[]'))),
            (recipe->>'spice')::smallint,
            array(select jsonb_array_elements_text(coalesce(recipe->'tags', '[]'))),
            coalesce(recipe->>'source', ''), coalesce(recipe->>'notes', ''), false, (select auth.uid()))
    returning id into rid;
  else
    update public.recipes r
    set name = rname,
        course = coalesce(recipe->>'course', 'main'),
        serves = coalesce((recipe->>'serves')::numeric, 4),
        active_mins = active,
        total_mins = total,
        provides = array(select jsonb_array_elements_text(coalesce(recipe->'provides', '[]'))),
        spice = (recipe->>'spice')::smallint,
        tags = array(select jsonb_array_elements_text(coalesce(recipe->'tags', '[]'))),
        source = coalesce(recipe->>'source', ''),
        notes = coalesce(recipe->>'notes', ''),
        is_example = false,
        created_by = coalesce(r.created_by, (select auth.uid()))
    where r.id = rid and r.household_id = hid;
    if not found then raise exception 'Recipe not found'; end if;
  end if;

  -- Ingredients. Rows not given are removed; the kept ones move out of the way first, since
  -- (recipe_id, position) is unique and rows may be reordered.
  delete from public.recipe_ingredients ri
  where ri.recipe_id = rid
    and ri.id::text not in (select x->>'id' from jsonb_array_elements(coalesce(recipe->'ingredients', '[]')) x
                            where x->>'id' is not null);
  update public.recipe_ingredients set position = position + 100000 where recipe_id = rid;
  pos := 0;
  for item in select * from jsonb_array_elements(coalesce(recipe->'ingredients', '[]')) loop
    iname := lower(trim(regexp_replace(coalesce(item->>'name', ''), '\s+', ' ', 'g')));
    if iname = '' then raise exception 'Ingredient % has no name', pos + 1; end if;
    if not coalesce(private.is_unit(item->>'unit'), false) then
      raise exception '%: "%" is not a unit', iname, coalesce(item->>'unit', '');
    end if;
    select i.slug into islug from public.ingredients i where i.name = iname;
    if islug is null then
      if not coalesce(private.is_section(item->>'section'), false) then raise exception '%: pick its section', iname; end if;
      base := private.slugify(iname);
      islug := base;
      n := 1;
      while exists (select 1 from public.ingredients i where i.slug = islug) loop
        n := n + 1;
        islug := base || '-' || n;
      end loop;
      insert into public.ingredients (slug, name, section, allergens)
      values (islug, iname, item->>'section',
              array(select jsonb_array_elements_text(coalesce(item->'allergens', '[]'))));
    end if;
    kept := null;
    update public.recipe_ingredients ri
    set position = pos, ingredient_slug = islug, qty = (item->>'qty')::numeric, unit = item->>'unit',
        note = coalesce(item->>'note', '')
    where ri.recipe_id = rid and ri.id::text = item->>'id'
    returning ri.id into kept;
    if kept is null then
      insert into public.recipe_ingredients (recipe_id, position, ingredient_slug, qty, unit, note)
      values (rid, pos, islug, (item->>'qty')::numeric, item->>'unit', coalesce(item->>'note', ''));
    end if;
    islug := null;
    pos := pos + 1;
  end loop;

  -- Steps, the same way.
  delete from public.recipe_steps s
  where s.recipe_id = rid
    and s.id::text not in (select x->>'id' from jsonb_array_elements(coalesce(recipe->'steps', '[]')) x
                           where x->>'id' is not null);
  update public.recipe_steps set position = position + 100000 where recipe_id = rid;
  pos := 0;
  for item in select * from jsonb_array_elements(coalesce(recipe->'steps', '[]')) loop
    if trim(coalesce(item->>'text', '')) = '' then raise exception 'Step % has no text', pos + 1; end if;
    kept := null;
    update public.recipe_steps s
    set position = pos, text = trim(item->>'text'), timer_mins = (item->>'timer_mins')::integer
    where s.recipe_id = rid and s.id::text = item->>'id'
    returning s.id into kept;
    if kept is null then
      insert into public.recipe_steps (recipe_id, position, text, timer_mins)
      values (rid, pos, trim(item->>'text'), (item->>'timer_mins')::integer);
    end if;
    pos := pos + 1;
  end loop;

  return rid;
end $$;

revoke execute on function public.save_recipe(uuid, jsonb) from public, anon;
grant execute on function public.save_recipe(uuid, jsonb) to authenticated;
