// Prints a psql script that runs every SQL example in the Dinner Planner skill, in order,
// against a new household made from the seeded examples, checks what they wrote, and rolls back.
// Usage (from the repo root): node supabase/tests/skill-sql.mjs | psql "$DB_URL" -v ON_ERROR_STOP=1

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = readFileSync(join(root, 'claude', 'dinner-planner', 'SKILL.md'), 'utf8');
const seed = readFileSync(join(root, 'supabase', 'seed', 'seed.sql'), 'utf8');

const blocks = [...skill.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1].trim());
if (blocks.length === 0) throw new Error('No SQL examples found in SKILL.md');

const fill = (sql) =>
  sql
    .replaceAll("'<household_id>'", ":'hid'")
    .replaceAll("'<owner_id>'", ":'uid'")
    .replaceAll("'<week_start>'", ":'week'");

// The two allergen queries, found by what they read, so their results can be checked.
const avoidQueries = blocks.filter((b) => b.includes("settings->'avoid'"));
if (avoidQueries.length !== 2) throw new Error(`Expected 2 allergen queries in SKILL.md, found ${avoidQueries.length}`);
const [recipesWithAvoided, weekWithAvoided] = avoidQueries.map((b) => fill(b).replace(/;\s*$/, ''));

console.log(`\\set QUIET on
\\o /dev/null
begin;

create function pg_temp.expect(what text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'Skill SQL check failed: % is %, expected %', what, got, want;
  end if;
end $$;

${seed}

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'skill-owner@example.test');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select public.create_household('Skill test') as hid \\gset
reset role;
select '00000000-0000-4000-8000-0000000000c1' as uid \\gset
select '2026-11-02' as week \\gset
select count(*) as others from meal_plan_dishes \\gset
update household_settings set settings = settings || '{"avoid": ["egg", "milk"]}' where household_id = :'hid';
`);

blocks.forEach((sql, i) => {
  console.log(`\\echo 'skill example ${i + 1} of ${blocks.length}'\n${fill(sql)}\n`);
});

console.log(`select pg_temp.expect('Monday dishes', (select count(*) from meal_plan_dishes where household_id = :'hid' and week_start = :'week' and day = 'mon'), 3::bigint);
select pg_temp.expect('swap on the main',
  (select d.swaps from meal_plan_dishes d join recipes r on r.id = d.recipe_id
   where d.household_id = :'hid' and d.day = 'mon' and r.slug = 'lemon-garlic-chicken'),
  '[{"from": "cream", "to": "evaporated milk", "qty": 200, "unit": "ml"}]'::jsonb);
select pg_temp.expect('new recipe ingredients',
  (select count(*) from recipe_ingredients ri join recipes r on r.id = ri.recipe_id
   where r.household_id = :'hid' and r.slug = 'lemongrass-chicken'), 5::bigint);
select pg_temp.expect('new recipe steps',
  (select count(*) from recipe_steps rs join recipes r on r.id = rs.recipe_id
   where r.household_id = :'hid' and r.slug = 'lemongrass-chicken'), 3::bigint);
select pg_temp.expect('new recipe owner',
  (select created_by from recipes where household_id = :'hid' and slug = 'lemongrass-chicken'), :'uid'::uuid);
select pg_temp.expect('ingredient allergens saved',
  (select allergens from ingredients where name = 'fish sauce'), array['fish']);
select pg_temp.expect('recipes with avoided allergens',
  (select count(*) from (${recipesWithAvoided}) q),
  (select count(*) from recipe_ingredients ri join recipes r on r.id = ri.recipe_id
   join ingredients i on i.slug = ri.ingredient_slug
   where r.household_id = :'hid' and i.allergens && array['egg', 'milk']));
select pg_temp.expect('week with avoided allergens: the swap to evaporated milk and the butter',
  (select string_agg(ingredient, ', ' order by ingredient) from (${weekWithAvoided}) q), 'butter, evaporated milk');
update meal_plan_dishes set swaps = '[{"from": "cream", "to": "coconut milk", "qty": null, "unit": null}]'
where household_id = :'hid' and week_start = :'week' and day = 'mon' and role = 'main';
select pg_temp.expect('week with avoided allergens: a swap without them clears it',
  (select string_agg(ingredient, ', ' order by ingredient) from (${weekWithAvoided}) q), 'butter');
select pg_temp.expect('other households untouched',
  (select count(*) from meal_plan_dishes where household_id <> :'hid'), :others::bigint);

rollback;
\\o
\\echo 'All ${blocks.length} skill SQL examples ran'`);
