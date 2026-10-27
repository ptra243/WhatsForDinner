// Prints the row counts the seed should load, as psql variables for seed.sql.
// Usage: psql "$DB_URL" $(node supabase/tests/seed-counts.mjs) -f supabase/tests/seed.sql

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
const readJson = (...p) => JSON.parse(readFileSync(join(seedDir, ...p), 'utf8'));

const recipes = readdirSync(join(seedDir, 'recipes')).filter((f) => f.endsWith('.json')).map((f) => readJson('recipes', f));
const counts = {
  ingredients: Object.keys(readJson('meta', 'ingredients.json').items).length,
  recipes: recipes.length,
  recipe_ingredients: recipes.reduce((n, r) => n + r.ingredients.length, 0),
  steps: recipes.reduce((n, r) => n + r.steps.length, 0),
  settings_keys: Object.keys(readJson('meta', 'household.json')).length,
};
console.log(Object.entries(counts).map(([k, v]) => `-v ${k}=${v}`).join(' '));
