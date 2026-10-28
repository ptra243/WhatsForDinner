// A week's plan: nights, their dishes and the checks the prototype shows (prototype/dinner-planner.html).
import type { Course, Recipe } from './recipes'
import { supabase } from './supabase'
import { DAYS, type Day } from './week'

export type MealRule = 'veg+carb' | 'veg' | 'off'

/** The household settings the week uses; missing values fall back to the defaults. */
export type Settings = { dinnerTime: string; minutes: Record<Day, number>; mealRule: MealRule }

export const DEFAULT_SETTINGS: Settings = {
  dinnerTime: '18:30',
  minutes: { mon: 45, tue: 45, wed: 45, thu: 45, fri: 45, sat: 120, sun: 120 },
  mealRule: 'veg+carb',
}

export type Dish = { id: string; recipeId: string; role: Course; servings: number; position: number }
export type Night = { dishes: Dish[]; cooked: boolean; skipCheck: boolean }
export type Week = Record<Day, Night>

export function emptyWeek(): Week {
  const week = {} as Week
  for (const d of DAYS) week[d] = { dishes: [], cooked: false, skipCheck: false }
  return week
}

/** A night with a dish added the way `addToNight` stores it: a main first with the others made sides, a side last. */
export function withDish(night: Night, dish: Omit<Dish, 'position'>): Night {
  if (dish.role === 'main') {
    const moved = night.dishes.map((d) => ({ ...d, position: d.position + 1, role: 'side' as const }))
    return { ...night, dishes: [{ ...dish, position: 0 }, ...moved] }
  }
  const position = night.dishes.length ? Math.max(...night.dishes.map((d) => d.position)) + 1 : 0
  return { ...night, dishes: [...night.dishes, { ...dish, position }] }
}

/**
 * Two nights after `move_night` swaps them: the dishes and the skip-check change places,
 * each night keeps its own cooked flag. Moving to an empty night is a swap with nothing.
 */
export function swapDinners(from: Night, to: Night): [Night, Night] {
  return [
    { ...from, dishes: to.dishes, skipCheck: to.skipCheck },
    { ...to, dishes: from.dishes, skipCheck: from.skipCheck },
  ]
}

/** A planned dish with its recipe (undefined when the recipe is gone). */
export type PlannedDish = Dish & { recipe?: Recipe }

export type NightInfo = {
  dishes: PlannedDish[]
  main?: PlannedDish
  sides: PlannedDish[]
  /** Hands-on minutes: the dishes' active minutes added up. */
  active: number
  /** Total minutes: the longest dish. */
  total: number
  /** What the meal rule wants and no dish provides. */
  gaps: ('veg' | 'carb')[]
  budget: number
  over: boolean
}

/** Times, gaps and the hands-on budget for one night. */
export function nightInfo(night: Night, day: Day, recipes: Map<string, Recipe>, settings: Settings): NightInfo {
  const dishes = night.dishes.map((d) => ({ ...d, recipe: recipes.get(d.recipeId) }))
  const main = dishes.find((d) => d.role === 'main') ?? dishes[0]
  const sides = dishes.filter((d) => d !== main)
  const provides = new Set<string>()
  let active = 0
  let total = 0
  for (const { recipe: r } of dishes) {
    if (!r) continue
    r.provides.forEach((p) => provides.add(p))
    active += r.activeMins ?? 0
    total = Math.max(total, r.totalMins ?? 0)
  }
  const gaps: NightInfo['gaps'] = []
  if (dishes.length && !night.skipCheck && settings.mealRule !== 'off') {
    if (!provides.has('veg')) gaps.push('veg')
    if (settings.mealRule === 'veg+carb' && !provides.has('carb')) gaps.push('carb')
  }
  const budget = settings.minutes[day]
  return { dishes, main, sides, active, total, gaps, budget, over: !!budget && active > budget }
}

/** When to start cooking to eat at dinner time: "5:45 pm". */
export function startBy(totalMins: number, dinnerTime: string): string {
  const [h, m] = (dinnerTime || DEFAULT_SETTINGS.dinnerTime).split(':').map(Number)
  const t = (((h * 60 + m - totalMins) % 1440) + 1440) % 1440
  const hh = Math.floor(t / 60)
  return `${((hh + 11) % 12) + 1}:${String(t % 60).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`
}

/** Up to three sides that fill a gap and are not on the night yet, best rated first. */
export function suggestSides(recipes: Recipe[], gaps: string[], dishes: Dish[]): Recipe[] {
  return recipes
    .filter((r) => r.course === 'side' && r.provides.some((p) => gaps.includes(p)) && !dishes.some((d) => d.recipeId === r.id))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 3)
}

/** Household settings with the defaults filled in. */
export function toSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const minutes = { ...DEFAULT_SETTINGS.minutes }
  if (s.minutes && typeof s.minutes === 'object') {
    for (const d of DAYS) {
      const v = (s.minutes as Record<string, unknown>)[d]
      if (typeof v === 'number') minutes[d] = v
    }
  }
  return {
    dinnerTime: typeof s.dinnerTime === 'string' && /^\d\d:\d\d$/.test(s.dinnerTime) ? s.dinnerTime : DEFAULT_SETTINGS.dinnerTime,
    minutes,
    mealRule: s.mealRule === 'veg' || s.mealRule === 'off' || s.mealRule === 'veg+carb' ? s.mealRule : DEFAULT_SETTINGS.mealRule,
  }
}

export async function loadSettings(householdId: string): Promise<Settings> {
  const { data, error } = await supabase.from('household_settings').select('settings').eq('household_id', householdId).maybeSingle()
  if (error) throw error
  return toSettings(data?.settings)
}

/** Every night of a week with its dishes in order. */
export async function loadWeek(householdId: string, weekStart: string): Promise<Week> {
  const [dishes, nights] = await Promise.all([
    supabase
      .from('meal_plan_dishes')
      .select('id, day, position, recipe_id, role, servings')
      .eq('household_id', householdId)
      .eq('week_start', weekStart)
      .order('position')
      .order('created_at'),
    supabase.from('meal_plan_nights').select('day, cooked, skip_check').eq('household_id', householdId).eq('week_start', weekStart),
  ])
  if (dishes.error) throw dishes.error
  if (nights.error) throw nights.error
  const week = emptyWeek()
  for (const d of dishes.data) {
    week[d.day as Day].dishes.push({
      id: d.id,
      recipeId: d.recipe_id,
      role: d.role as Course,
      servings: Number(d.servings),
      position: d.position,
    })
  }
  for (const n of nights.data) Object.assign(week[n.day as Day], { cooked: n.cooked, skipCheck: n.skip_check })
  return week
}

export async function setServings(dishId: string, servings: number): Promise<void> {
  const { error } = await supabase.from('meal_plan_dishes').update({ servings }).eq('id', dishId)
  if (error) throw error
}

export async function removeDish(dishId: string): Promise<void> {
  const { error } = await supabase.from('meal_plan_dishes').delete().eq('id', dishId)
  if (error) throw error
}

/**
 * Moves a night's dinner to another night in one write that succeeds or fails as a whole:
 * the dishes keep their role, position, servings and swaps, and a planned target night swaps
 * with it. The database refuses a cooked night either way.
 */
export async function moveNight(
  householdId: string,
  from: { week: string; day: Day },
  to: { week: string; day: Day },
): Promise<void> {
  const { error } = await supabase.rpc('move_night', {
    hid: householdId,
    from_week: from.week,
    from_day: from.day,
    to_week: to.week,
    to_day: to.day,
  })
  if (error) throw error
}

/** Sets a night's cooked or skip-check flag, making the night's row if there is none. */
export async function setNightFlags(
  householdId: string,
  weekStart: string,
  day: Day,
  flags: { cooked?: boolean; skip_check?: boolean },
): Promise<void> {
  const { error } = await supabase.from('meal_plan_nights').upsert({ household_id: householdId, week_start: weekStart, day, ...flags })
  if (error) throw error
}

/**
 * Calls `onChange` whenever a plan, night or recipe row changes, from this app or from
 * Claude. Row Level Security limits inserts and updates to the household; deletes carry
 * only the id, so any delete counts. Returns the unsubscribe.
 */
export function subscribePlan(householdId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`plan-${householdId}`)
  for (const table of ['meal_plan_dishes', 'meal_plan_nights', 'recipes']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
