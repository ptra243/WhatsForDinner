import { supabase } from './supabase'
import type { Day } from './week'

export type Course = 'main' | 'side'

export type RecipeIngredient = { name: string; qty: number | null; unit: string; note: string }
export type RecipeStep = { text: string; timerMins: number | null }

/** A household recipe with its ingredients and steps in order. */
export type Recipe = {
  id: string
  name: string
  course: Course
  serves: number
  activeMins: number | null
  totalMins: number | null
  provides: string[]
  tags: string[]
  source: string
  rating: number | null
  notes: string
  isExample: boolean
  createdAt: string
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

/** Every recipe of the household, newest first, then by name. */
export async function loadRecipes(householdId: string): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select(
      'id, name, course, serves, active_mins, total_mins, provides, tags, source, rating, notes, is_example, created_at,' +
        ' recipe_ingredients(position, qty, unit, note, ingredients(name)), recipe_steps(position, text, timer_mins)',
    )
    .eq('household_id', householdId)
    .overrideTypes<
      {
        id: string
        name: string
        course: Course
        serves: number
        active_mins: number | null
        total_mins: number | null
        provides: string[]
        tags: string[]
        source: string
        rating: number | null
        notes: string
        is_example: boolean
        created_at: string
        recipe_ingredients: { position: number; qty: number | null; unit: string; note: string; ingredients: { name: string } | null }[]
        recipe_steps: { position: number; text: string; timer_mins: number | null }[]
      }[],
      { merge: false }
    >()
  if (error) throw error
  return data
    .map(
      (r): Recipe => ({
        id: r.id,
        name: r.name,
        course: r.course,
        serves: Number(r.serves),
        activeMins: r.active_mins,
        totalMins: r.total_mins,
        provides: r.provides,
        tags: r.tags,
        source: r.source,
        rating: r.rating,
        notes: r.notes,
        isExample: r.is_example,
        createdAt: r.created_at,
        ingredients: [...r.recipe_ingredients].sort(byPosition).map((i) => ({
          name: i.ingredients?.name ?? '',
          qty: i.qty == null ? null : Number(i.qty),
          unit: i.unit,
          note: i.note,
        })),
        steps: [...r.recipe_steps].sort(byPosition).map((s) => ({ text: s.text, timerMins: s.timer_mins })),
      }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name))
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
 * Plans the recipe on a night at its usual serves. A main goes first and the night's
 * other mains become sides; a side goes last.
 */
export async function addToNight(householdId: string, recipe: Recipe, weekStart: string, day: Day): Promise<void> {
  const night = { household_id: householdId, week_start: weekStart, day }
  const { data: dishes, error } = await supabase
    .from('meal_plan_dishes')
    .select('id, position, role')
    .match(night)
    .order('position')
  if (error) throw error

  let position = dishes.length ? Math.max(...dishes.map((d) => d.position)) + 1 : 0
  if (recipe.course === 'main') {
    position = 0
    for (const d of dishes) {
      const { error } = await supabase
        .from('meal_plan_dishes')
        .update({ position: d.position + 1, role: 'side' })
        .eq('id', d.id)
      if (error) throw error
    }
  }
  const { error: insertError } = await supabase
    .from('meal_plan_dishes')
    .insert({ ...night, position, recipe_id: recipe.id, role: recipe.course, servings: recipe.serves })
  if (insertError) throw insertError
}
