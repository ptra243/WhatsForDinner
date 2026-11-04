-- Recipe steps linked to the ingredients they use (#65), so cook mode shows exactly what a step
-- needs and what was never used. A step (of any method) links to its own recipe's ingredients;
-- removing either side removes the link.

create table public.recipe_step_ingredients (
  step_id uuid not null references public.recipe_steps(id) on delete cascade,
  recipe_ingredient_id uuid not null references public.recipe_ingredients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (step_id, recipe_ingredient_id)
);
create index recipe_step_ingredients_recipe_ingredient_id_idx on public.recipe_step_ingredients(recipe_ingredient_id);

-- A step can only use an ingredient of its own recipe. Runs as the caller, so a step or an
-- ingredient the caller cannot see counts as another recipe's.
create or replace function private.step_ingredient_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.recipe_steps s
                 join public.recipe_ingredients ri on ri.recipe_id = s.recipe_id
                 where s.id = new.step_id and ri.id = new.recipe_ingredient_id) then
    raise exception 'A step can only use its own recipe''s ingredients' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger recipe_step_ingredients_check before insert or update on public.recipe_step_ingredients
  for each row execute function private.step_ingredient_check();

alter table public.recipe_step_ingredients enable row level security;
create policy "members all" on public.recipe_step_ingredients for all to authenticated
  using (exists (select 1 from public.recipe_steps s join public.recipes r on r.id = s.recipe_id
                 where s.id = step_id and (select private.is_member(r.household_id))))
  with check (exists (select 1 from public.recipe_steps s join public.recipes r on r.id = s.recipe_id
                      where s.id = step_id and (select private.is_member(r.household_id))));
grant select, insert, update, delete on public.recipe_step_ingredients to authenticated;

-- New households get the examples' links too: each step and ingredient of the copy is the
-- template's at the same position (and method name).
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

  insert into public.recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
  select n.id, tm.name, tm.equipment, tm.active_mins, tm.total_mins
  from public.recipes t
  join public.recipes n on n.household_id = hid and n.slug = t.slug
  join public.recipe_methods tm on tm.recipe_id = t.id
  where t.household_id = tid;

  -- A method's steps go to the copy's method of the same name.
  insert into public.recipe_steps (recipe_id, method_id, position, text, timer_mins)
  select n.id, nm.id, rs.position, rs.text, rs.timer_mins
  from public.recipes t
  join public.recipes n on n.household_id = hid and n.slug = t.slug
  join public.recipe_steps rs on rs.recipe_id = t.id
  left join public.recipe_methods tm on tm.id = rs.method_id
  left join public.recipe_methods nm on nm.recipe_id = n.id and nm.name = tm.name
  where t.household_id = tid;

  insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
  select ns.id, ni.id
  from public.recipes t
  join public.recipes n on n.household_id = hid and n.slug = t.slug
  join public.recipe_steps ts on ts.recipe_id = t.id
  join public.recipe_step_ingredients l on l.step_id = ts.id
  join public.recipe_ingredients ti on ti.id = l.recipe_ingredient_id
  left join public.recipe_methods tm on tm.id = ts.method_id
  left join public.recipe_methods nm on nm.recipe_id = n.id and nm.name = tm.name
  join public.recipe_steps ns on ns.recipe_id = n.id and ns.method_id is not distinct from nm.id and ns.position = ts.position
  join public.recipe_ingredients ni on ni.recipe_id = n.id and ni.position = ti.position
  where t.household_id = tid;

  return hid;
end $$;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

-- save_recipe also saves which ingredients each step uses: a step's `uses` lists positions in
-- the recipe's `ingredients` (from 0, as sent), so new ingredients can be linked before they have
-- ids. A step sent without `uses` keeps the links it has.
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
  ing_ids uuid[] := '{}';
  used text;
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
      values (rid, pos, islug, (item->>'qty')::numeric, item->>'unit', coalesce(item->>'note', ''))
      returning id into kept;
    end if;
    ing_ids := ing_ids || kept;
    islug := null;
    pos := pos + 1;
  end loop;

  -- The default method's steps, the same way. Other methods' steps are left alone.
  delete from public.recipe_steps s
  where s.recipe_id = rid and s.method_id is null
    and s.id::text not in (select x->>'id' from jsonb_array_elements(coalesce(recipe->'steps', '[]')) x
                           where x->>'id' is not null);
  update public.recipe_steps set position = position + 100000 where recipe_id = rid and method_id is null;
  pos := 0;
  for item in select * from jsonb_array_elements(coalesce(recipe->'steps', '[]')) loop
    if trim(coalesce(item->>'text', '')) = '' then raise exception 'Step % has no text', pos + 1; end if;
    kept := null;
    update public.recipe_steps s
    set position = pos, text = trim(item->>'text'), timer_mins = (item->>'timer_mins')::integer
    where s.recipe_id = rid and s.method_id is null and s.id::text = item->>'id'
    returning s.id into kept;
    if kept is null then
      insert into public.recipe_steps (recipe_id, position, text, timer_mins)
      values (rid, pos, trim(item->>'text'), (item->>'timer_mins')::integer)
      returning id into kept;
    end if;
    if item ? 'uses' then
      delete from public.recipe_step_ingredients l where l.step_id = kept;
      for used in select * from jsonb_array_elements_text(item->'uses') loop
        if used !~ '^\d+$' or used::integer >= coalesce(array_length(ing_ids, 1), 0) then
          raise exception 'Step % uses an ingredient that isn''t in the recipe', pos + 1;
        end if;
        insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
        values (kept, ing_ids[used::integer + 1])
        on conflict do nothing;
      end loop;
    end if;
    pos := pos + 1;
  end loop;

  return rid;
end $$;

revoke execute on function public.save_recipe(uuid, jsonb) from public, anon;
grant execute on function public.save_recipe(uuid, jsonb) to authenticated;
