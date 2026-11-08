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

// The methods query, checked once the dal has its pressure cooker method too (#24).
const methodQueries = blocks.filter((b) => b.includes('household_has_it'));
if (methodQueries.length !== 1) throw new Error(`Expected 1 methods query in SKILL.md, found ${methodQueries.length}`);
const recipeMethods = fill(methodQueries[0]).replace(/;s*$/, '');

// The read-a-week query, checked for the method a dish is cooked by.
const weekQueries = blocks.filter((b) => b.includes('as method,') && b.includes('coalesce(m.total_mins'));
if (weekQueries.length !== 1) throw new Error(`Expected 1 read-a-week query in SKILL.md, found ${weekQueries.length}`);
const readWeek = fill(weekQueries[0]).replace(/;s*$/, '');

// The nights query (#70), checked with a night that has its own time and a lock.
const nightQueries = blocks.filter((b) => b.includes('own_time'));
if (nightQueries.length !== 1) throw new Error(`Expected 1 nights query in SKILL.md, found ${nightQueries.length}`);
const weekNights = fill(nightQueries[0]).replace(/;s*$/, '');

// The ingredients missing a pack size or shelf life (#25), checked before and after the fill example.
const gapQueries = blocks.filter((b) => b.includes('i.pack_qty is null or i.shelf_days is null') && b.startsWith('select'));
if (gapQueries.length !== 1) throw new Error(`Expected 1 missing pack size query in SKILL.md, found ${gapQueries.length}`);
const packGaps = fill(gapQueries[0]).replace(/;s*$/, '');

// The step link queries (#65): methods with no links, checked before and after the backfill
// example, and ingredients no step uses.
const unlinkedQueries = blocks.filter((b) => b.includes('having count(l.step_id) = 0'));
if (unlinkedQueries.length !== 1) throw new Error(`Expected 1 unlinked steps query in SKILL.md, found ${unlinkedQueries.length}`);
const unlinked = fill(unlinkedQueries[0]).replace(/;\s*$/, '');
const unusedQueries = blocks.filter((b) => b.includes('l.recipe_ingredient_id = ri.id') && b.startsWith('select'));
if (unusedQueries.length !== 1) throw new Error(`Expected 1 unused ingredients query in SKILL.md, found ${unusedQueries.length}`);
const unused = fill(unusedQueries[0]).replace(/;\s*$/, '');

// The items to price (#84), checked before and after the example that saves prices.
const priceQueries = blocks.filter((b) => b.includes('as cached'));
if (priceQueries.length !== 1) throw new Error(`Expected 1 items to price query in SKILL.md, found ${priceQueries.length}`);
const priceItems = fill(priceQueries[0]).replace(/;\s*$/, '');

// The pantry query (#19), checked with items near, far from and without a best-before.
const pantryQueries = blocks.filter((b) => b.includes('from pantry_items'));
if (pantryQueries.length !== 1) throw new Error(`Expected 1 pantry query in SKILL.md, found ${pantryQueries.length}`);
const pantry = fill(pantryQueries[0]).replace(/;\s*$/, '');

// The extras query (#56), checked before and after the example that chooses one.
const extrasQueries = blocks.filter((b) => b.includes('as chosen'));
if (extrasQueries.length !== 1) throw new Error(`Expected 1 extras query in SKILL.md, found ${extrasQueries.length}`);
const weekExtras = fill(extrasQueries[0]).replace(/;\s*$/, '');

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
-- Beef ragù on Tuesday, for the example that cooks it by its pressure cooker method (#24).
insert into meal_plan_dishes (household_id, week_start, day, position, recipe_id, role, servings)
select :'hid', :'week', 'tue', 0, r.id, 'main', 6 from recipes r where r.household_id = :'hid' and r.slug = 'beef-ragu';
-- Wednesday has its own 20 minutes and is locked; Thursday's override is cleared (#70).
insert into meal_plan_nights (household_id, week_start, day, minutes, locked) values
  (:'hid', :'week', 'wed', 20, true), (:'hid', :'week', 'thu', null, false);
select pg_temp.expect('the week''s nights, each with its minutes and lock',
  (select string_agg(day || ' ' || minutes || ' ' || own_time || ' ' || locked, ', ') from (${weekNights}) q),
  'mon 45 false false, tue 45 false false, wed 20 true true, thu 45 false false, fri 45 false false, sat 120 false false, sun 120 false false');
-- The pantry: beef chuck needs using tomorrow, crushed tomato keeps, lemon has no date and isn't in the ragù (#19).
insert into pantry_items (household_id, ingredient_slug, qty, unit, location, best_before)
select :'hid', i.slug, v.qty, v.unit, v.location, current_date + v.days
from (values ('crushed tomato', 800::numeric, 'g', 'pantry', 400), ('beef chuck', 500, 'g', 'fridge', 1), ('lemon', null, 'each', 'fridge', null))
  as v(name, qty, unit, location, days)
join ingredients i on i.name = v.name;
select pg_temp.expect('the pantry, soonest best-before first, with whether the ragù uses each',
  (select string_agg(name || ' ' || coalesce(days_left::text, '-') || ' ' || ('beef-ragu' = any(recipes)), ', ') from (${pantry}) q),
  'beef chuck 1 true, crushed tomato 400 true, lemon - false');
-- Honey has a pack size the household set but no shelf life, for the fill example (#25).
update ingredients set pack_qty = 250, pack_unit = 'g', shelf_days = null where name = 'honey';
select pg_temp.expect('ingredients missing a pack size or shelf life',
  (select string_agg(name || ' ' || recipes, ', ') from (${packGaps}) q), 'honey 1');
-- The roast potatoes lose their step links, for the backfill example (#65).
select pg_temp.expect('every example linked', (select count(*) from (${unlinked}) q), 0::bigint);
delete from recipe_step_ingredients l using recipe_steps s, recipes r
where s.id = l.step_id and r.id = s.recipe_id and r.household_id = :'hid' and r.slug = 'roast-potatoes';
select pg_temp.expect('methods with no step links',
  (select string_agg(slug || ' ' || method || ' ' || steps, ', ') from (${unlinked}) q), 'roast-potatoes Usual way 2');
select pg_temp.expect('ingredients no step uses',
  (select string_agg(ingredient, ', ') from (${unused}) q), 'potato, olive oil, rosemary');
-- Lemons and dish soap added by hand: lemon is an ingredient and is priced, dish soap isn't (#84).
insert into list_extras (household_id, week_start, name, qty, unit, section) values
  (:'hid', :'week', 'lemon', 3, 'each', 'fruit and veg'), (:'hid', :'week', 'dish soap', 1, 'each', 'other');
-- A Grocerly price from its refresh four days ago is cached; one from a refresh eight days ago isn't.
insert into ingredient_prices (household_id, ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price, source_updated_on)
select :'hid', i.slug, 'coles', 'grocerly', current_date - 3, 'Coles ' || i.name, 500, 'g', 5, current_date - 4
from ingredients i where i.name = 'beef chuck';
insert into ingredient_prices (household_id, ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price, source_updated_on)
select :'hid', i.slug, 'coles', 'grocerly', current_date - 6, 'Coles ' || i.name, 1, 'each', 2, current_date - 8
from ingredients i where i.name = 'onion';
select pg_temp.expect('Tuesday''s items to price, staples left out, with what is cached',
  (select string_agg(name || ' ' || qty::numeric(10, 2) || ' ' || unit || ' [' || array_to_string(cached, ',') || ']', ', ') from (${priceItems}) q),
  'beef chuck 1000.00 g [coles grocerly], carrot 2.00 each [], celery 2.00 each [], crushed tomato 800.00 g [], garlic clove 4.00 each [], lemon 3.00 each [], onion 1.00 each [], red wine 250.00 ml [], tomato paste 2.00 tbsp []');
-- Pork stir-fry on Friday, with its optional velveting step not chosen yet: the cornflour only
-- that step uses isn't priced (#56).
insert into meal_plan_dishes (household_id, week_start, day, position, recipe_id, role, servings)
select :'hid', :'week', 'fri', 0, r.id, 'main', 4 from recipes r where r.household_id = :'hid' and r.slug = 'pork-cabbage-stir-fry';
select pg_temp.expect('the week''s extras, none chosen',
  (select string_agg(day || ' ' || slug || ' ' || position || ' ' || extra_mins || ' ' || chosen, ', ') from (${weekExtras}) q),
  'fri pork-cabbage-stir-fry 1 5 false');
select pg_temp.expect('the cornflour only an unchosen extra uses is not priced',
  (select count(*) from (${priceItems}) q where name = 'cornflour'), 0::bigint);
select pg_temp.expect('the soy sauce a required step also uses is still on the list',
  (select count(*) from meal_plan_dishes d join recipe_ingredients ri on ri.recipe_id = d.recipe_id
   join ingredients i on i.slug = ri.ingredient_slug where d.household_id = :'hid' and d.day = 'fri' and i.name = 'soy sauce'), 1::bigint);
select pg_temp.expect('both suggestions open, oldest first, with who made them',
  (select string_agg(name || ' by ' || suggested_by, ', ') from (${openSuggestions}) q), 'Lemongrass chicken by skill-member, Pho by skill-member');
`);

blocks.forEach((sql, i) => {
  console.log(`\\echo 'skill example ${i + 1} of ${blocks.length}'\n${fill(sql)}\n`);
});

console.log(`select pg_temp.expect('Friday''s extra chosen, by the extras query',
  (select string_agg(position || ' ' || chosen, ', ') from (${weekExtras}) q where day = 'fri'), '1 true');
select pg_temp.expect('Friday''s extra and its minutes, by the read-a-week query',
  (select string_agg(name || ' [' || array_to_string(extras, '; ') || '] ' || extra_mins, ', ') from (${readWeek}) q where day = 'fri'),
  'Pork and cabbage stir-fry [Velvet the pork: toss the mince with the cornflour and 1 tbsp of the soy sauce, and leave it while the noodles cook.] 5');
select pg_temp.expect('the cornflour priced once its extra is chosen',
  (select string_agg(name || ' ' || qty::numeric(10, 2) || ' ' || unit, ', ') from (${priceItems}) q where name = 'cornflour'), 'cornflour 1.00 tbsp');
select pg_temp.expect('the new recipe''s optional step',
  (select string_agg(s.position || ' ' || s.optional || ' ' || coalesce(s.extra_mins::text, '-') || ' ' || coalesce(nullif(s.why, ''), '-'), ', ' order by s.position)
   from recipe_steps s join recipes r on r.id = s.recipe_id where r.household_id = :'hid' and r.slug = 'lemongrass-chicken'),
  '0 false - -, 1 true 15 more flavour, more tender, 2 false - -');
-- Friday's stir-fry has egg noodles, which the household avoids: take it off before the allergen checks.
delete from meal_plan_dishes where household_id = :'hid' and week_start = :'week' and day = 'fri';
select pg_temp.expect('Monday dishes', (select count(*) from meal_plan_dishes where household_id = :'hid' and week_start = :'week' and day = 'mon'), 3::bigint);
select pg_temp.expect('the week''s chicken and lemons priced and cached, with each store''s latest',
  (select string_agg(name || ' ' || qty::numeric(10, 2) || ' ' || unit || ' [' || array_to_string(cached, ',') || '] ' || array_to_string(latest, ', '), '; ')
   from (${priceItems}) q where name in ('chicken thigh', 'lemon', 'evaporated milk', 'beef chuck')),
  'beef chuck 1000.00 g [coles grocerly] coles $5.00 (500 g); '
  || 'chicken thigh 600.00 g [aldi whichgrocer,coles whichgrocer,woolworths whichgrocer] aldi –, coles $13.00 (1 kg) $13.00/kg, woolworths $7.50 (500 g) $15.00/kg special; '
  || 'evaporated milk 200.00 ml [] ; '
  || 'lemon 5.00 each [aldi whichgrocer,coles whichgrocer,woolworths whichgrocer] aldi $3.49 (500 g) $6.98/kg, coles $0.90 (1 each) $0.90/each, woolworths $1.00 (1 each) $1.00/each');
select pg_temp.expect('prices saved for the household, a not found row with no price',
  (select string_agg(store || ' ' || coalesce(price::text, '-'), ', ' order by store) from ingredient_prices p
   join ingredients i on i.slug = p.ingredient_slug where p.household_id = :'hid' and i.name = 'chicken thigh'),
  'aldi -, coles 13.00, woolworths 7.50');
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
select pg_temp.expect('new recipe step links',
  (select string_agg(s.position || ' ' || i.name, ', ' order by s.position, ri.position)
   from recipe_step_ingredients l join recipe_steps s on s.id = l.step_id
   join recipe_ingredients ri on ri.id = l.recipe_ingredient_id join ingredients i on i.slug = ri.ingredient_slug
   join recipes r on r.id = s.recipe_id where r.household_id = :'hid' and r.slug = 'lemongrass-chicken'),
  '0 chicken thigh, 0 lemongrass, 0 garlic clove, 0 fish sauce, 2 olive oil');
select pg_temp.expect('the dal''s new method step links',
  (select count(*) from recipe_step_ingredients l join recipe_steps s on s.id = l.step_id
   join recipe_methods m on m.id = s.method_id join recipes r on r.id = m.recipe_id
   where r.household_id = :'hid' and r.slug = 'red-lentil-dal'), 9::bigint);
select pg_temp.expect('backfilled roast potatoes',
  (select string_agg(s.position || ' ' || i.name, ', ' order by s.position, ri.position)
   from recipe_step_ingredients l join recipe_steps s on s.id = l.step_id
   join recipe_ingredients ri on ri.id = l.recipe_ingredient_id join ingredients i on i.slug = ri.ingredient_slug
   join recipes r on r.id = s.recipe_id where r.household_id = :'hid' and r.slug = 'roast-potatoes'),
  '0 potato, 1 olive oil, 1 rosemary');
select pg_temp.expect('no methods left with no step links', (select count(*) from (${unlinked}) q), 0::bigint);
select pg_temp.expect('every ingredient used by a step', (select count(*) from (${unused}) q), 0::bigint);
select pg_temp.expect('new recipe owner',
  (select created_by from recipes where household_id = :'hid' and slug = 'lemongrass-chicken'), :'uid'::uuid);
select pg_temp.expect('new ingredients with pack size and shelf life',
  (select string_agg(name || ' ' || pack_qty || ' ' || pack_unit || ' ' || shelf_days, ', ' order by name) from ingredients
   where name in ('fish sauce', 'lemongrass', 'evaporated milk')),
  'evaporated milk 375 ml 365, fish sauce 200 ml 730, lemongrass 1 each 14');
select pg_temp.expect('gaps filled, keeping the pack size the household set',
  (select pack_qty || ' ' || pack_unit || ' ' || shelf_days from ingredients where name = 'honey'), '250 g 730');
select pg_temp.expect('no ingredients missing a pack size or shelf life', (select count(*) from (${packGaps}) q), 0::bigint);
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
select pg_temp.expect('pantry untouched by the skill', (select count(*) from pantry_items where household_id = :'hid'), 3::bigint);
select pg_temp.expect('votes untouched by the skill', (select count(*) from recipe_votes where household_id = :'hid'), 6::bigint);
select pg_temp.expect('suggestion added with its recipe, the other declined',
  (select string_agg(s.name || ' ' || s.status || ' ' || coalesce(r.slug, '-') || ' ' || s.reply, '; ' order by s.name)
   from suggestions s left join recipes r on r.id = s.recipe_id where s.household_id = :'hid'),
  'Lemongrass chicken added lemongrass-chicken Added as Lemongrass chicken; Pho declined - No recipe in the link; send me one to add it');
select pg_temp.expect('no suggestions left open', (select count(*) from (${openSuggestions}) q), 0::bigint);
select pg_temp.expect('Tuesday''s ragù in the pressure cooker, by the read-a-week query',
  (select string_agg(name || ' ' || coalesce(method, '-') || ' ' || total_mins, ', ') from (${readWeek}) q where day = 'tue'),
  'Beef ragù Pressure cooker 80');
select pg_temp.expect('Monday''s dishes the usual way',
  (select count(*) from (${readWeek}) q where day = 'mon' and method is null), 3::bigint);
select pg_temp.expect('methods, with the household''s equipment',
  (select string_agg(slug || ' ' || method || ' ' || total_mins || ' ' || household_has_it, ', ' order by slug) from (${recipeMethods}) q),
  'beef-ragu Pressure cooker 80 true, red-lentil-dal Pressure cooker 25 true');
select pg_temp.expect('the dal''s new method steps',
  (select count(*) from recipe_steps s join recipe_methods m on m.id = s.method_id join recipes r on r.id = m.recipe_id
   where r.household_id = :'hid' and r.slug = 'red-lentil-dal'), 3::bigint);
update household_settings set settings = settings || '{"equipment": []}' where household_id = :'hid';
select pg_temp.expect('methods without the equipment',
  (select count(*) from (${recipeMethods}) q where household_has_it), 0::bigint);
select pg_temp.expect('other households untouched',
  (select count(*) from meal_plan_dishes where household_id <> :'hid'), :others::bigint);

rollback;
\\o
\\echo 'All ${blocks.length} skill SQL examples ran'`);
