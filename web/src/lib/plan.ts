// A week's plan: nights, their dishes and the checks the prototype shows (prototype/dinner-planner.html).
import { allergenWarnings, toAllergens, type Allergen, type AllergenWarning, type TaggedSwap } from './allergens'
import { methodOf } from './methods'
import type { Course, Recipe } from './recipes'
import { toSwaps } from './shop'
import { supabase } from './supabase'
import { DAYS, type Day } from './week'

export type MealRule = 'veg+carb' | 'veg' | 'off'

/**
 * The household settings the week uses; missing values fall back to the defaults. `equipment`
 * decides which of a recipe's methods a night offers.
 */
export type Settings = {
  dinnerTime: string
  minutes: Record<Day, number>
  mealRule: MealRule
  avoid: Allergen[]
  equipment: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  dinnerTime: '18:30',
  minutes: { mon: 45, tue: 45, wed: 45, thu: 45, fri: 45, sat: 120, sun: 120 },
  mealRule: 'veg+carb',
  avoid: [],
  equipment: [],
}

/**
 * `swaps` (none when missing) carry the allergens of what each swaps to. `methodId` is the
 * recipe method it is cooked by; missing or null is the recipe's default.
 */
export type Dish = {
  id: string
  recipeId: string
  role: Course
  servings: number
  position: number
  swaps?: TaggedSwap[]
  methodId?: string | null
}
/**
 * `minutes` is this night's own hands-on time (null = the weekday's setting); `locked` asks
 * Claude to leave the night's dishes alone when replanning.
 */
export type Night = { dishes: Dish[]; cooked: boolean; skipCheck: boolean; minutes: number | null; locked: boolean }
export type Week = Record<Day, Night>

export function emptyWeek(): Week {
  const week = {} as Week
  for (const d of DAYS) week[d] = { dishes: [], cooked: false, skipCheck: false, minutes: null, locked: false }
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
 * Two nights after `move_night` swaps them: the dishes, the skip-check and the lock change
 * places; each night keeps its own cooked flag and time override. Moving to an empty night is
 * a swap with nothing.
 */
export function swapDinners(from: Night, to: Night): [Night, Night] {
  return [
    { ...from, dishes: to.dishes, skipCheck: to.skipCheck, locked: to.locked },
    { ...to, dishes: from.dishes, skipCheck: from.skipCheck, locked: from.locked },
  ]
}

/** A planned dish with its recipe (undefined when the recipe is gone) and the avoided allergens it still contains. */
export type PlannedDish = Dish & { recipe?: Recipe; allergens: AllergenWarning[] }

export type NightInfo = {
  dishes: PlannedDish[]
  main?: PlannedDish
  sides: PlannedDish[]
  /** Hands-on minutes: the dishes' active minutes (by their chosen methods) added up. */
  active: number
  /** Total minutes: the longest dish. */
  total: number
  /** What the meal rule wants and no dish provides. */
  gaps: ('veg' | 'carb')[]
  /** Hands-on minutes allowed: the night's override, else the weekday's setting. */
  budget: number
  /** Whether `budget` is the night's own override. */
  override: boolean
  over: boolean
  /** Avoided allergens some dish still contains (no swap clears them), in list order. */
  allergens: Allergen[]
}

/** Times, gaps, the hands-on budget and avoided allergens for one night. */
export function nightInfo(night: Night, day: Day, recipes: Map<string, Recipe>, settings: Settings): NightInfo {
  const dishes = night.dishes.map((d) => {
    const recipe = recipes.get(d.recipeId)
    return { ...d, recipe, allergens: recipe ? allergenWarnings(recipe.ingredients, settings.avoid, d.swaps) : [] }
  })
  const allergens = toAllergens(dishes.flatMap((d) => d.allergens.map((w) => w.allergen)))
  const main = dishes.find((d) => d.role === 'main') ?? dishes[0]
  const sides = dishes.filter((d) => d !== main)
  const provides = new Set<string>()
  let active = 0
  let total = 0
  for (const { recipe: r, methodId } of dishes) {
    if (!r) continue
    r.provides.forEach((p) => provides.add(p))
    const m = methodOf(r, methodId)
    active += m.activeMins ?? 0
    total = Math.max(total, m.totalMins ?? 0)
  }
  const gaps: NightInfo['gaps'] = []
  if (dishes.length && !night.skipCheck && settings.mealRule !== 'off') {
    if (!provides.has('veg')) gaps.push('veg')
    if (settings.mealRule === 'veg+carb' && !provides.has('carb')) gaps.push('carb')
  }
  const override = night.minutes != null
  const budget = night.minutes ?? settings.minutes[day]
  return { dishes, main, sides, active, total, gaps, budget, override, over: !!budget && active > budget, allergens }
}

/** When to start cooking to eat at dinner time: "5:45 pm". */
export function startBy(totalMins: number, dinnerTime: string): string {
  const [h, m] = (dinnerTime || DEFAULT_SETTINGS.dinnerTime).split(':').map(Number)
  const t = (((h * 60 + m - totalMins) % 1440) + 1440) % 1440
  const hh = Math.floor(t / 60)
  return `${((hh + 11) % 12) + 1}:${String(t % 60).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`
}

/** A cooked night's dishes, in order: all a pairing needs. */
export type CookedNight = Pick<Dish, 'recipeId' | 'role'>[]

/** A side and how many cooked nights it was eaten with a main. */
export type Pairing = { recipeId: string; count: number }

/**
 * The sides cooked with a main, most often first; ties keep the order of `cooked` (newest
 * first from `loadCookedNights`). A night counts a side once, and only nights with a main count.
 */
export function pairedSides(cooked: CookedNight[], mainId: string): Pairing[] {
  const counts = new Map<string, number>()
  for (const dishes of cooked) {
    if (dishes.find((d) => d.role === 'main')?.recipeId !== mainId) continue
    for (const id of new Set(dishes.filter((d) => d.role === 'side').map((d) => d.recipeId))) {
      if (id !== mainId) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts].map(([recipeId, count]) => ({ recipeId, count })).sort((a, b) => b.count - a.count)
}

/** Up to three of a main's usual sides that are saved and not on the night yet, with their recipes. */
export function usualSides(paired: Pairing[], recipes: Map<string, Recipe>, dishes: Dish[]): (Pairing & { recipe: Recipe })[] {
  return paired
    .flatMap((p) => {
      const recipe = recipes.get(p.recipeId)
      return recipe?.course === 'side' && !dishes.some((d) => d.recipeId === p.recipeId) ? [{ ...p, recipe }] : []
    })
    .slice(0, 3)
}

/**
 * Up to three sides that fill a gap and are not on the night yet: those cooked with the main
 * most often first, then best rated. Sides in `shown` (the usual sides already offered) are left out.
 */
export function suggestSides(
  recipes: Recipe[],
  gaps: string[],
  dishes: Dish[],
  paired: Pairing[] = [],
  shown: string[] = [],
): Recipe[] {
  const count = new Map(paired.map((p) => [p.recipeId, p.count]))
  return recipes
    .filter(
      (r) =>
        r.course === 'side' &&
        r.provides.some((p) => gaps.includes(p)) &&
        !dishes.some((d) => d.recipeId === r.id) &&
        !shown.includes(r.id),
    )
    .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
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
    avoid: toAllergens(s.avoid),
    equipment: Array.isArray(s.equipment) ? s.equipment.filter((e): e is string => typeof e === 'string') : [],
  }
}

export async function loadSettings(householdId: string): Promise<Settings> {
  const { data, error } = await supabase.from('household_settings').select('settings').eq('household_id', householdId).maybeSingle()
  if (error) throw error
  return toSettings(data?.settings)
}

/** Every night of a week with its dishes in order, each swap tagged with the allergens of what it swaps to. */
export async function loadWeek(householdId: string, weekStart: string): Promise<Week> {
  const [dishes, nights] = await Promise.all([
    supabase
      .from('meal_plan_dishes')
      .select('id, day, position, recipe_id, role, servings, swaps, method_id')
      .eq('household_id', householdId)
      .eq('week_start', weekStart)
      .order('position')
      .order('created_at'),
    supabase.from('meal_plan_nights').select('day, cooked, skip_check, minutes, locked').eq('household_id', householdId).eq('week_start', weekStart),
  ])
  if (dishes.error) throw dishes.error
  if (nights.error) throw nights.error
  const swaps = new Map(dishes.data.map((d) => [d.id, toSwaps(d.swaps)]))
  const targets = [...new Set([...swaps.values()].flat().map((s) => s.to.toLowerCase().trim()))]
  const tags = new Map<string, string[]>()
  if (targets.length) {
    const { data, error } = await supabase.from('ingredients').select('name, allergens').in('name', targets)
    if (error) throw error
    for (const i of data) tags.set(i.name, i.allergens)
  }
  const week = emptyWeek()
  for (const d of dishes.data) {
    week[d.day as Day].dishes.push({
      id: d.id,
      recipeId: d.recipe_id,
      role: d.role as Course,
      servings: Number(d.servings),
      position: d.position,
      swaps: swaps.get(d.id)!.map((s) => ({ ...s, allergens: tags.get(s.to.toLowerCase().trim()) ?? [] })),
      methodId: d.method_id,
    })
  }
  for (const n of nights.data) Object.assign(week[n.day as Day], { cooked: n.cooked, skipCheck: n.skip_check, minutes: n.minutes, locked: n.locked })
  return week
}

/**
 * The dishes of every night marked cooked from the week starting `since`, newest night first.
 * Pairings are worked out from these; nothing about them is stored.
 */
export async function loadCookedNights(householdId: string, since: string): Promise<CookedNight[]> {
  const [nights, dishes] = await Promise.all([
    supabase.from('meal_plan_nights').select('week_start, day').eq('household_id', householdId).eq('cooked', true).gte('week_start', since),
    supabase
      .from('meal_plan_dishes')
      .select('week_start, day, recipe_id, role')
      .eq('household_id', householdId)
      .gte('week_start', since)
      .order('position')
      .order('created_at'),
  ])
  if (nights.error) throw nights.error
  if (dishes.error) throw dishes.error
  const key = (n: { week_start: string; day: string }) => `${n.week_start} ${DAYS.indexOf(n.day as Day)}`
  const byNight = new Map<string, CookedNight>(nights.data.map((n) => [key(n), []]))
  for (const d of dishes.data) byNight.get(key(d))?.push({ recipeId: d.recipe_id, role: d.role as Course })
  return [...byNight].sort(([a], [b]) => b.localeCompare(a)).map(([, n]) => n)
}

export async function setServings(dishId: string, servings: number): Promise<void> {
  const { error } = await supabase.from('meal_plan_dishes').update({ servings }).eq('id', dishId)
  if (error) throw error
}

/** Cooks a planned dish by one of its recipe's methods, or the default with null. */
export async function setDishMethod(dishId: string, methodId: string | null): Promise<void> {
  const { error } = await supabase.from('meal_plan_dishes').update({ method_id: methodId }).eq('id', dishId)
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

/**
 * Sets a night's cooked, skip-check or lock flag or its time override (null = the weekday's
 * setting), making the night's row if there is none.
 */
export async function setNightFlags(
  householdId: string,
  weekStart: string,
  day: Day,
  flags: { cooked?: boolean; skip_check?: boolean; locked?: boolean; minutes?: number | null },
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
