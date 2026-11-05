// Loading and saving the shopping list: the plan it is derived from, marks, extras and sections.
import { NO_MARK, type ListDish, type ListExtra, type Mark, type Pack, type Swap } from './list'
import { STORES, type Prices, type Store, type StorePrice } from './prices'
import { supabase } from './supabase'
import type { Day } from './week'

export type ListData = {
  dishes: ListDish[]
  /** Ingredient name → section. */
  sections: Record<string, string>
  /** Ingredient name → pack size, for those that have one. */
  packs: Record<string, Pack>
  /** Ingredient name → days it keeps once bought, for those that have one. */
  shelfDays: Record<string, number>
  extras: ListExtra[]
  marks: Record<string, Mark>
  /** Ingredient name → each store's latest price (`ingredient_prices_latest`). */
  prices: Prices
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
  const [dishes, ingredients, extras, marks, prices] = await Promise.all([
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
    supabase.from('ingredients').select('slug, name, section, pack_qty, pack_unit, shelf_days'),
    supabase.from('list_extras').select('id, name, qty, unit, section').match(week).order('created_at'),
    supabase.from('list_marks').select('item_key, ticked, bought_qty, bought_unit, status, have_it').match(week),
    supabase
      .from('ingredient_prices_latest')
      .select('ingredient_slug, store, source, seen_on, product, pack_qty, pack_unit, price, unit_price, unit_basis, on_special')
      .eq('household_id', householdId),
  ])
  for (const r of [dishes, ingredients, extras, marks, prices]) if (r.error) throw r.error
  const names = Object.fromEntries((ingredients.data ?? []).map((i) => [i.slug, i.name]))
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
    packs: Object.fromEntries(
      (ingredients.data ?? []).flatMap((i) => (i.pack_qty != null && i.pack_unit ? [[i.name, { qty: Number(i.pack_qty), unit: i.pack_unit }]] : [])),
    ),
    shelfDays: Object.fromEntries((ingredients.data ?? []).flatMap((i) => (i.shelf_days != null ? [[i.name, i.shelf_days]] : []))),
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
    prices: toPrices(prices.data ?? [], names),
  }
}

type PriceRow = {
  ingredient_slug: string
  store: string
  source: string
  seen_on: string
  product: string | null
  pack_qty: number | null
  pack_unit: string | null
  price: number | null
  unit_price: number | null
  unit_basis: string | null
  on_special: boolean
}

/** The latest price rows by ingredient name and store; rows for an unknown ingredient or store are dropped. */
export function toPrices(rows: PriceRow[], names: Record<string, string>): Prices {
  const prices: Prices = {}
  for (const r of rows) {
    const name = names[r.ingredient_slug]
    if (!name || !(STORES as readonly string[]).includes(r.store)) continue
    const basis = r.unit_basis === 'kg' || r.unit_basis === 'l' || r.unit_basis === 'each' ? r.unit_basis : null
    const p: StorePrice = {
      store: r.store as Store,
      source: r.source,
      seenOn: r.seen_on,
      product: r.product,
      packQty: r.pack_qty == null ? null : Number(r.pack_qty),
      packUnit: r.pack_unit,
      price: r.price == null ? null : Number(r.price),
      unitPrice: basis && r.unit_price != null ? Number(r.unit_price) : null,
      unitBasis: basis && r.unit_price != null ? basis : null,
      onSpecial: r.on_special,
    }
    ;(prices[name] ??= {})[p.store] = p
  }
  return prices
}

/** The mark with a change applied, as the app shows it before the database confirms. */
export const applyMark = (mark: Mark | undefined, change: Partial<Mark>): Mark => ({ ...(mark ?? NO_MARK), ...change })

/**
 * Gives up on a list save after 20 seconds. On a bad connection a request can hang for minutes;
 * an abort comes back with no error code, so the queue keeps the change and tries again.
 */
const giveUp = () => AbortSignal.timeout(20_000)

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
  const { error } = await supabase.from('list_marks').upsert(row as never).abortSignal(giveUp())
  if (error) throw error
}

/**
 * Adds a hand-added item with the id the app made for it (so it can be removed before it is
 * saved). Sent again after an answer was lost, it is already there, which counts as saved.
 */
export async function addExtra(householdId: string, weekStart: string, extra: ListExtra): Promise<void> {
  const { error } = await supabase
    .from('list_extras')
    .insert({ household_id: householdId, week_start: weekStart, ...extra, name: extra.name.toLowerCase().trim() })
    .abortSignal(giveUp())
  if (error && error.code !== '23505') throw error
}

export async function removeExtra(id: string): Promise<void> {
  const { error } = await supabase.from('list_extras').delete().eq('id', id).abortSignal(giveUp())
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
 * Sets or clears an item's pack size and shelf life. They belong to the shared ingredient, so
 * they apply on every list; an ingredient only known from a swap is added in the item's section.
 */
export async function setPackAndShelf(
  item: { name: string; section: string },
  { pack, shelfDays }: { pack: Pack | null; shelfDays: number | null },
): Promise<void> {
  const values = { pack_qty: pack?.qty ?? null, pack_unit: pack?.unit ?? null, shelf_days: shelfDays }
  const { data, error } = await supabase.from('ingredients').update(values).eq('name', item.name).select('slug')
  if (error) throw error
  if (data.length) return
  const slug = slugOf(item.name)
  if (!slug) return
  const { error: insertError } = await supabase.from('ingredients').insert({ slug, name: item.name, section: item.section, ...values })
  if (insertError) throw insertError
}

/**
 * Calls `onChange` whenever anything the list is made from changes: marks and extras (from
 * the other shopper), the plan and recipes (from the Week tab or Claude), and prices (from Claude). Returns the unsubscribe.
 */
export function subscribeList(householdId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`list-${householdId}`)
  for (const table of ['list_marks', 'list_extras', 'meal_plan_dishes', 'recipes', 'ingredient_prices']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
