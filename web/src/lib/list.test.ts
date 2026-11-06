import { describe, expect, it } from 'vitest'
import { deriveList, itemDetail, itemQty, packText, readPackForm, rowPacks, rowQty, shopList, swapPrompt, NO_MARK, type ListDish, type Mark } from './list'
import type { RecipeIngredient } from './recipes'

const ing = (name: string, qty: number | null, unit: string): RecipeIngredient => ({ name, qty, unit, note: '' })

const bolognese = {
  serves: 4,
  ingredients: [ing('beef mince', 500, 'g'), ing('onion', 1, 'each'), ing('crushed tomato', 800, 'g'), ing('salt', null, 'tsp')],
}
const salad = { serves: 2, ingredients: [ing('onion', 0.5, 'each'), ing('lettuce', 1, 'each')] }

const sections = {
  'beef mince': 'meat and seafood',
  onion: 'fruit and veg',
  'red onion': 'fruit and veg',
  'crushed tomato': 'canned veg',
  salt: 'herbs and spices',
  lettuce: 'fruit and veg',
  milk: 'dairy and fridge',
}

const dish = (day: ListDish['day'], recipe: ListDish['recipe'], servings: number, swaps: ListDish['swaps'] = []): ListDish => ({
  day,
  servings,
  swaps,
  recipe,
})

const find = (items: ReturnType<typeof deriveList>, key: string) => items.find((i) => i.key === key)

describe('deriveList', () => {
  it('scales each ingredient by servings over serves', () => {
    const items = deriveList([dish('mon', bolognese, 6)], sections)
    expect(find(items, 'beef mince|g')?.qty).toBe(750)
    expect(find(items, 'onion|each')?.qty).toBe(1.5)
  })

  it('sums by name and unit and records the nights in week order', () => {
    const items = deriveList([dish('thu', salad, 2), dish('mon', bolognese, 4)], sections)
    const onion = find(items, 'onion|each')
    expect(onion?.qty).toBe(1.5)
    expect(onion?.nights).toEqual(['mon', 'thu'])
    expect(itemDetail(onion!)).toBe('Mon, Thu')
  })

  it('normalises kg to g and l to ml before adding up', () => {
    const a = { serves: 4, ingredients: [ing('beef mince', 1, 'kg'), ing('milk', 0.5, 'l')] }
    const b = { serves: 4, ingredients: [ing('beef mince', 250, 'g'), ing('milk', 250, 'ml')] }
    const items = deriveList([dish('mon', a, 4), dish('tue', b, 4)], sections)
    expect(find(items, 'beef mince|g')?.qty).toBe(1250)
    expect(find(items, 'milk|ml')?.qty).toBe(750)
    expect(find(items, 'beef mince|kg')).toBeUndefined()
    expect(itemQty(find(items, 'beef mince|g')!)).toBe('1.25 kg')
  })

  it('keeps different units of one ingredient apart', () => {
    const a = { serves: 4, ingredients: [ing('onion', 200, 'g')] }
    const items = deriveList([dish('mon', a, 4), dish('tue', salad, 2)], sections)
    expect(find(items, 'onion|g')?.qty).toBe(200)
    expect(find(items, 'onion|each')?.qty).toBe(0.5)
  })

  it('applies a swap to its dish only and notes it', () => {
    const swaps = [{ from: 'onion', to: 'red onion', qty: null, unit: null }]
    const items = deriveList([dish('mon', bolognese, 4, swaps), dish('tue', salad, 2)], sections)
    expect(find(items, 'red onion|each')).toMatchObject({ qty: 1, nights: ['mon'], notes: ['Swap for onion'], section: 'fruit and veg' })
    expect(find(items, 'onion|each')).toMatchObject({ qty: 0.5, nights: ['tue'], notes: [] })
    expect(itemDetail(find(items, 'red onion|each')!)).toBe('Swap for onion · Mon')
  })

  it('uses the swap amount and unit, scaled like the recipe', () => {
    const swaps = [{ from: 'crushed tomato', to: 'passata', qty: 0.7, unit: 'l' }]
    const items = deriveList([dish('mon', bolognese, 8, swaps)], sections)
    expect(find(items, 'passata|ml')?.qty).toBe(1400)
    expect(find(items, 'passata|ml')?.section).toBe('other')
    expect(find(items, 'crushed tomato|g')).toBeUndefined()
  })

  it('shows "as needed" when no use has an amount, and adds the ones that do', () => {
    const more = { serves: 4, ingredients: [ing('salt', 1, 'tsp')] }
    expect(itemQty(find(deriveList([dish('mon', bolognese, 4)], sections), 'salt|tsp')!)).toBe('as needed')
    for (const order of [
      [dish('mon', bolognese, 4), dish('tue', more, 4)],
      [dish('mon', more, 4), dish('tue', bolognese, 4)],
    ]) {
      expect(find(deriveList(order, sections), 'salt|tsp')?.qty).toBe(1)
    }
  })

  it('skips dishes whose recipe is gone', () => {
    expect(deriveList([{ day: 'mon', servings: 4, swaps: [] }], sections)).toEqual([])
  })

  it('adds extras as their own items, normalised and noted', () => {
    const items = deriveList([dish('mon', bolognese, 4)], sections, [
      { id: 'x1', name: 'milk', qty: 2, unit: 'l', section: 'dairy and fridge' },
      { id: 'x2', name: 'beef mince', qty: 500, unit: 'g', section: '' },
    ])
    expect(find(items, 'extra:x1')).toMatchObject({ name: 'milk', qty: 2000, unit: 'ml', notes: ['Added by hand'], nights: [], extra: 'x1' })
    expect(find(items, 'extra:x2')?.section).toBe('meat and seafood')
    expect(find(items, 'beef mince|g')?.qty).toBe(500)
    expect(itemDetail(find(items, 'extra:x1')!)).toBe('Added by hand')
  })

  it('sorts by section walking order, then name', () => {
    const items = deriveList([dish('mon', bolognese, 4), dish('tue', salad, 2)], sections, [
      { id: 'x1', name: 'paper towel', qty: null, unit: 'each', section: 'nonsense' },
    ])
    expect(items.map((i) => i.name)).toEqual(['lettuce', 'onion', 'beef mince', 'crushed tomato', 'salt', 'paper towel'])
    expect(items.at(-1)?.section).toBe('other')
  })

  it('formats amounts for reading', () => {
    const r = { serves: 3, ingredients: [ing('beef mince', 400, 'g'), ing('salt', 1, 'tsp')] }
    const items = deriveList([dish('mon', r, 2)], sections)
    expect(itemQty(find(items, 'beef mince|g')!)).toBe('267 g')
    expect(itemQty(find(items, 'salt|tsp')!)).toBe('0.75 tsp')
  })
})

describe('shopList', () => {
  const items = deriveList([dish('mon', bolognese, 4), dish('thu', salad, 2)], sections, [
    { id: 'x1', name: 'milk', qty: 2, unit: 'l', section: 'dairy and fridge' },
  ])
  const m = (change: Partial<Mark>): Mark => ({ ...NO_MARK, ...change })

  it('groups by section in walking order', () => {
    const v = shopList(items, {})
    expect(v.sections.map((s) => s.section)).toEqual(['fruit and veg', 'meat and seafood', 'dairy and fridge', 'canned veg', 'herbs and spices'])
    expect(v.sections[0].rows.map((r) => r.name)).toEqual(['lettuce', 'onion'])
    expect(v).toMatchObject({ ticked: 0, total: 6, have: [] })
  })

  it('puts ticked rows last in their section and counts them', () => {
    const v = shopList(items, { 'lettuce|each': m({ ticked: true }) })
    expect(v.sections[0].rows.map((r) => r.name)).toEqual(['onion', 'lettuce'])
    expect(v.ticked).toBe(1)
  })

  it('hides ticked rows and empty sections when asked, still counting them', () => {
    const v = shopList(items, { 'beef mince|g': m({ ticked: true }) }, true)
    expect(v.sections.map((s) => s.section)).not.toContain('meat and seafood')
    expect(v).toMatchObject({ ticked: 1, total: 6 })
  })

  it('keeps one ticked row on show while hiding the rest', () => {
    const marks = { 'beef mince|g': m({ ticked: true }), 'lettuce|each': m({ ticked: true }) }
    const v = shopList(items, marks, true, 'beef mince|g')
    const shown = v.sections.flatMap((s) => s.rows.map((r) => r.name))
    expect(shown).toContain('beef mince')
    expect(shown).not.toContain('lettuce')
  })

  it('sets already-have items apart, out of the progress', () => {
    const v = shopList(items, { 'salt|tsp': m({ haveIt: true, ticked: true }) })
    expect(v.have.map((r) => r.name)).toEqual(['salt'])
    expect(v.sections.map((s) => s.section)).not.toContain('herbs and spices')
    expect(v).toMatchObject({ ticked: 0, total: 5 })
  })

  it('ignores marks for items no longer on the list', () => {
    expect(shopList(items, { 'carrot|each': m({ ticked: true }) })).toMatchObject({ ticked: 0, total: 6 })
  })
})

describe('rowQty', () => {
  const [milk] = deriveList([], sections, [{ id: 'x1', name: 'milk', qty: 2, unit: 'l', section: '' }])

  it('shows what is needed until it is ticked with an amount', () => {
    expect(rowQty({ ...milk, mark: { ...NO_MARK, boughtQty: 3, boughtUnit: 'l' } })).toBe('2 l')
    expect(rowQty({ ...milk, mark: { ...NO_MARK, ticked: true } })).toBe('2 l')
    expect(rowQty({ ...milk, mark: { ...NO_MARK, ticked: true, boughtQty: 3, boughtUnit: 'l' } })).toBe('3 l')
    expect(rowQty({ ...milk, mark: { ...NO_MARK, ticked: true, boughtQty: 500, boughtUnit: null } })).toBe('500 ml')
  })
})

describe('swapPrompt', () => {
  it('names the item, its amount, the dishes that use it and the week', () => {
    const dishes = [dish('thu', { ...salad, name: 'Green salad' }, 2), dish('mon', { ...bolognese, name: 'Bolognese' }, 4)]
    const onion = find(deriveList(dishes, sections), 'onion|each')!
    expect(swapPrompt(onion, dishes, '2026-10-26')).toBe(
      "I'm at the shops and couldn't get onion (1.5 each) for Bolognese on Mon, Green salad on Thu, week starting 2026-10-26. " +
        "What can I swap it for? If it's a good swap, update my What's for Dinner plan.",
    )
  })

  it('follows swaps', () => {
    const swap = { from: 'onion', to: 'red onion', qty: null, unit: null }
    const dishes = [dish('mon', { ...bolognese, name: 'Bolognese' }, 4, [swap]), dish('thu', { ...salad, name: 'Green salad' }, 2)]
    const items = deriveList(dishes, sections)
    expect(swapPrompt(find(items, 'red onion|each')!, dishes, '2026-10-26')).toContain('for Bolognese on Mon,')
    expect(swapPrompt(find(items, 'onion|each')!, dishes, '2026-10-26')).toContain('for Green salad on Thu,')
  })
})

describe('packs', () => {
  it('rounds up to whole packs in the same unit: "600 g · 2 × 500 g"', () => {
    expect(packText(600, 'g', { qty: 500, unit: 'g' })).toBe('2 × 500 g')
    expect(packText(500, 'g', { qty: 500, unit: 'g' })).toBe('1 × 500 g')
    expect(packText(1, 'g', { qty: 500, unit: 'g' })).toBe('1 × 500 g')
    expect(packText(18, 'each', { qty: 12, unit: 'each' })).toBe('2 × 12 each')
  })

  it('compares packs in kg or l with amounts in g or ml', () => {
    expect(packText(1250, 'g', { qty: 1, unit: 'kg' })).toBe('2 × 1 kg')
    expect(packText(600, 'ml', { qty: 0.6, unit: 'l' })).toBe('1 × 600 ml')
    expect(packText(2500, 'ml', { qty: 2, unit: 'l' })).toBe('2 × 2 l')
  })

  it('does not add a pack for float error', () => {
    expect(packText(0.1 * 3 * 1000, 'ml', { qty: 100, unit: 'ml' })).toBe('3 × 100 ml')
    expect(packText(1.5, 'each', { qty: 0.5, unit: 'each' })).toBe('3 × 0.5 each')
  })

  it('leaves amounts in another unit, missing amounts and single packs as they are', () => {
    expect(packText(2, 'tbsp', { qty: 140, unit: 'g' })).toBe('')
    expect(packText(3, 'each', { qty: 1, unit: 'kg' })).toBe('')
    expect(packText(null, 'g', { qty: 500, unit: 'g' })).toBe('')
    expect(packText(0, 'g', { qty: 500, unit: 'g' })).toBe('')
    expect(packText(500, 'g', undefined)).toBe('')
    expect(packText(1.5, 'each', { qty: 1, unit: 'each' })).toBe('')
    expect(packText(0.5, 'bunch', { qty: 1, unit: 'bunch' })).toBe('')
  })

  it('puts each ingredient’s pack on its items, planned, swapped in and hand-added', () => {
    const packs = { 'beef mince': { qty: 500, unit: 'g' }, 'red onion': { qty: 1, unit: 'kg' }, milk: { qty: 1, unit: 'l' } }
    const swaps = [{ from: 'onion', to: 'red onion', qty: 300, unit: 'g' }]
    const items = deriveList([dish('mon', bolognese, 6, swaps)], sections, [{ id: 'x1', name: 'Milk', qty: 1.5, unit: 'l', section: '' }], packs)
    expect(itemQty(find(items, 'beef mince|g')!)).toBe('750 g · 2 × 500 g')
    expect(itemQty(find(items, 'red onion|g')!)).toBe('450 g · 1 × 1 kg')
    expect(itemQty(find(items, 'extra:x1')!)).toBe('1.5 l · 2 × 1 l')
    expect(itemQty(find(items, 'crushed tomato|g')!)).toBe('1.25 kg')
    expect(itemQty(find(items, 'salt|tsp')!)).toBe('as needed')
  })

  it('puts packs under a row’s amount, and shows what was bought, not packs, once ticked with an amount', () => {
    const [item] = deriveList([dish('mon', { serves: 4, ingredients: [ing('beef mince', 600, 'g')] }, 4)], sections, [], { 'beef mince': { qty: 500, unit: 'g' } })
    expect(rowQty({ ...item, mark: NO_MARK })).toBe('600 g')
    expect(rowPacks({ ...item, mark: NO_MARK })).toBe('2 × 500 g')
    expect(rowPacks({ ...item, mark: { ...NO_MARK, ticked: true } })).toBe('2 × 500 g')
    const bought = { ...item, mark: { ...NO_MARK, ticked: true, boughtQty: 1, boughtUnit: 'kg' } }
    expect(rowQty(bought)).toBe('1 kg')
    expect(rowPacks(bought)).toBe('')
  })

  it('keeps packs out of the swap question', () => {
    const [item] = deriveList([dish('mon', { serves: 4, ingredients: [ing('beef mince', 600, 'g')] }, 4)], sections, [], { 'beef mince': { qty: 500, unit: 'g' } })
    expect(swapPrompt(item, [], '2026-10-26')).toContain('beef mince (600 g)')
  })
})

describe('readPackForm', () => {
  it('reads a pack size and shelf life', () => {
    expect(readPackForm('500', 'g', '3')).toEqual({ pack: { qty: 500, unit: 'g' }, shelfDays: 3 })
    expect(readPackForm(' 1.5 ', 'kg', '0')).toEqual({ pack: { qty: 1.5, unit: 'kg' }, shelfDays: 0 })
  })

  it('clears either when blank', () => {
    expect(readPackForm('', 'g', '')).toEqual({ pack: null, shelfDays: null })
    expect(readPackForm('  ', 'g', '7')).toEqual({ pack: null, shelfDays: 7 })
  })

  it('refuses a pack of 0 or less, an unknown unit, and part or negative days', () => {
    expect(readPackForm('0', 'g', '')).toEqual({ error: 'Pack size must be more than 0.' })
    expect(readPackForm('-2', 'g', '')).toHaveProperty('error')
    expect(readPackForm('abc', 'g', '')).toHaveProperty('error')
    expect(readPackForm('500', 'packet', '')).toEqual({ error: 'Pick a unit for the pack size.' })
    expect(readPackForm('', 'g', '1.5')).toEqual({ error: 'Keeps for must be whole days.' })
    expect(readPackForm('', 'g', '-1')).toHaveProperty('error')
  })
})
