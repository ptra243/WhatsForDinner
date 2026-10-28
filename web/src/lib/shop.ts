// Loading and saving the shopping list: the plan it is derived from, marks, extras and sections.
import { NO_MARK, type ListDish, type ListExtra, type Mark, type Swap } from './list'
import { supabase } from './supabase'
import type { Day } from './week'

export type ListData = {
  dishes: ListDish[]
  /** Ingredient name → section. */
  sections: Record<string, string>
  extras: ListExtra[]
  marks: Record<string, Mark>
}

/** Swaps as stored in `meal_plan_dishes.swaps`; anything malformed is dropped. */
export function toSwaps(raw: unknown): Swap[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof s.from === 'string' && typeof s.to === 'string')
    .map((s) => ({
      from: s.from as string,
      to: s.to as string,
      qty: typeof s.qty === 'number' ? s.qty : s.qty == null || s.qty === '' ? null : Number(s.qty) || null,
      unit: typeof s.unit === 'string' && s.unit ? s.unit : null,
    }))
}

/** Everything the week's list is made from. */
export async function loadList(householdId: string, weekStart: string): Promise<ListData> {
  const week = { household_id: householdId, week_start: weekStart }
  const [dishes, ingredients, extras, marks] = await Promise.all([
    supabase
      .from('meal_plan_dishes')
      .select('day, servings, swaps, recipes(name, serves, recipe_ingredients(position, qty, unit, note, ingredients(name)))')
      .match(week)
      .overrideTypes<
        {
          day: Day
          servings: number
          swaps: unknown
          recipes: {
            name: string
            serves: number
            recipe_ingredients: { position: number; qty: number | null; unit: string; note: string; ingredients: { name: string } | null }[]
          } | null
        }[],
        { merge: false }
      >(),
    supabase.from('ingredients').select('name, section'),
    supabase.from('list_extras').select('id, name, qty, unit, section').match(week).order('created_at'),
    supabase.from('list_marks').select('item_key, ticked, bought_qty, bought_unit, status, have_it').match(week),
  ])
  for (const r of [dishes, ingredients, extras, marks]) if (r.error) throw r.error
  return {
    dishes: (dishes.data ?? []).map((d) => ({
      day: d.day,
      servings: Number(d.servings),
      swaps: toSwaps(d.swaps),
      recipe: d.recipes
        ? {
            name: d.recipes.name,
            serves: Number(d.recipes.serves),
            ingredients: [...d.recipes.recipe_ingredients]
              .sort((a, b) => a.position - b.position)
              .map((i) => ({ name: i.ingredients?.name ?? '', qty: i.qty == null ? null : Number(i.qty), unit: i.unit, note: i.note })),
          }
        : undefined,
    })),
    sections: Object.fromEntries((ingredients.data ?? []).map((i) => [i.name, i.section])),
    extras: (extras.data ?? []).map((x) => ({ ...x, qty: x.qty == null ? null : Number(x.qty) })),
    marks: Object.fromEntries(
      (marks.data ?? []).map((m) => [
        m.item_key,
        {
          ticked: m.ticked,
          boughtQty: m.bought_qty == null ? null : Number(m.bought_qty),
          boughtUnit: m.bought_unit,
          missing: m.status === 'missing',
          haveIt: m.have_it,
        },
      ]),
    ),
  }
}

/** The mark with a change applied, as the app shows it before the database confirms. */
export const applyMark = (mark: Mark | undefined, change: Partial<Mark>): Mark => ({ ...(mark ?? NO_MARK), ...change })

/**
 * Saves a change to an item's mark, making the mark if there is none. Only the changed
 * columns are written, so two people shopping at once do not undo each other's changes.
 */
export async function setMark(householdId: string, weekStart: string, itemKey: string, change: Partial<Mark>): Promise<void> {
  const row: Record<string, unknown> = { household_id: householdId, week_start: weekStart, item_key: itemKey }
  if (change.ticked !== undefined) row.ticked = change.ticked
  if (change.boughtQty !== undefined) row.bought_qty = change.boughtQty
  if (change.boughtUnit !== undefined) row.bought_unit = change.boughtUnit
  if (change.missing !== undefined) row.status = change.missing ? 'missing' : null
  if (change.haveIt !== undefined) row.have_it = change.haveIt
  const { error } = await supabase.from('list_marks').upsert(row as never)
  if (error) throw error
}

export async function addExtra(householdId: string, weekStart: string, extra: Omit<ListExtra, 'id'>): Promise<void> {
  const { error } = await supabase
    .from('list_extras')
    .insert({ household_id: householdId, week_start: weekStart, ...extra, name: extra.name.toLowerCase().trim() })
  if (error) throw error
}

export async function removeExtra(id: string): Promise<void> {
  const { error } = await supabase.from('list_extras').delete().eq('id', id)
  if (error) throw error
}

/** An ingredient slug from its name: "crushed tomato" → "crushed-tomato". */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Moves an item to another section. A hand-added item changes on its own; a planned item
 * changes the shared ingredient, so it stays in that section on every list from now on.
 * An ingredient only known from a swap is added to the ingredient list.
 */
export async function setSection(item: { name: string; extra?: string }, section: string): Promise<void> {
  if (item.extra) {
    const { error } = await supabase.from('list_extras').update({ section }).eq('id', item.extra)
    if (error) throw error
    return
  }
  const { data, error } = await supabase.from('ingredients').update({ section }).eq('name', item.name).select('slug')
  if (error) throw error
  if (data.length) return
  const slug = slugOf(item.name)
  if (!slug) return
  const { error: insertError } = await supabase.from('ingredients').insert({ slug, name: item.name, section })
  if (insertError) throw insertError
}

/**
 * Calls `onChange` whenever anything the list is made from changes: marks and extras (from
 * the other shopper), the plan and recipes (from the Week tab or Claude). Returns the unsubscribe.
 */
export function subscribeList(householdId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`list-${householdId}`)
  for (const table of ['list_marks', 'list_extras', 'meal_plan_dishes', 'recipes']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
