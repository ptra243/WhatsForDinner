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

// The decline example gets the second suggestion, so both examples have an open one (#18).
const fill = (sql) =>
  sql
    .replaceAll("'<suggestion_id>'", sql.includes("status = 'declined'") ? ":'sid2'" : ":'sid'")
    .replaceAll("'<household_id>'", ":'hid'")
    .replaceAll("'<owner_id>'", ":'uid'")
    .replaceAll("'<week_start>'", ":'week'");

// The two allergen queries, found by what they read, so their results can be checked.
const avoidQueries = blocks.filter((b) => b.includes("settings->'avoid'"));
if (avoidQueries.length !== 2) throw new Error(`Expected 2 allergen queries in SKILL.md, found ${avoidQueries.length}`);
const [recipesWithAvoided, weekWithAvoided] = avoidQueries.map((b) => fill(b).replace(/;\s*$/, ''));

// The pairing query, run again once Monday is marked cooked.
const pairingQueries = blocks.filter((b) => b.includes('times_cooked'));
if (pairingQueries.length !== 1) throw new Error(`Expected 1 pairing query in SKILL.md, found ${pairingQueries.length}`);
const pairings = fill(pairingQueries[0]).replace(/;\s*$/, '');

// The votes query, checked against votes from both members (#17).
const voteQueries = blocks.filter((b) => b.includes('from recipe_votes'));
if (voteQueries.length !== 1) throw new Error(`Expected 1 votes query in SKILL.md, found ${voteQueries.length}`);
const weekVotes = fill(voteQueries[0]).replace(/;\s*$/, '');

// The open suggestions query, run again once both are handled (#18).
const suggestionQueries = blocks.filter((b) => b.includes('from suggestions'));
if (suggestionQueries.length !== 1) throw new Error(`Expected 1 open suggestions query in SKILL.md, found ${suggestionQueries.length}`);
const openSuggestions = fill(suggestionQueries[0]).replace(/;\s*$/, '');

// The query that finds the owner's household, so it can be checked with a member in the household (#16).
const ownerQueries = blocks.filter((b) => b.includes("m.role = 'owner'"));
if (ownerQueries.length !== 1) throw new Error(`Expected 1 owner household query in SKILL.md, found ${ownerQueries.length}`);
const ownerHousehold = fill(ownerQueries[0]).replace(/;\s*$/, '');

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

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'skill-owner@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'skill-member@example.test');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select public.create_household('Skill test') as hid \\gset
reset role;
insert into household_members (household_id, user_id, role) values (:'hid', '00000000-0000-4000-8000-0000000000c2', 'member');
select '00000000-0000-4000-8000-0000000000c1' as uid \\gset
select pg_temp.expect('owner household query with a member in the household',
  (select string_agg(owner_id::text, ',') from (${ownerHousehold}) q where household_id = :'hid'), :'uid'::text);
select '2026-11-02' as week \\gset
select count(*) as others from meal_plan_dishes \\gset
update household_settings set settings = settings || '{"avoid": ["egg", "milk"]}' where household_id = :'hid';
insert into recipe_votes (household_id, week_start, recipe_id, user_id, vote)
select :'hid', :'week', r.id, v.user_id::uuid, v.vote
from (values ('fish-tacos', '00000000-0000-4000-8000-0000000000c1', 1), ('fish-tacos', '00000000-0000-4000-8000-0000000000c2', 1),
             ('beef-ragu', '00000000-0000-4000-8000-0000000000c1', 1), ('beef-ragu', '00000000-0000-4000-8000-0000000000c2', -1),
             ('shakshuka', '00000000-0000-4000-8000-0000000000c2', 1)) as v(slug, user_id, vote)
join recipes r on r.household_id = :'hid' and r.slug = v.slug;
insert into recipe_votes (household_id, week_start, recipe_id, user_id, vote)
select :'hid', (:'week'::date + 7)::date, r.id, '00000000-0000-4000-8000-0000000000c1', -1
from recipes r where r.household_id = :'hid' and r.slug = 'fish-tacos';
insert into suggestions (household_id, created_by, name, description) values
  (:'hid', '00000000-0000-4000-8000-0000000000c2', 'Lemongrass chicken', 'The one from the Thai place')
returning id as sid \\gset
insert into suggestions (household_id, created_by, name, description) values
  (:'hid', '00000000-0000-4000-8000-0000000000c2', 'Pho', 'https://example.test/pho')
returning id as sid2 \\gset
select pg_temp.expect('both suggestions open, oldest first, with who made them',
  (select string_agg(name || ' by ' || suggested_by, ', ') from (${openSuggestions}) q), 'Lemongrass chicken by skill-member, Pho by skill-member');
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
select pg_temp.expect('no pairings before a night is cooked', (select count(*) from (${pairings}) q), 0::bigint);
insert into meal_plan_nights (household_id, week_start, day, cooked) values (:'hid', :'week', 'mon', true);
insert into meal_plan_nights (household_id, week_start, day, cooked) values (:'hid', (:'week'::date - 7 * 27)::date, 'mon', true);
insert into meal_plan_dishes (household_id, week_start, day, position, recipe_id, role, servings)
select household_id, (:'week'::date - 7 * 27)::date, day, position, recipe_id, role, servings
from meal_plan_dishes where household_id = :'hid' and week_start = :'week' and day = 'mon';
select pg_temp.expect('pairings from the cooked Monday, not the one 27 weeks back',
  (select string_agg(main || ' + ' || side || ' ' || times_cooked, ', ' order by side) from (${pairings}) q),
  'lemon-garlic-chicken + garlicky-green-beans 1, lemon-garlic-chicken + steamed-rice 1');
select pg_temp.expect('the week''s votes, the 👎 first and only that week',
  (select string_agg(slug || ' ' || likes || '/' || dislikes || ' ' || votes, '; ' order by dislikes desc, likes desc, slug) from (${weekVotes}) q),
  'beef-ragu 1/1 👎 skill-member, 👍 skill-owner; fish-tacos 2/0 👍 skill-member, 👍 skill-owner; shakshuka 1/0 👍 skill-member');
select pg_temp.expect('votes untouched by the skill', (select count(*) from recipe_votes where household_id = :'hid'), 6::bigint);
select pg_temp.expect('suggestion added with its recipe, the other declined',
  (select string_agg(s.name || ' ' || s.status || ' ' || coalesce(r.slug, '-') || ' ' || s.reply, '; ' order by s.name)
   from suggestions s left join recipes r on r.id = s.recipe_id where s.household_id = :'hid'),
  'Lemongrass chicken added lemongrass-chicken Added as Lemongrass chicken; Pho declined - No recipe in the link; send me one to add it');
select pg_temp.expect('no suggestions left open', (select count(*) from (${openSuggestions}) q), 0::bigint);
select pg_temp.expect('other households untouched',
  (select count(*) from meal_plan_dishes where household_id <> :'hid'), :others::bigint);

rollback;
\\o
\\echo 'All ${blocks.length} skill SQL examples ran'`);
