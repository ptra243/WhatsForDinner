// The shopping list, worked out from the week's plan (docs/decisions/0004-derived-shopping-list.md).
// Pure code: the caller loads the dishes, recipes, ingredient sections and extras.
import { fmtQty, toBase } from './format'
import type { RecipeIngredient } from './recipes'
import { DAYS, DAY_NAMES, type Day } from './week'

/** Sections in walking order, as the database allows them (docs/data-model.md). */
export const SECTIONS = [
  'fruit and veg',
  'bakery',
  'meat and seafood',
  'dairy and fridge',
  'canned veg',
  'canned fruit',
  'international',
  'pantry',
  'herbs and spices',
  'frozen',
  'other',
] as const
export type Section = (typeof SECTIONS)[number]

/** Units as the database allows them (docs/data-model.md). */
export const UNITS = ['g', 'kg', 'ml', 'l', 'each', 'tsp', 'tbsp', 'bunch', 'tin'] as const

const asSection =(s: string | null | undefined): Section =>
  (SECTIONS as readonly string[]).includes(s ?? '') ? (s as Section) : 'other'

/** One ingredient swapped for another in one planned dish (`meal_plan_dishes.swaps`). Null qty or unit keeps the recipe's. */
export type Swap = { from: string; to: string; qty: number | null; unit: string | null }

/** A planned dish as the list needs it; `recipe` is undefined when the recipe is gone. */
export type ListDish = {
  day: Day
  servings: number
  swaps: Swap[]
  recipe?: { name?: string; serves: number; ingredients: RecipeIngredient[] }
}

/** A hand-added item (`list_extras`). */
export type ListExtra = { id: string; name: string; qty: number | null; unit: string; section: string }

export type ListItem = {
  /** `name|unit` for planned items, `extra:<id>` for hand-added ones; `list_marks.item_key`. */
  key: string
  name: string
  /** In base units (g, ml, ...); null when no dish gives an amount. */
  qty: number | null
  unit: string
  section: Section
  /** The nights that use it, Monday first. */
  nights: Day[]
  /** "Swap for onion", "Added by hand". */
  notes: string[]
  /** The `list_extras` id of a hand-added item. */
  extra?: string
}

/**
 * The week's list: each dish's ingredients scaled by servings / serves, swaps applied,
 * kg and l normalised to g and ml, summed by name and unit, then extras, sorted by section and name.
 * Amounts that are missing add nothing; an item's qty is null only when none of its uses has one.
 */
export function deriveList(dishes: ListDish[], sections: Record<string, string>, extras: ListExtra[] = []): ListItem[] {
  const items = new Map<string, ListItem>()
  const ordered = [...dishes].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
  for (const dish of ordered) {
    const r = dish.recipe
    if (!r) continue
    const factor = (dish.servings || r.serves || 4) / (r.serves || 4)
    for (const ing of r.ingredients) {
      let name = ing.name.toLowerCase().trim()
      let qty = ing.qty
      let unit = ing.unit
      let note: string | null = null
      const swap = dish.swaps.find((s) => s.from.toLowerCase().trim() === name)
      if (swap) {
        note = `Swap for ${name}`
        name = swap.to.toLowerCase().trim()
        if (swap.qty != null) qty = swap.qty
        if (swap.unit) unit = swap.unit
      }
      const b = toBase(qty == null ? null : qty * factor, unit)
      const key = `${name}|${b.unit}`
      let item = items.get(key)
      if (!item) {
        item = { key, name, qty: null, unit: b.unit, section: asSection(sections[name]), nights: [], notes: [] }
        items.set(key, item)
      }
      if (b.qty != null) item.qty = (item.qty ?? 0) + b.qty
      if (!item.nights.includes(dish.day)) item.nights.push(dish.day)
      if (note && !item.notes.includes(note)) item.notes.push(note)
    }
  }
  const list = [...items.values()]
  for (const x of extras) {
    const b = toBase(x.qty, x.unit)
    list.push({
      key: `extra:${x.id}`,
      name: x.name,
      qty: b.qty,
      unit: b.unit,
      section: asSection(x.section || sections[x.name.toLowerCase().trim()]),
      nights: [],
      notes: ['Added by hand'],
      extra: x.id,
    })
  }
  return list.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.name.localeCompare(b.name))
}

/** The amount to show: kg or l from 1000 up, quarters under 20, "as needed" when there is none. */
export const itemQty = (item: ListItem) => fmtQty(item.qty, item.unit)

/** The line under an item's name: its notes, then the nights that use it ("Swap for onion · Mon, Thu"). */
export const itemDetail = (item: ListItem) =>
  [...item.notes, ...(item.nights.length ? [item.nights.map((d) => DAY_NAMES[d]).join(', ')] : [])].join(' · ')

/** What the shopper did with an item (`list_marks`). */
export type Mark = { ticked: boolean; boughtQty: number | null; boughtUnit: string | null; missing: boolean; haveIt: boolean }

export const NO_MARK: Mark = { ticked: false, boughtQty: null, boughtUnit: null, missing: false, haveIt: false }

export type ShopRow = ListItem & { mark: Mark }

export type ShopList = {
  /** Sections in walking order with their rows, unticked first; empty sections left out. */
  sections: { section: Section; rows: ShopRow[] }[]
  /** Items marked already have, at the bottom; they do not count towards progress. */
  have: ShopRow[]
  ticked: number
  total: number
}

/**
 * The list as the shopper sees it: marks laid over the items, grouped by section in walking
 * order, already-have items set apart. Marks for items no longer on the list are ignored.
 */
export function shopList(items: ListItem[], marks: Record<string, Mark>, hideTicked = false): ShopList {
  const rows = items.map((i) => ({ ...i, mark: marks[i.key] ?? NO_MARK }))
  const need = rows.filter((r) => !r.mark.haveIt)
  const sections: ShopList['sections'] = []
  for (const section of SECTIONS) {
    const inSection = need
      .filter((r) => r.section === section && !(hideTicked && r.mark.ticked))
      .sort((a, b) => Number(a.mark.ticked) - Number(b.mark.ticked) || a.name.localeCompare(b.name))
    if (inSection.length) sections.push({ section, rows: inSection })
  }
  return {
    sections,
    have: rows.filter((r) => r.mark.haveIt).sort((a, b) => a.name.localeCompare(b.name)),
    ticked: need.filter((r) => r.mark.ticked).length,
    total: need.length,
  }
}

/** The amount on a row: what was bought once it is ticked with an amount, otherwise what is needed. */
export function rowQty(row: ShopRow): string {
  const { ticked, boughtQty, boughtUnit } = row.mark
  if (!ticked || boughtQty == null) return itemQty(row)
  const b = toBase(boughtQty, boughtUnit || row.unit)
  return fmtQty(b.qty, b.unit)
}

/** The question for Claude when an item could not be bought: what it is for, and to update the plan if the swap is good. */
export function swapPrompt(item: ListItem, dishes: ListDish[], weekStart: string): string {
  const uses: string[] = []
  for (const d of [...dishes].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))) {
    const r = d.recipe
    const is = (name: string) => name.toLowerCase().trim() === item.name
    const usesIt =
      (r?.ingredients.some((i) => is(i.name)) && !d.swaps.some((s) => is(s.from))) || d.swaps.some((s) => is(s.to))
    const use = `${r?.name ?? 'a dish'} on ${DAY_NAMES[d.day]}`
    if (r && usesIt && !uses.includes(use)) uses.push(use)
  }
  return (
    `I'm at the shops and couldn't get ${item.name} (${itemQty(item)})${uses.length ? ` for ${uses.join(', ')}` : ''}, ` +
    `week starting ${weekStart}. What can I swap it for? If it's a good swap, update my What's for Dinner plan.`
  )
}
