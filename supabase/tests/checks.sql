-- Structural checks CI runs after the migrations apply. Each block raises on failure.
-- Keeps the hard rules in CLAUDE.md true for every new table.

-- Every public table has Row Level Security.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then raise exception 'Tables without row level security: %', bad; end if;
end $$;

-- Every household-owned table has household_id. The exceptions are the households
-- table itself, the shared ingredient list, and recipe children (scoped through recipes).
do $$
declare bad text;
begin
  select string_agg(t.table_name, ', ' order by t.table_name) into bad
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and t.table_name not in ('households', 'ingredients', 'recipe_ingredients', 'recipe_steps', 'recipe_methods',
                             'recipe_step_ingredients')
    and not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.table_name
                      and c.column_name = 'household_id');
  if bad is not null then raise exception 'Tables without household_id: %', bad; end if;
end $$;

-- The app's role can read every public table and anon can touch none. The live project
-- gives no default table privileges, so a table without an explicit grant is unusable there.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not has_table_privilege('authenticated', c.oid, 'select')
         or has_table_privilege('anon', c.oid, 'select, insert, update, delete'));
  if bad is not null then raise exception 'Tables without a select grant to authenticated, or open to anon: %', bad; end if;
end $$;

-- Ingredient allergens come from the fixed list (#62): an unknown one is refused.
do $$
begin
  begin
    insert into public.ingredients (slug, name, allergens) values ('check-allergen', 'check allergen', array['nuts']);
    raise exception 'ingredients.allergens accepted an allergen not on the list';
  exception when check_violation then null;
  end;
  if private.allergens() is distinct from array['egg','milk','peanut','tree nut','sesame','soy','wheat','gluten',
                                                'fish','crustacean','mollusc','lupin'] then
    raise exception 'private.allergens() changed: update the app, the skill and the docs with it';
  end if;
end $$;

-- Pack sizes and shelf life (#25): a pack is a positive amount in a known unit, both or neither;
-- shelf life is whole days from 0.
do $$
declare
  bad text[] := array[
    $q$insert into public.ingredients (slug, name, pack_qty, pack_unit) values ('check-pack', 'check pack', 0, 'g')$q$,
    $q$insert into public.ingredients (slug, name, pack_qty, pack_unit) values ('check-pack', 'check pack', 500, 'packet')$q$,
    $q$insert into public.ingredients (slug, name, pack_qty) values ('check-pack', 'check pack', 500)$q$,
    $q$insert into public.ingredients (slug, name, pack_unit) values ('check-pack', 'check pack', 'g')$q$,
    $q$insert into public.ingredients (slug, name, shelf_days) values ('check-pack', 'check pack', -1)$q$];
  q text;
begin
  foreach q in array bad loop
    begin
      execute q;
      raise exception 'ingredients accepted a bad pack size or shelf life: %', q;
    exception when check_violation then null;
    end;
  end loop;
end $$;
