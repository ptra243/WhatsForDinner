// Builds supabase/seed/seed.sql from the example data in seed/.
// Usage: node supabase/seed/build.mjs
// Checks the data against the fixed units, sections and allergens first, so a bad seed
// fails here rather than half-way through a database run.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const seedDir = join(root, 'seed');

// Keep in step with private.is_unit / private.is_section / private.allergens in the migrations.
const UNITS = ['g', 'kg', 'ml', 'l', 'each', 'tsp', 'tbsp', 'bunch', 'tin'];
const SECTIONS = ['fruit and veg', 'bakery', 'meat and seafood', 'dairy and fridge', 'canned veg',
  'canned fruit', 'international', 'pantry', 'herbs and spices', 'frozen', 'other'];
const ALLERGENS = ['egg', 'milk', 'peanut', 'tree nut', 'sesame', 'soy', 'wheat', 'gluten', 'fish', 'crustacean',
  'mollusc', 'lupin'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const readJson = (...p) => JSON.parse(readFileSync(join(seedDir, ...p), 'utf8'));
const errors = [];

const ingredients = Object.entries(readJson('meta', 'ingredients.json').items).map(([slug, i]) => {
  if (!SLUG.test(slug)) errors.push(`ingredient ${slug}: bad slug`);
  if (i.name !== i.name.trim().toLowerCase()) errors.push(`ingredient ${slug}: name must be lowercase`);
  if (!SECTIONS.includes(i.aisle)) errors.push(`ingredient ${slug}: unknown section "${i.aisle}"`);
  for (const a of i.allergens ?? []) if (!ALLERGENS.includes(a)) errors.push(`ingredient ${slug}: unknown allergen "${a}"`);
  if (i.pack && !(i.pack.qty > 0)) errors.push(`ingredient ${slug}: pack qty must be positive`);
  if (i.pack && !UNITS.includes(i.pack.unit)) errors.push(`ingredient ${slug}: unknown pack unit "${i.pack.unit}"`);
  if (i.shelfDays != null && !(Number.isInteger(i.shelfDays) && i.shelfDays >= 0)) errors.push(`ingredient ${slug}: shelfDays must be a whole number from 0`);
  return {
    slug,
    name: i.name,
    section: i.aisle,
    allergens: i.allergens ?? [],
    pack_qty: i.pack?.qty ?? null,
    pack_unit: i.pack?.unit ?? null,
    shelf_days: i.shelfDays ?? null,
  };
});
const ingredientNames = new Set(ingredients.map((i) => i.name));

const recipes = readdirSync(join(seedDir, 'recipes')).filter((f) => f.endsWith('.json')).sort().map((file) => {
  const slug = file.replace(/\.json$/, '');
  const r = readJson('recipes', file);
  if (!SLUG.test(slug)) errors.push(`recipe ${file}: bad slug`);
  for (const i of r.ingredients) {
    if (!ingredientNames.has(i.name)) errors.push(`recipe ${slug}: ingredient "${i.name}" is not in ingredients.json`);
    if (!UNITS.includes(i.unit)) errors.push(`recipe ${slug}: unknown unit "${i.unit}"`);
  }
  const methods = r.methods ?? [];
  for (const s of [...r.steps, ...methods.flatMap((m) => m.steps)]) {
    if (s.timerMins != null && !(s.timerMins > 0)) errors.push(`recipe ${slug}: timer must be positive`);
    if (!s.optional && (s.extraMins != null || s.why)) errors.push(`recipe ${slug}: only an optional step has extraMins or why`);
    if (s.optional && !(Number.isInteger(s.extraMins) && s.extraMins > 0)) errors.push(`recipe ${slug}: an optional step needs extraMins above 0`);
  }
  for (const m of methods) {
    if (!m.name?.trim()) errors.push(`recipe ${slug}: a method needs a name`);
    if (m.totalMins < m.activeMins) errors.push(`recipe ${slug}: method ${m.name} total is less than hands-on`);
  }
  if (new Set(methods.map((m) => m.name)).size !== methods.length) errors.push(`recipe ${slug}: two methods share a name`);
  // Every step lists the ingredients it uses by name, and each way of cooking it uses them all.
  const names = r.ingredients.map((i) => i.name);
  if (new Set(names).size !== names.length) errors.push(`recipe ${slug}: an ingredient is listed twice`);
  for (const [what, steps] of [['steps', r.steps], ...methods.map((m) => [`method ${m.name}`, m.steps])]) {
    for (const s of steps) {
      if (!Array.isArray(s.uses)) errors.push(`recipe ${slug}: a step in ${what} has no "uses"`);
      for (const u of s.uses ?? []) if (!names.includes(u)) errors.push(`recipe ${slug}: ${what} uses "${u}", which it doesn't list`);
    }
    const unused = names.filter((n) => !steps.some((s) => s.uses?.includes(n)));
    if (unused.length) errors.push(`recipe ${slug}: no step in ${what} uses ${unused.join(', ')}`);
  }
  const toSteps = (steps) =>
    steps.map((s) => ({
      text: s.text,
      timer_mins: s.timerMins ?? null,
      optional: !!s.optional,
      extra_mins: s.extraMins ?? null,
      why: s.why ?? '',
      uses: (s.uses ?? []).map((u) => names.indexOf(u)),
    }));
  return {
    slug,
    name: r.name,
    course: r.course,
    serves: r.serves,
    active_mins: r.activeMins ?? null,
    total_mins: r.totalMins ?? null,
    provides: r.provides ?? [],
    spice: r.spice ?? null,
    tags: r.tags ?? [],
    source: r.source ?? '',
    rating: r.rating ?? null,
    notes: r.notes ?? '',
    ingredients: r.ingredients.map((i) => ({ name: i.name, qty: i.qty ?? null, unit: i.unit, note: i.note ?? '' })),
    steps: toSteps(r.steps),
    methods: methods.map((m) => ({
      name: m.name,
      equipment: m.equipment ?? null,
      active_mins: m.activeMins ?? null,
      total_mins: m.totalMins ?? null,
      steps: toSteps(m.steps),
    })),
  };
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const settings = readJson('meta', 'household.json');
// One ingredient or recipe per line keeps the file small and its diffs readable.
const lines = (items) => `[\n${items.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]`;
const data = `{\n "ingredients": ${lines(ingredients)},\n "recipes": ${lines(recipes)},\n "settings": ${JSON.stringify(settings)}\n}`;
if (data.includes('$seed$')) throw new Error('seed data contains the SQL quote tag $seed$');

const sql = `-- GENERATED by supabase/seed/build.mjs from seed/. Do not edit by hand.
--
-- Loads the example ingredients, recipes and household settings into the template
-- household (private.template_household_id(), created by the migrations; it has no
-- members). create_household() copies the template into each new household; households
-- that already exist are not touched. Safe to re-run:
-- - ingredients: added if missing; existing ones (and their sections and allergens) are kept,
--   and get the seed's pack size and shelf life only where they have none.
-- - template recipes: upserted by slug, with ingredients, steps (optional ones too), methods and
--   the ingredients each step uses replaced from the seed; template recipes no longer in seed/ are removed.
-- - template settings: replaced by the seed's.

do $do$
declare
  seed jsonb := $seed$${data}$seed$;
  hid uuid := private.template_household_id();
  r jsonb;
  m jsonb;
  rid uuid;
  mid uuid;
begin
  if not exists (select 1 from public.households where id = hid) then
    raise exception 'Template household % is missing: apply the migrations first', hid;
  end if;

  insert into public.ingredients (slug, name, section, allergens, pack_qty, pack_unit, shelf_days)
  select i->>'slug', i->>'name', i->>'section', array(select jsonb_array_elements_text(i->'allergens')),
         (i->>'pack_qty')::numeric, i->>'pack_unit', (i->>'shelf_days')::integer
  from jsonb_array_elements(seed->'ingredients') i
  on conflict do nothing;

  update public.ingredients g
  set pack_qty = coalesce(g.pack_qty, (i->>'pack_qty')::numeric),
      pack_unit = case when g.pack_qty is null then i->>'pack_unit' else g.pack_unit end,
      shelf_days = coalesce(g.shelf_days, (i->>'shelf_days')::integer)
  from jsonb_array_elements(seed->'ingredients') i
  where g.slug = i->>'slug' and (g.pack_qty is null or g.shelf_days is null);

  insert into public.household_settings (household_id, settings)
  values (hid, seed->'settings')
  on conflict (household_id) do update set settings = excluded.settings;

  delete from public.recipes
  where household_id = hid
    and slug not in (select x->>'slug' from jsonb_array_elements(seed->'recipes') x);

  for r in select * from jsonb_array_elements(seed->'recipes') loop
    insert into public.recipes (household_id, slug, name, course, serves, active_mins, total_mins,
                                provides, spice, tags, source, rating, notes, is_example, created_by)
    values (hid, r->>'slug', r->>'name', r->>'course', (r->>'serves')::numeric,
            (r->>'active_mins')::integer, (r->>'total_mins')::integer,
            array(select jsonb_array_elements_text(r->'provides')), (r->>'spice')::smallint,
            array(select jsonb_array_elements_text(r->'tags')), r->>'source',
            (r->>'rating')::smallint, r->>'notes', true, null)
    on conflict (household_id, slug) do update
      set name = excluded.name, course = excluded.course, serves = excluded.serves,
          active_mins = excluded.active_mins, total_mins = excluded.total_mins,
          provides = excluded.provides, spice = excluded.spice, tags = excluded.tags,
          source = excluded.source, rating = excluded.rating, notes = excluded.notes,
          is_example = true
    returning id into rid;

    delete from public.recipe_ingredients where recipe_id = rid;
    insert into public.recipe_ingredients (recipe_id, position, ingredient_slug, qty, unit, note)
    select rid, n - 1, g.slug, (i->>'qty')::numeric, i->>'unit', i->>'note'
    from jsonb_array_elements(r->'ingredients') with ordinality as x(i, n)
    join public.ingredients g on g.name = i->>'name';

    delete from public.recipe_steps where recipe_id = rid;
    delete from public.recipe_methods where recipe_id = rid;
    insert into public.recipe_steps (recipe_id, position, text, timer_mins, optional, extra_mins, why)
    select rid, n - 1, s->>'text', (s->>'timer_mins')::integer, (s->>'optional')::boolean,
           (s->>'extra_mins')::integer, s->>'why'
    from jsonb_array_elements(r->'steps') with ordinality as x(s, n);
    insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
    select rs.id, ri.id
    from jsonb_array_elements(r->'steps') with ordinality as x(s, n)
    cross join jsonb_array_elements_text(s->'uses') u
    join public.recipe_steps rs on rs.recipe_id = rid and rs.method_id is null and rs.position = n - 1
    join public.recipe_ingredients ri on ri.recipe_id = rid and ri.position = u::integer;

    for m in select * from jsonb_array_elements(r->'methods') loop
      insert into public.recipe_methods (recipe_id, name, equipment, active_mins, total_mins)
      values (rid, m->>'name', m->>'equipment', (m->>'active_mins')::integer, (m->>'total_mins')::integer)
      returning id into mid;
      insert into public.recipe_steps (recipe_id, method_id, position, text, timer_mins, optional, extra_mins, why)
      select rid, mid, n - 1, s->>'text', (s->>'timer_mins')::integer, (s->>'optional')::boolean,
             (s->>'extra_mins')::integer, s->>'why'
      from jsonb_array_elements(m->'steps') with ordinality as x(s, n);
      insert into public.recipe_step_ingredients (step_id, recipe_ingredient_id)
      select rs.id, ri.id
      from jsonb_array_elements(m->'steps') with ordinality as x(s, n)
      cross join jsonb_array_elements_text(s->'uses') u
      join public.recipe_steps rs on rs.method_id = mid and rs.position = n - 1
      join public.recipe_ingredients ri on ri.recipe_id = rid and ri.position = u::integer;
    end loop;
  end loop;
end
$do$;
`;

writeFileSync(join(here, 'seed.sql'), sql);
console.log(`Wrote seed.sql: ${ingredients.length} ingredients, ${recipes.length} recipes`);
