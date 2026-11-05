import { describe, expect, it } from 'vitest'
import { NO_MARK, type ShopRow } from './list'
import { isStaple, itemPrices, itemStorePrice, money, priceLine, storeTotals, totalText, unitPriceText, type Prices, type StorePrice } from './prices'

const TODAY = '2026-11-05'

const row = (store: StorePrice['store'], change: Partial<StorePrice> = {}): StorePrice => ({
  store,
  source: 'whichgrocer',
  seenOn: TODAY,
  product: 'Beef Mince 500g',
  packQty: 500,
  packUnit: 'g',
  price: 8,
  unitPrice: 16,
  unitBasis: 'kg',
  onSpecial: false,
  ...change,
})
const notFound = (store: StorePrice['store']): StorePrice =>
  row(store, { product: null, packQty: null, packUnit: null, price: null, unitPrice: null, unitBasis: null })

const shopRow = (name: string, qty: number | null, unit: string, section = 'meat and seafood', mark = NO_MARK): ShopRow => ({
  key: `${name}|${unit}`,
  name,
  qty,
  unit,
  section: section as ShopRow['section'],
  nights: [],
  notes: [],
  mark,
})

describe('isStaple', () => {
  it('is herbs and spices, oils, sauces and stock', () => {
    expect(isStaple('ground cumin', 'herbs and spices')).toBe(true)
    expect(isStaple('olive oil', 'pantry')).toBe(true)
    expect(isStaple('soy sauce', 'international')).toBe(true)
    expect(isStaple('chicken stock', 'pantry')).toBe(true)
    expect(isStaple('beef mince', 'meat and seafood')).toBe(false)
    expect(isStaple('tomato paste', 'canned veg')).toBe(false)
    expect(isStaple('boiled egg', 'dairy and fridge')).toBe(false)
  })
})

describe('money and unit prices', () => {
  it('drops cents on whole dollars', () => {
    expect(money(16)).toBe('$16')
    expect(money(5.5)).toBe('$5.50')
    expect(money(4.999)).toBe('$5')
  })
  it('names the basis', () => {
    expect(unitPriceText({ unitPrice: 16, unitBasis: 'kg' })).toBe('$16.00/kg')
    expect(unitPriceText({ unitPrice: 3.2, unitBasis: 'l' })).toBe('$3.20/L')
    expect(unitPriceText({ unitPrice: 0.9, unitBasis: 'each' })).toBe('$0.90 each')
    expect(unitPriceText({ unitPrice: null, unitBasis: null })).toBe('')
  })
})

describe('itemStorePrice', () => {
  it('is packs to buy × the pack price, rounded up', () => {
    const p = itemStorePrice({ qty: 600, unit: 'g' }, row('coles'), TODAY)
    expect(p).toMatchObject({ found: true, packs: 2, cost: 16, onePack: null, unit: '$16.00/kg', stale: null })
  })
  it('compares kg and l as g and ml', () => {
    expect(itemStorePrice({ qty: 1500, unit: 'g' }, row('woolworths', { packQty: 1, packUnit: 'kg', price: 14 }), TODAY)).toMatchObject({ packs: 2, cost: 28 })
    expect(itemStorePrice({ qty: 900, unit: 'ml' }, row('aldi', { packQty: 0.3, packUnit: 'l', price: 2.5 }), TODAY)).toMatchObject({ packs: 3, cost: 7.5 })
  })
  it('counts one pack when the units differ or there is no amount', () => {
    expect(itemStorePrice({ qty: 2, unit: 'each' }, row('coles', { packQty: 1, packUnit: 'kg', price: 5.5 }), TODAY)).toMatchObject({
      packs: 1,
      cost: 5.5,
      onePack: '1 kg pack',
    })
    expect(itemStorePrice({ qty: null, unit: 'g' }, row('coles'), TODAY)).toMatchObject({ packs: 1, cost: 8, onePack: '500 g pack' })
  })
  it('is not found with no row or a not found row', () => {
    expect(itemStorePrice({ qty: 500, unit: 'g' }, undefined, TODAY)).toMatchObject({ found: false })
    expect(itemStorePrice({ qty: 500, unit: 'g' }, notFound('aldi'), TODAY)).toEqual({ store: 'aldi', found: false })
  })
  it('dates a price older than a week, and marks specials', () => {
    expect(itemStorePrice({ qty: 500, unit: 'g' }, row('aldi', { seenOn: '2026-10-29' }), TODAY)).toMatchObject({ stale: null })
    expect(itemStorePrice({ qty: 500, unit: 'g' }, row('aldi', { seenOn: '2026-10-12' }), TODAY)).toMatchObject({ stale: '12 Oct' })
    expect(itemStorePrice({ qty: 500, unit: 'g' }, row('aldi', { onSpecial: true }), TODAY)).toMatchObject({ special: true })
  })
})

describe('itemPrices and priceLine', () => {
  const prices: Prices = { 'beef mince': { coles: row('coles'), woolworths: row('woolworths', { packQty: 1, packUnit: 'kg', price: 14 }), aldi: notFound('aldi') } }

  it('lists every store, Coles first, with – for no match', () => {
    const p = itemPrices({ name: 'beef mince', section: 'meat and seafood', qty: 1000, unit: 'g' }, prices, TODAY)
    expect(p?.map((x) => x.store)).toEqual(['coles', 'woolworths', 'aldi'])
    expect(priceLine(p)).toBe('Coles $16 · Woolies $14 · Aldi –')
  })
  it('gives a store with no row –', () => {
    const p = itemPrices({ name: 'beef mince', section: 'meat and seafood', qty: 500, unit: 'g' }, { 'beef mince': { aldi: row('aldi', { price: 7 }) } }, TODAY)
    expect(priceLine(p)).toBe('Coles – · Woolies – · Aldi $7')
  })
  it('shows nothing for a staple or an unpriced item', () => {
    expect(itemPrices({ name: 'olive oil', section: 'pantry', qty: 30, unit: 'ml' }, { 'olive oil': { coles: row('coles') } }, TODAY)).toBeNull()
    expect(priceLine(itemPrices({ name: 'onion', section: 'fruit and veg', qty: 1, unit: 'each' }, prices, TODAY))).toBe('')
  })
})

describe('storeTotals', () => {
  const prices: Prices = {
    'beef mince': { coles: row('coles'), woolworths: row('woolworths', { price: 7 }), aldi: notFound('aldi') },
    onion: { coles: row('coles', { packQty: 1, packUnit: 'each', price: 0.5 }), aldi: row('aldi', { packQty: 1, packUnit: 'each', price: 0.4, seenOn: '2026-10-12' }) },
    lettuce: { coles: row('coles', { packQty: 1, packUnit: 'each', price: 3 }) },
    'olive oil': { coles: row('coles', { price: 9 }) },
  }
  const known = { 'beef mince': 1, onion: 1, lettuce: 1, 'olive oil': 1 }

  it('adds each store’s prices, counting what it covers', () => {
    const rows = [
      shopRow('beef mince', 1000, 'g', 'meat and seafood', { ...NO_MARK, ticked: true }),
      shopRow('onion', 3, 'each', 'fruit and veg', { ...NO_MARK, missing: true }),
      shopRow('lettuce', 1, 'each', 'fruit and veg', { ...NO_MARK, haveIt: true }),
      shopRow('olive oil', 30, 'ml', 'pantry'),
      shopRow('dish soap', 1, 'each', 'other'),
    ]
    const totals = storeTotals(rows, prices, known, TODAY)
    expect(totals.map(totalText)).toEqual(['Coles $17.50 · 2 of 2 items', 'Woolies $14 · 1 of 2 items', 'Aldi $1.20 · 1 of 2 items'])
    expect(totals.map((t) => t.older)).toEqual([false, false, true])
  })
  it('is empty when nothing has a price', () => {
    expect(storeTotals([shopRow('beef mince', 500, 'g')], {}, known, TODAY)).toEqual([])
  })
})
