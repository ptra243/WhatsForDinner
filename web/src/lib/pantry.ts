// The pantry (#19): what the household has at home and where, with best-before dates
// (docs/data-model.md). The Pantry tab keeps it; the shopping list says what is already there.
// Claude reads it to plan around what expires first and never writes it.
import { fmtQty, slugOf, toBase } from './format'
import { packText, SECTIONS, UNITS, type Mark, type Pack } from './list'
import { supabase } from './supabase'
import { addDays, dayOf, DAY_NAMES, dayLabel, parseYmd } from './week'

/** Where an item is kept, as the database allows (`pantry_items.location`). */
export const LOCATIONS = ['fridge', 'freezer', 'pantry'] as const
export type Location = (typeof LOCATIONS)[number]
export const LOCATION_NAMES: Record<Location, string> = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' }

/** Items within this many days of their best-before are flagged, as are those past it. */
export const SOON_DAYS = 2

export type PantryItem = {
  id: string
  slug: string
  /** The ingredient's name. */
  name: string
  /** Null for an amount nobody measured. */
  qty: number | null
  unit: string
  location: Location
  /** YYYY-MM-DD, or null when nobody knows. */
  bestBefore: string | null
  note: string
}

/** What the pantry needs to know about an ingredient. */
export type PantryIngredient = { slug: string; name: string; section: string; shelfDays: number | null }

/** The fields a pantry item is saved with. */
export type PantryValues = Omit<PantryItem, 'id' | 'name'>

const asLocation = (s: string): Location => ((LOCATIONS as readonly string[]).includes(s) ? (s as Location) : 'pantry')

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export const daysFrom = (from: string, to: string) => Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000)

/** A new item's best-before: today plus the ingredient's shelf life, or none when that isn't known. */
export const defaultBestBefore = (today: string, shelfDays: number | null | undefined) =>
  shelfDays == null ? null : addDays(today, shelfDays)

/** 'past' once the best-before has gone, 'soon' within two days of it, otherwise null. */
export function freshness(bestBefore: string | null, today: string): 'past' | 'soon' | null {
  if (!bestBefore) return null
  const left = daysFrom(today, bestBefore)
  return left < 0 ? 'past' : left <= SOON_DAYS ? 'soon' : null
}

/**
 * A best-before for reading: "today", "tomorrow", the weekday within the week ahead ("Fri"), else
 * the date ("12 Nov"), with its year when it isn't this year's ("4 Nov 2028").
 */
export function bestBeforeText(bestBefore: string, today: string): string {
  const left = daysFrom(today, bestBefore)
  if (left === 0) return 'today'
  if (left === 1) return 'tomorrow'
  if (left > 1 && left < 7) return DAY_NAMES[dayOf(parseYmd(bestBefore))]
  const year = bestBefore.slice(0, 4)
  return dayLabel(bestBefore) + (year === today.slice(0, 4) ? '' : ` ${year}`)
}

/** An item's amount for reading ("300 g", "1.5 kg"), "some" when nobody measured it. */
export function pantryQty(item: Pick<PantryItem, 'qty' | 'unit'>): string {
  if (item.qty == null) return 'some'
  const b = toBase(item.qty, item.unit)
  return fmtQty(b.qty, b.unit)
}

/** The pantry by location (fridge, freezer, pantry), soonest best-before first, then by name; empty locations left out. */
export function pantryGroups(items: PantryItem[]): { location: Location; items: PantryItem[] }[] {
  return LOCATIONS.map((location) => ({
    location,
    items: items
      .filter((i) => i.location === location)
      .sort((a, b) => (a.bestBefore ?? '9999').localeCompare(b.bestBefore ?? '9999') || a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length)
}

/**
 * What the pantry holds of a list item's ingredient: "In pantry: 300 g, best before Fri", every
 * row's amount and the soonest best-before. Null when there is none.
 */
export function inPantryText(name: string, pantry: PantryItem[], today: string): string | null {
  const rows = pantry.filter((p) => p.name === name)
  if (!rows.length) return null
  const amounts = rows.map(pantryQty).join(' + ')
  const soonest = rows.map((r) => r.bestBefore).filter((d): d is string => !!d).sort()[0]
  return `In pantry: ${amounts}${soonest ? `, best before ${bestBeforeText(soonest, today)}` : ''}`
}

/**
 * What is left of a bought item once the week has what it needs: the amount bought (or, when
 * none was entered, the packs to buy) less the amount needed, in the item's unit. Null when
 * nothing is left, or the two can't be compared (another unit, no amount needed, no pack).
 */
export function leftover(row: { qty: number | null; unit: string; pack?: Pack; mark: Mark }): { qty: number; unit: string } | null {
  if (row.qty == null) return null
  let bought: number | null = null
  if (row.mark.boughtQty != null) {
    const b = toBase(row.mark.boughtQty, row.mark.boughtUnit || row.unit)
    if (b.unit === row.unit) bought = b.qty
  } else if (row.pack && packText(row.qty, row.unit, row.pack)) {
    const p = toBase(row.pack.qty, row.pack.unit)
    bought = Math.ceil(row.qty / p.qty! - 1e-9) * p.qty!
  }
  if (bought == null) return null
  const rest = bought - row.qty
  // A hair over is float error, not something left over.
  return rest > 1e-6 ? { qty: Math.round(rest * 1000) / 1000, unit: row.unit } : null
}

/** Where a bought item usually goes, from its section: frozen to the freezer, fresh things to the fridge, the rest to the pantry. */
export function defaultLocation(section: string): Location {
  if (section === 'frozen') return 'freezer'
  if (section === 'fruit and veg' || section === 'meat and seafood' || section === 'dairy and fridge') return 'fridge'
  return 'pantry'
}

/** A typed name as stored: lowercase, trimmed, single spaces ("Crushed  tomato" → "crushed tomato"). */
export const cleanName = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ')

/**
 * The known ingredient a typed name means: by name, or else by slug, so "crushed-tomato" or a
 * stray space still finds "crushed tomato" instead of clashing with it as a new one.
 */
export function findIngredient(name: string, known: Record<string, PantryIngredient>): PantryIngredient | undefined {
  const clean = cleanName(name)
  if (!clean) return undefined
  const slug = slugOf(clean)
  return known[clean] ?? Object.values(known).find((i) => i.slug === slug)
}

export type PantryForm = { name: string; qty: string; unit: string; location: string; bestBefore: string; note: string; section: string }

/**
 * A pantry item from the add or edit sheet's fields. The name must be a known ingredient or come
 * with its section (a new one is added to the shared list); a blank amount is "some"; a blank
 * best-before is none.
 */
export function readPantryForm(
  form: PantryForm,
  known: Record<string, PantryIngredient>,
): { values: PantryValues; name: string; newIngredient?: { name: string; section: string } } | { error: string } {
  const ingredient = findIngredient(form.name, known)
  const name = ingredient?.name ?? cleanName(form.name)
  if (!name) return { error: 'Name the item.' }
  if (!ingredient && !(SECTIONS as readonly string[]).includes(form.section)) return { error: 'Pick a section for a new ingredient.' }
  const slug = ingredient?.slug ?? slugOf(name)
  if (!slug) return { error: 'Name the item with letters or numbers.' }
  let qty: number | null = null
  if (form.qty.trim() !== '') {
    qty = Number(form.qty)
    if (!(qty > 0)) return { error: 'The amount must be more than 0, or blank for some.' }
  }
  if (!(UNITS as readonly string[]).includes(form.unit)) return { error: 'Pick a unit.' }
  const bestBefore = form.bestBefore.trim() || null
  if (bestBefore && !/^\d{4}-\d{2}-\d{2}$/.test(bestBefore)) return { error: 'Best-before must be a date.' }
  return {
    name,
    values: { slug, qty, unit: form.unit, location: asLocation(form.location), bestBefore, note: form.note.trim() },
    ...(ingredient ? {} : { newIngredient: { name, section: form.section } }),
  }
}

type PantryRow = {
  id: string
  ingredient_slug: string
  qty: number | null
  unit: string
  location: string
  best_before: string | null
  note: string
}

/** Pantry rows with their ingredient names (slug → name); a row for an unknown ingredient is dropped. */
export function toPantry(rows: PantryRow[], names: Record<string, string>): PantryItem[] {
  return rows.flatMap((r) =>
    names[r.ingredient_slug]
      ? [
          {
            id: r.id,
            slug: r.ingredient_slug,
            name: names[r.ingredient_slug],
            qty: r.qty == null ? null : Number(r.qty),
            unit: r.unit,
            location: asLocation(r.location),
            bestBefore: r.best_before,
            note: r.note,
          },
        ]
      : [],
  )
}

export const PANTRY_COLUMNS = 'id, ingredient_slug, qty, unit, location, best_before, note'

/** The household's pantry and the shared ingredient list it picks from (name → ingredient). */
export async function loadPantry(householdId: string): Promise<{ items: PantryItem[]; ingredients: Record<string, PantryIngredient> }> {
  const [items, ingredients] = await Promise.all([
    supabase.from('pantry_items').select(PANTRY_COLUMNS).eq('household_id', householdId),
    supabase.from('ingredients').select('slug, name, section, shelf_days'),
  ])
  if (items.error) throw items.error
  if (ingredients.error) throw ingredients.error
  const names = Object.fromEntries(ingredients.data.map((i) => [i.slug, i.name]))
  return {
    items: toPantry(items.data, names),
    ingredients: Object.fromEntries(
      ingredients.data.map((i) => [i.name, { slug: i.slug, name: i.name, section: i.section, shelfDays: i.shelf_days }]),
    ),
  }
}

const toRow = (v: PantryValues) => ({
  ingredient_slug: v.slug,
  qty: v.qty,
  unit: v.unit,
  location: v.location,
  best_before: v.bestBefore,
  note: v.note,
})

/** Adds an item; a new ingredient is first added to the shared list with its section. */
export async function addPantryItem(householdId: string, values: PantryValues, newIngredient?: { name: string; section: string }) {
  if (newIngredient) {
    const { error } = await supabase.from('ingredients').insert({ slug: values.slug, name: newIngredient.name, section: newIngredient.section })
    if (error) throw error
  }
  const { error } = await supabase.from('pantry_items').insert({ household_id: householdId, ...toRow(values) })
  if (error) throw error
}

export async function updatePantryItem(id: string, values: PantryValues, newIngredient?: { name: string; section: string }) {
  if (newIngredient) {
    const { error } = await supabase.from('ingredients').insert({ slug: values.slug, name: newIngredient.name, section: newIngredient.section })
    if (error) throw error
  }
  const { error } = await supabase.from('pantry_items').update(toRow(values)).eq('id', id)
  if (error) throw error
}

/**
 * Adds what is left of a bought list item to the pantry, by the ingredient's name. Returns false
 * when the name is not a known ingredient, so there is nothing to add it as.
 */
export async function addLeftover(
  householdId: string,
  name: string,
  values: Omit<PantryValues, 'slug' | 'note'>,
): Promise<boolean> {
  const { data, error } = await supabase.from('ingredients').select('slug').eq('name', name).maybeSingle()
  if (error) throw error
  if (!data) return false
  await addPantryItem(householdId, { ...values, slug: data.slug, note: '' })
  return true
}

/** Used up: the item comes off the pantry. */
export async function removePantryItem(id: string) {
  const { error } = await supabase.from('pantry_items').delete().eq('id', id)
  if (error) throw error
}

/** Calls `onChange` whenever the household's pantry changes (the other member, another tab). Returns the unsubscribe. */
export function subscribePantry(householdId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`pantry-${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pantry_items', filter: `household_id=eq.${householdId}` }, onChange)
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
