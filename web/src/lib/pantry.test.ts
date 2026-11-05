import { describe, expect, it } from 'vitest'
import { NO_MARK } from './list'
import {
  bestBeforeText,
  daysFrom,
  defaultBestBefore,
  defaultLocation,
  freshness,
  inPantryText,
  leftover,
  pantryGroups,
  pantryQty,
  readPantryForm,
  toPantry,
  type PantryForm,
  type PantryItem,
} from './pantry'

// Wednesday 4 November 2026.
const today = '2026-11-04'

const item = (change: Partial<PantryItem>): PantryItem => ({
  id: 'p1',
  slug: 'chicken-thigh',
  name: 'chicken thigh',
  qty: 300,
  unit: 'g',
  location: 'fridge',
  bestBefore: '2026-11-06',
  note: '',
  ...change,
})

describe('best-before', () => {
  it('defaults to today plus the shelf life, or none', () => {
    expect(defaultBestBefore(today, 3)).toBe('2026-11-07')
    expect(defaultBestBefore(today, 0)).toBe(today)
    expect(defaultBestBefore('2026-12-30', 5)).toBe('2027-01-04')
    expect(defaultBestBefore(today, null)).toBeNull()
  })

  it('counts whole days, across a daylight saving change', () => {
    expect(daysFrom('2026-10-03', '2026-10-05')).toBe(2)
    expect(daysFrom(today, '2026-11-01')).toBe(-3)
  })

  it('flags items past it or within two days of it', () => {
    expect(freshness('2026-11-03', today)).toBe('past')
    expect(freshness(today, today)).toBe('soon')
    expect(freshness('2026-11-06', today)).toBe('soon')
    expect(freshness('2026-11-07', today)).toBeNull()
    expect(freshness(null, today)).toBeNull()
  })

  it('reads as today, tomorrow, a weekday in the week ahead, else the date', () => {
    expect(bestBeforeText(today, today)).toBe('today')
    expect(bestBeforeText('2026-11-05', today)).toBe('tomorrow')
    expect(bestBeforeText('2026-11-06', today)).toBe('Fri')
    expect(bestBeforeText('2026-11-10', today)).toBe('Tue')
    expect(bestBeforeText('2026-11-11', today)).toBe('11 Nov')
    expect(bestBeforeText('2026-11-02', today)).toBe('2 Nov')
    expect(bestBeforeText('2027-01-20', today)).toBe('20 Jan 2027')
    expect(bestBeforeText('2028-11-04', today)).toBe('4 Nov 2028')
  })
})

describe('the pantry', () => {
  it('groups by location, soonest best-before first, unknown dates last', () => {
    const groups = pantryGroups([
      item({ id: 'a', name: 'milk', bestBefore: '2026-11-10' }),
      item({ id: 'b', name: 'rice', location: 'pantry', bestBefore: null }),
      item({ id: 'c', name: 'chicken thigh', bestBefore: '2026-11-05' }),
      item({ id: 'd', name: 'butter', bestBefore: null }),
      item({ id: 'e', name: 'peas', location: 'freezer' }),
    ])
    expect(groups.map((g) => [g.location, g.items.map((i) => i.name)])).toEqual([
      ['fridge', ['chicken thigh', 'milk', 'butter']],
      ['freezer', ['peas']],
      ['pantry', ['rice']],
    ])
  })

  it('shows amounts in kg and l from 1000 up, and "some" when nobody measured', () => {
    expect(pantryQty({ qty: 1500, unit: 'g' })).toBe('1.5 kg')
    expect(pantryQty({ qty: 0.5, unit: 'kg' })).toBe('500 g')
    expect(pantryQty({ qty: null, unit: 'each' })).toBe('some')
  })

  it('keeps rows for known ingredients, by name', () => {
    const rows = [
      { id: 'p1', ingredient_slug: 'chicken-thigh', qty: 300, unit: 'g', location: 'fridge', best_before: '2026-11-06', note: 'special' },
      { id: 'p2', ingredient_slug: 'gone', qty: null, unit: 'each', location: 'shed', best_before: null, note: '' },
    ]
    expect(toPantry(rows, { 'chicken-thigh': 'chicken thigh' })).toEqual([item({ note: 'special' })])
  })
})

describe('on the shopping list', () => {
  it('says what the pantry has of an item, with the soonest best-before', () => {
    const pantry = [item({}), item({ id: 'p2', qty: 1, unit: 'kg', location: 'freezer', bestBefore: '2027-01-10' }), item({ id: 'p3', name: 'rice' })]
    expect(inPantryText('chicken thigh', pantry, today)).toBe('In pantry: 300 g + 1 kg, best before Fri')
    expect(inPantryText('rice', [item({ name: 'rice', qty: null, bestBefore: null })], today)).toBe('In pantry: some')
    expect(inPantryText('onion', pantry, today)).toBeNull()
  })

  it('works out what is left of a bought item: the amount bought less the amount needed', () => {
    const mark = { ...NO_MARK, ticked: true }
    expect(leftover({ qty: 600, unit: 'g', mark: { ...mark, boughtQty: 1, boughtUnit: 'kg' } })).toEqual({ qty: 400, unit: 'g' })
    expect(leftover({ qty: 600, unit: 'g', mark: { ...mark, boughtQty: 600, boughtUnit: 'g' } })).toBeNull()
    // Bought in another unit: can't tell.
    expect(leftover({ qty: 600, unit: 'g', mark: { ...mark, boughtQty: 2, boughtUnit: 'each' } })).toBeNull()
    // No amount needed: can't tell.
    expect(leftover({ qty: null, unit: 'tsp', mark: { ...mark, boughtQty: 50, boughtUnit: 'tsp' } })).toBeNull()
  })

  it('takes the packs to buy when no amount was entered', () => {
    const mark = { ...NO_MARK, ticked: true }
    expect(leftover({ qty: 600, unit: 'g', pack: { qty: 500, unit: 'g' }, mark })).toEqual({ qty: 400, unit: 'g' })
    expect(leftover({ qty: 750, unit: 'ml', pack: { qty: 1, unit: 'l' }, mark })).toEqual({ qty: 250, unit: 'ml' })
    expect(leftover({ qty: 0.3, unit: 'ml', pack: { qty: 0.1, unit: 'ml' }, mark })).toBeNull()
    expect(leftover({ qty: 600, unit: 'g', mark })).toBeNull()
    expect(leftover({ qty: 2, unit: 'each', pack: { qty: 1, unit: 'each' }, mark })).toBeNull()
  })

  it('puts fresh things in the fridge, frozen in the freezer, the rest in the pantry', () => {
    expect(defaultLocation('meat and seafood')).toBe('fridge')
    expect(defaultLocation('dairy and fridge')).toBe('fridge')
    expect(defaultLocation('fruit and veg')).toBe('fridge')
    expect(defaultLocation('frozen')).toBe('freezer')
    expect(defaultLocation('canned veg')).toBe('pantry')
  })
})

describe('the item sheet', () => {
  const known = { 'chicken thigh': { slug: 'chicken-thigh', name: 'chicken thigh', section: 'meat and seafood', shelfDays: 3 } }
  const form = (change: Partial<PantryForm>): PantryForm => ({
    name: 'Chicken Thigh ',
    qty: '300',
    unit: 'g',
    location: 'fridge',
    bestBefore: '2026-11-07',
    note: ' on special ',
    section: '',
    ...change,
  })

  it('reads a known ingredient', () => {
    expect(readPantryForm(form({}), known)).toEqual({
      name: 'chicken thigh',
      values: { slug: 'chicken-thigh', qty: 300, unit: 'g', location: 'fridge', bestBefore: '2026-11-07', note: 'on special' },
    })
  })

  it('takes a blank amount as some and a blank date as none', () => {
    const read = readPantryForm(form({ qty: '', bestBefore: '' }), known)
    expect(read).toMatchObject({ values: { qty: null, bestBefore: null } })
  })

  it('needs a section for a new ingredient, and adds it', () => {
    expect(readPantryForm(form({ name: 'quince paste' }), known)).toEqual({ error: 'Pick a section for a new ingredient.' })
    expect(readPantryForm(form({ name: 'quince paste', section: 'dairy and fridge' }), known)).toMatchObject({
      name: 'quince paste',
      values: { slug: 'quince-paste' },
      newIngredient: { name: 'quince paste', section: 'dairy and fridge' },
    })
  })

  it('refuses a missing name, a bad amount or unit', () => {
    expect(readPantryForm(form({ name: ' ' }), known)).toEqual({ error: 'Name the item.' })
    expect(readPantryForm(form({ qty: '0' }), known)).toHaveProperty('error')
    expect(readPantryForm(form({ qty: 'lots' }), known)).toHaveProperty('error')
    expect(readPantryForm(form({ unit: 'packet' }), known)).toEqual({ error: 'Pick a unit.' })
  })
})
