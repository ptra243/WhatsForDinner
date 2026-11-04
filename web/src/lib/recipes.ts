import type { SaveRecipe } from './recipeForm'
import { supabase } from './supabase'
import { dayOf, weekStartOf, type Day } from './week'

export type Course = 'main' | 'side'

/**
 * `id`: the `recipe_ingredients` row, kept when the recipe is edited. `allergens`: what the
 * ingredient usually contains (`ingredients.allergens`); missing means none known.
 */
export type RecipeIngredient = {
  id?: string
  name: string
  qty: number | null
  unit: string
  note: string
  allergens?: string[]
}
export type RecipeStep = { id?: string; text: string; timerMins: number | null }

/**
 * Another way to cook a recipe (`recipe_methods`), with its own times and steps. `equipment`
 * is what it needs, as named in the household's settings; null when nothing special.
 */
export type RecipeMethod = {
  id: string
  name: string
  equipment: string | null
  activeMins: number | null
  totalMins: number | null
  steps: RecipeStep[]
}

/**
 * A household recipe with its ingredients and steps in order. Its times and `steps` are the
 * default method's; `methods` (none when missing) are the others, quickest first.
 */
export type Recipe = {
  id: string
  name: string
  course: Course
  serves: number
  activeMins: number | null
  totalMins: number | null
  provides: string[]
  /** 0–3; missing or null when not given. */
  spice?: number | null
  tags: string[]
  source: string
  rating: number | null
  notes: string
  isExample: boolean
  createdAt: string
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
  methods?: RecipeMethod[]
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

const RECIPE_COLUMNS =
  'id, name, course, serves, active_mins, total_mins, provides, spice, tags, source, rating, notes, is_example, created_at,' +
  ' recipe_ingredients(id, position, qty, unit, note, ingredients(name, allergens)), recipe_steps(id, position, text, timer_mins, method_id),' +
  ' recipe_methods(id, name, equipment, active_mins, total_mins)'

type RecipeRow = {
  id: string
  name: string
  course: Course
  serves: number
  active_mins: number | null
  total_mins: number | null
  provides: string[]
  spice: number | null
  tags: string[]
  source: string
  rating: number | null
  notes: string
  is_example: boolean
  created_at: string
  recipe_ingredients: {
    id: string
    position: number
    qty: number | null
    unit: string
    note: string
    ingredients: { name: string; allergens: string[] } | null
  }[]
  recipe_steps: { id: string; position: number; text: string; timer_mins: number | null; method_id: string | null }[]
  recipe_methods: { id: string; name: string; equipment: string | null; active_mins: number | null; total_mins: number | null }[]
}

/** A method's steps in order: the default method's when `methodId` is null. */
const stepsOf = (r: RecipeRow, methodId: string | null): RecipeStep[] =>
  r.recipe_steps
    .filter((s) => s.method_id === methodId)
    .sort(byPosition)
    .map((s) => ({ id: s.id, text: s.text, timerMins: s.timer_mins }))

const toRecipe = (r: RecipeRow): Recipe => ({
  id: r.id,
  name: r.name,
  course: r.course,
  serves: Number(r.serves),
  activeMins: r.active_mins,
  totalMins: r.total_mins,
  provides: r.provides,
  spice: r.spice,
  tags: r.tags,
  source: r.source,
  rating: r.rating,
  notes: r.notes,
  isExample: r.is_example,
  createdAt: r.created_at,
  ingredients: [...r.recipe_ingredients].sort(byPosition).map((i) => ({
    id: i.id,
    name: i.ingredients?.name ?? '',
    qty: i.qty == null ? null : Number(i.qty),
    unit: i.unit,
    note: i.note,
    allergens: i.ingredients?.allergens ?? [],
  })),
  steps: stepsOf(r, null),
  methods: (r.recipe_methods ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      equipment: m.equipment,
      activeMins: m.active_mins,
      totalMins: m.total_mins,
      steps: stepsOf(r, m.id),
    }))
    .sort((a, b) => (a.totalMins ?? 0) - (b.totalMins ?? 0) || a.name.localeCompare(b.name)),
})

/** Every recipe of the household, newest first, then by name. */
export async function loadRecipes(householdId: string): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .eq('household_id', householdId)
    .overrideTypes<RecipeRow[], { merge: false }>()
  if (error) throw error
  return data.map(toRecipe).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name))
}

/** One recipe, as `loadRecipes` gives it. */
export async function loadRecipe(id: string): Promise<Recipe> {
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .eq('id', id)
    .single()
    .overrideTypes<RecipeRow, { merge: false }>()
  if (error) throw error
  return toRecipe(data)
}

/** An ingredient on the shared list (`ingredients`). */
export type KnownIngredient = { name: string; section: string; allergens: string[] }

/** The shared ingredient list by name, a page at a time past the API row limit. */
export async function loadIngredients(): Promise<KnownIngredient[]> {
  const page = 1000
  const rows: KnownIngredient[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('name, section, allergens')
      .order('name')
      .range(from, from + page - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < page) return rows
  }
}

/** The household's recipe names, so the form can refuse a duplicate before saving. */
export async function loadRecipeNames(householdId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('recipes').select('id, name').eq('household_id', householdId)
  if (error) throw error
  return data
}

/**
 * Adds or edits a recipe with its ingredients and steps in one call (`save_recipe`), which
 * succeeds or fails as a whole. Returns the recipe's id.
 */
export async function saveRecipe(householdId: string, recipe: SaveRecipe): Promise<string> {
  const { data, error } = await supabase.rpc('save_recipe', { hid: householdId, recipe })
  if (error) throw error
  return data
}

/** Search by name, tag or ingredient within a course ('all' for both). */
export function matches(r: Recipe, query: string, course: Course | 'all'): boolean {
  if (course !== 'all' && r.course !== course) return false
  const q = query.toLowerCase().trim()
  if (!q) return true
  return (
    r.name.toLowerCase().includes(q) ||
    r.tags.some((t) => t.toLowerCase().includes(q)) ||
    r.ingredients.some((i) => i.name.toLowerCase().includes(q))
  )
}

export async function updateRecipe(id: string, patch: { rating?: number | null; notes?: string }): Promise<void> {
  const { error } = await supabase.from('recipes').update(patch).eq('id', id)
  if (error) throw error
}

/** Deletes the recipe; the database also takes it off any nights it is planned on. */
export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

/** The main dish's name on each night of a week, for picking a night. */
export async function loadWeekMains(householdId: string, weekStart: string): Promise<Partial<Record<Day, string>>> {
  const { data, error } = await supabase
    .from('meal_plan_dishes')
    .select('day, role, position, recipes(name)')
    .eq('household_id', householdId)
    .eq('week_start', weekStart)
    .order('position')
    .overrideTypes<{ day: Day; role: Course; position: number; recipes: { name: string } | null }[], { merge: false }>()
  if (error) throw error
  const mains: Partial<Record<Day, string>> = {}
  for (const d of data) if (d.role === 'main' && !mains[d.day]) mains[d.day] = d.recipes?.name ?? 'Missing recipe'
  return mains
}

/**
 * Plans the recipe on a night, at its usual serves unless `servings` is given. A main goes
 * first and the night's other mains become sides; a side goes last. `id` names the new dish,
 * so a dish shown before the write keeps its id once the row exists.
 */
export async function addToNight(
  householdId: string,
  recipe: Recipe,
  weekStart: string,
  day: Day,
  servings = recipe.serves,
  id?: string,
): Promise<void> {
  const night = { household_id: householdId, week_start: weekStart, day }
  const { data: dishes, error } = await supabase
    .from('meal_plan_dishes')
    .select('id, position, role')
    .match(night)
    .order('position')
  if (error) throw error

  const main = recipe.course === 'main'
  const position = main || !dishes.length ? 0 : Math.max(...dishes.map((d) => d.position)) + 1
  const { error: insertError } = await supabase
    .from('meal_plan_dishes')
    .insert({ ...night, ...(id ? { id } : {}), position, recipe_id: recipe.id, role: recipe.course, servings })
  if (insertError) throw insertError
  // Each write is a round trip, so the other dishes move down together rather than one after another.
  if (main) {
    const moved = await Promise.all(
      dishes.map((d) => supabase.from('meal_plan_dishes').update({ position: d.position + 1, role: 'side' }).eq('id', d.id)),
    )
    const failed = moved.find((r) => r.error)
    if (failed) throw failed.error
  }
}

/**
 * After cooking: if the recipe is planned on today's night, ticks that night as cooked.
 * Returns whether it did.
 */
export async function markCooked(householdId: string, recipeId: string, today = new Date()): Promise<boolean> {
  const night = { household_id: householdId, week_start: weekStartOf(today), day: dayOf(today) }
  const { data, error } = await supabase
    .from('meal_plan_dishes')
    .select('id')
    .match({ ...night, recipe_id: recipeId })
    .limit(1)
  if (error) throw error
  if (!data.length) return false
  const { error: upsertError } = await supabase.from('meal_plan_nights').upsert({ ...night, cooked: true })
  if (upsertError) throw upsertError
  return true
}
