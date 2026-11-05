// Shopping list prices (#84): each store's latest price for an item and a total per store.
// Claude saves prices to `ingredient_prices` through the connector; the app only reads the
// latest row per ingredient and store (`ingredient_prices_latest`). Pure code.
import { fmtQty, toBase } from './format'
import type { ShopRow } from './list'
import { addDays, dayLabel } from './week'

export const STORES = ['coles', 'woolworths', 'aldi'] as const
export type Store = (typeof STORES)[number]
export const STORE_NAMES: Record<Store, string> = { coles: 'Coles', woolworths: 'Woolies', aldi: 'Aldi' }

/** A store's latest row for an ingredient. A not found row (no acceptable match) has no product, pack or price. */
export type StorePrice = {
  store: Store
  source: string
  seenOn: string
  product: string | null
  packQty: number | null
  packUnit: string | null
  price: number | null
  unitPrice: number | null
  unitBasis: 'kg' | 'l' | 'each' | null
  onSpecial: boolean
}

/** Ingredient name → store → its latest row. */
export type Prices = Record<string, Partial<Record<Store, StorePrice>>>

/** Prices older than this many days show their date. */
export const STALE_DAYS = 7

/**
 * Pantry staples get no price line: the herbs and spices section, plus oils, sauces and stock
 * (owner, #84). Claude skips the same items when pricing.
 */
export const isStaple = (name: string, section: string) =>
  section === 'herbs and spices' || /(^|\s)(oil|sauce|stock)$/.test(name.toLowerCase().trim())

/** "$16", "$5.50": whole dollars without cents. */
export const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`

/** "$16.00/kg", "$3.20/L", "$0.90 each". */
export function unitPriceText(p: Pick<StorePrice, 'unitPrice' | 'unitBasis'>): string {
  if (p.unitPrice == null || !p.unitBasis) return ''
  const n = `$${p.unitPrice.toFixed(2)}`
  return p.unitBasis === 'each' ? `${n} each` : `${n}/${p.unitBasis === 'l' ? 'L' : 'kg'}`
}

/** One store's price for an item: what it costs to buy, or `found: false` for "–". */
export type ItemStorePrice =
  | { store: Store; found: false }
  | {
      store: Store
      found: true
      /** Packs to buy × the pack price. */
      cost: number
      packs: number
      /** The store's pack couldn't be compared with the item's amount, so one pack is counted ("1 kg pack"). */
      onePack: string | null
      unit: string
      special: boolean
      /** The date to show for a price older than a week ("12 Oct"); null when it is recent. */
      stale: string | null
      row: StorePrice
    }

/**
 * What an item costs at a store: packs to buy × the store's pack price, with kg and l compared
 * as g and ml and rounded up as the list's packs are. When the pack is in another unit or the
 * item has no amount, one pack. No row, or a not found row, is not found.
 */
export function itemStorePrice(item: { qty: number | null; unit: string }, row: StorePrice | undefined, today: string): ItemStorePrice {
  const store = row?.store ?? 'coles'
  if (!row || row.price == null || row.packQty == null || !row.packUnit) return { store, found: false }
  const pack = toBase(row.packQty, row.packUnit)
  const comparable = item.qty != null && item.qty > 0 && pack.qty != null && pack.qty > 0 && pack.unit === item.unit
  // A hair over a whole number of packs is float error, not another pack.
  const packs = comparable ? Math.max(1, Math.ceil(item.qty! / pack.qty! - 1e-9)) : 1
  return {
    store: row.store,
    found: true,
    cost: Math.round(packs * row.price * 100) / 100,
    packs,
    onePack: comparable ? null : `${fmtQty(pack.qty, pack.unit)} pack`,
    unit: unitPriceText(row),
    special: row.onSpecial,
    stale: row.seenOn < addDays(today, -STALE_DAYS) ? dayLabel(row.seenOn) : null,
    row,
  }
}

/** Every store's price for an item, Coles first; null for a staple, which shows no price line. */
export function itemPrices(item: { name: string; section: string; qty: number | null; unit: string }, prices: Prices, today: string): ItemStorePrice[] | null {
  if (isStaple(item.name, item.section)) return null
  const byStore = prices[item.name] ?? {}
  return STORES.map((store) => {
    const p = itemStorePrice(item, byStore[store], today)
    return p.found ? p : { store, found: false }
  })
}

/** The price line on a row: "Coles $16 · Woolies $14 · Aldi –"; empty when no store has a price. */
export function priceLine(p: ItemStorePrice[] | null): string {
  if (!p || !p.some((x) => x.found)) return ''
  return p.map((x) => `${STORE_NAMES[x.store]} ${x.found ? money(x.cost) : '–'}`).join(' · ')
}

export type StoreTotal = {
  store: Store
  total: number
  /** Items with a price at this store. */
  items: number
  /** Items that could be priced: the list less staples, already have, and names that aren't ingredients. */
  of: number
  /** Some of the prices counted are older than a week. */
  older: boolean
}

/**
 * A total per store over every item except those marked already have (ticked and couldn't get
 * still count). Staples and items that aren't known ingredients aren't priced. Empty when no
 * item has a price anywhere.
 */
export function storeTotals(rows: ShopRow[], prices: Prices, known: Record<string, unknown>, today: string): StoreTotal[] {
  const totals = STORES.map((store) => ({ store, total: 0, items: 0, of: 0, older: false }))
  let any = false
  for (const row of rows) {
    if (row.mark.haveIt || !(row.name in known)) continue
    const p = itemPrices(row, prices, today)
    if (!p) continue
    for (const [i, x] of p.entries()) {
      const t = totals[i]
      t.of++
      if (!x.found) continue
      any = true
      t.total = Math.round((t.total + x.cost) * 100) / 100
      t.items++
      if (x.stale) t.older = true
    }
  }
  return any ? totals : []
}

/** "Aldi $121 · 20 of 24 items" */
export const totalText = (t: StoreTotal) => `${STORE_NAMES[t.store]} ${t.items ? money(t.total) : '–'} · ${t.items} of ${t.of} item${t.of === 1 ? '' : 's'}`
