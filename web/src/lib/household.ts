// Household settings, the JSON export and clearing the example recipes.
import { DEFAULT_SETTINGS, toSettings, type Settings } from './plan'
import { supabase } from './supabase'
import type { Json } from './database.types'

/** Everything in the settings sheet: what the week uses plus what Claude plans with. */
export type HouseholdSettings = Settings & { notes: string; equipment: string[] }

export const DEFAULT_HOUSEHOLD_SETTINGS: HouseholdSettings = { ...DEFAULT_SETTINGS, notes: '', equipment: [] }

/** Household settings with the defaults filled in. */
export function toHouseholdSettings(raw: unknown): HouseholdSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as { notes?: unknown; equipment?: unknown }
  return {
    ...toSettings(raw),
    notes: typeof s.notes === 'string' ? s.notes : '',
    equipment: Array.isArray(s.equipment) ? s.equipment.filter((e): e is string => typeof e === 'string') : [],
  }
}

/** "pressure cooker, slow cooker" → ['pressure cooker', 'slow cooker'] */
export function parseEquipment(text: string): string[] {
  return text
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
}

async function loadRawSettings(householdId: string): Promise<Record<string, Json | undefined>> {
  const { data, error } = await supabase.from('household_settings').select('settings').eq('household_id', householdId).maybeSingle()
  if (error) throw error
  const s = data?.settings
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {}
}

export async function loadHouseholdSettings(householdId: string): Promise<HouseholdSettings> {
  return toHouseholdSettings(await loadRawSettings(householdId))
}

/** Saves the settings sheet. Keys the sheet does not show (written by Claude, say) are kept. */
export async function saveHouseholdSettings(householdId: string, settings: HouseholdSettings): Promise<void> {
  const raw = await loadRawSettings(householdId)
  const { error } = await supabase
    .from('household_settings')
    .upsert({ household_id: householdId, settings: { ...raw, ...settings } })
  if (error) throw error
}

/** How many example recipes the household still has. */
export async function countExamples(householdId: string): Promise<number> {
  const { count, error } = await supabase
    .from('recipes')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .eq('is_example', true)
  if (error) throw error
  return count ?? 0
}

/**
 * Deletes the household's example recipes. Their ingredients, steps and planned dishes go
 * with them (foreign keys cascade), so they also come off every plan. Returns how many went.
 */
export async function clearExamples(householdId: string): Promise<number> {
  const { data, error } = await supabase.from('recipes').delete().eq('household_id', householdId).eq('is_example', true).select('id')
  if (error) throw error
  return data.length
}

const PAGE = 1000

/** Every row of a query, a page at a time, so the API's row limit never cuts an export short. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

/**
 * All of the household's data as one object: the household, its members, settings, recipes
 * (with ingredients and steps), plans, list marks and hand-added items, plus the shared
 * ingredient list the recipes refer to. Rows are as stored, so the file can be loaded back.
 */
export async function exportHousehold(householdId: string) {
  const hid = householdId
  const [household, members, settings, ingredients, recipes, nights, dishes, marks, extras] = await Promise.all([
    supabase.from('households').select('*').eq('id', hid).maybeSingle(),
    supabase.from('household_members').select('*').eq('household_id', hid),
    supabase.from('household_settings').select('*').eq('household_id', hid).maybeSingle(),
    allRows((a, b) => supabase.from('ingredients').select('*').order('slug').range(a, b)),
    allRows((a, b) =>
      supabase
        .from('recipes')
        .select('*, recipe_ingredients(*), recipe_steps(*)')
        .eq('household_id', hid)
        .order('id')
        .range(a, b),
    ),
    allRows((a, b) =>
      supabase.from('meal_plan_nights').select('*').eq('household_id', hid).order('week_start').order('day').range(a, b),
    ),
    allRows((a, b) => supabase.from('meal_plan_dishes').select('*').eq('household_id', hid).order('id').range(a, b)),
    allRows((a, b) =>
      supabase.from('list_marks').select('*').eq('household_id', hid).order('week_start').order('item_key').range(a, b),
    ),
    allRows((a, b) => supabase.from('list_extras').select('*').eq('household_id', hid).order('id').range(a, b)),
  ])
  for (const r of [household, members, settings]) if (r.error) throw r.error
  return {
    app: 'whats-for-dinner',
    format: 1,
    exportedAt: new Date().toISOString(),
    household: household.data,
    household_members: members.data,
    household_settings: settings.data,
    ingredients,
    recipes,
    meal_plan_nights: nights,
    meal_plan_dishes: dishes,
    list_marks: marks,
    list_extras: extras,
  }
}

/** Saves `data` as a JSON file through the browser's download. */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
