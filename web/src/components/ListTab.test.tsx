import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_MARK } from '../lib/list'
import { flush, pending } from '../lib/offlineQueue'
import type { RecipeIngredient } from '../lib/recipes'
import type { ListData } from '../lib/shop'
import { Toast } from './AskClaude'
import { ListTab } from './ListTab'

const api = vi.hoisted(() => ({
  loadList: vi.fn(),
  setMark: vi.fn(async () => {}),
  addExtra: vi.fn(async () => {}),
  removeExtra: vi.fn(async () => {}),
  setSection: vi.fn(async () => {}),
  setPackAndShelf: vi.fn(async () => {}),
  subscribeList: vi.fn(),
  askClaude: vi.fn(async () => 'opened'),
  addLeftover: vi.fn(async () => true),
}))
vi.mock('../lib/shop', async (actual) => ({ ...(await actual<typeof import('../lib/shop')>()), ...api }))
vi.mock('../lib/pantry', async (actual) => ({ ...(await actual<typeof import('../lib/pantry')>()), addLeftover: api.addLeftover }))
vi.mock('../lib/claude', () => ({ askClaude: api.askClaude }))

const ing = (name: string, qty: number | null, unit: string): RecipeIngredient => ({ name, qty, unit, note: '' })

/** This week (Mon 26 Oct 2026): bolognese on Monday, salad on Thursday, milk added by hand. */
const data = (change: Partial<ListData> = {}): ListData => ({
  dishes: [
    {
      day: 'mon',
      servings: 4,
      swaps: [],
      recipe: { name: 'Bolognese', serves: 4, ingredients: [ing('beef mince', 500, 'g'), ing('onion', 1, 'each'), ing('salt', null, 'tsp')] },
    },
    { day: 'thu', servings: 2, swaps: [], recipe: { name: 'Green salad', serves: 2, ingredients: [ing('lettuce', 1, 'each')] } },
  ],
  sections: { 'beef mince': 'meat and seafood', onion: 'fruit and veg', salt: 'herbs and spices', lettuce: 'fruit and veg' },
  packs: {},
  shelfDays: {},
  prices: {},
  pantry: [],
  extras: [{ id: 'x1', name: 'milk', qty: 2, unit: 'l', section: 'dairy and fridge' }],
  marks: {},
  ...change,
})

let realtime: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 12))
  vi.clearAllMocks()
  localStorage.clear()
  api.loadList.mockImplementation(async (_h: string, week: string) =>
    week === '2026-10-26' ? data() : { dishes: [], sections: {}, packs: {}, shelfDays: {}, extras: [], marks: {}, prices: {}, pantry: [] },
  )
  api.subscribeList.mockImplementation((_h: string, cb: () => void) => {
    realtime = cb
    return () => {}
  })
})
afterEach(() => vi.useRealTimers())

const renderTab = (adding = false, onAddClose = () => {}) =>
  render(
    <>
      <ListTab householdId="h1" adding={adding} onAddClose={onAddClose} />
      <Toast />
    </>,
  )
const section = (name: string) => screen.getByRole('region', { name })
const tick = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) })
const openItem = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Change amount for ${name}` }))
  return screen.getByRole('dialog', { name })
}

describe('Shopping list', () => {
  it('groups the week’s items by section in walking order', async () => {
    renderTab()
    await screen.findByText('lettuce')
    expect(api.loadList).toHaveBeenCalledWith('h1', '2026-10-26')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['fruit and veg', 'meat and seafood', 'dairy and fridge', 'herbs and spices'])
    expect(within(section('fruit and veg')).getByText('lettuce')).toBeInTheDocument()
    expect(within(section('dairy and fridge')).getByText('Added by hand')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change amount for milk' })).toHaveTextContent('2 l')
    expect(screen.getByRole('button', { name: 'Change amount for salt' })).toHaveTextContent('as needed')
    expect(within(section('fruit and veg')).getByText('Thu')).toBeInTheDocument()
  })

  it('shows progress and ticks an item straight away', async () => {
    renderTab()
    await screen.findByText('lettuce')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/of 5 ticked/)).toBeInTheDocument()
    fireEvent.click(tick('lettuce'))
    expect(tick('lettuce')).toBeChecked()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'lettuce|each', { ticked: true, missing: false })
    fireEvent.click(tick('lettuce'))
    await waitFor(() => expect(api.setMark).toHaveBeenLastCalledWith('h1', '2026-10-26', 'lettuce|each', { ticked: false }))
  })

  it('hides ticked items when asked and remembers it', async () => {
    api.loadList.mockResolvedValue(data({ marks: { 'beef mince|g': { ticked: true, boughtQty: null, boughtUnit: null, missing: false, haveIt: false } } }))
    renderTab()
    await screen.findByText('beef mince')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide ticked' }))
    expect(screen.queryByText('beef mince')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'meat and seafood' })).not.toBeInTheDocument()
    expect(screen.getByText(/of 5 ticked/)).toHaveTextContent('1 of 5 ticked')
    expect(localStorage.getItem('wfd.hideTicked')).toBe('1')
  })

  it('reloads when marks, extras or the plan change in the database', async () => {
    renderTab()
    await screen.findByText('lettuce')
    api.loadList.mockResolvedValue(data({ extras: [{ id: 'x2', name: 'bread', qty: 1, unit: 'each', section: 'bakery' }] }))
    act(() => realtime())
    expect(await screen.findByText('bread', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByText('milk')).not.toBeInTheDocument()
  })

  it('says how the list is made when there is nothing on it', async () => {
    renderTab()
    await screen.findByText('lettuce')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText('No shopping list yet')).toBeInTheDocument()
  })

  it('puts already-have items at the bottom, out of the progress', async () => {
    api.loadList.mockResolvedValue(data({ marks: { 'salt|tsp': { ticked: false, boughtQty: null, boughtUnit: null, missing: false, haveIt: true } } }))
    renderTab()
    await screen.findByText('salt')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings.at(-1)).toBe('Already have')
    expect(within(section('Already have')).getByText('salt')).toBeInTheDocument()
    expect(screen.getByText(/of 4 ticked/)).toBeInTheDocument()
  })
})

describe('Amount sheet', () => {
  it('saves the amount bought and ticks the item', async () => {
    renderTab()
    const sheet = await openItem('beef mince')
    expect(sheet).toHaveTextContent('Needed 500 g · Mon')
    expect(within(sheet).getByLabelText('Bought')).toHaveValue(500)
    fireEvent.change(within(sheet).getByLabelText('Bought'), { target: { value: '0.6' } })
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Bought unit' }), { target: { value: 'kg' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and tick' }))
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'beef mince|g', { ticked: true, boughtQty: 0.6, boughtUnit: 'kg', missing: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change amount for beef mince' })).toHaveTextContent('600 g')
    expect(tick('beef mince')).toBeChecked()
  })

  it('marks an item couldn’t get, offering Ask Claude for a swap', async () => {
    renderTab()
    fireEvent.click(within(await openItem('onion')).getByRole('button', { name: 'Couldn’t get it' }))
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'onion|each', { missing: true, ticked: false })
    expect(screen.getByText('Couldn’t get it')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude for a swap' }))
    expect(api.askClaude).toHaveBeenCalledWith(expect.stringContaining("couldn't get onion (1 each) for Bolognese on Mon, week starting 2026-10-26"))
    fireEvent.click(within(await openItem('onion')).getByRole('button', { name: 'Found it after all' }))
    expect(api.setMark).toHaveBeenLastCalledWith('h1', '2026-10-26', 'onion|each', { missing: false, ticked: false })
  })

  it('says when the question was copied instead', async () => {
    api.askClaude.mockResolvedValueOnce('copied')
    api.loadList.mockResolvedValue(data({ marks: { 'onion|each': { ticked: false, boughtQty: null, boughtUnit: null, missing: true, haveIt: false } } }))
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Claude for a swap' }))
    expect(await screen.findByText('Copied the question. Open Claude and paste it.')).toBeInTheDocument()
  })

  it('moves an item to already have and back', async () => {
    renderTab()
    fireEvent.click(within(await openItem('salt')).getByRole('button', { name: 'Already have it' }))
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'salt|tsp', { haveIt: true })
    expect(within(section('Already have')).getByText('salt')).toBeInTheDocument()
    fireEvent.click(within(await openItem('salt')).getByRole('button', { name: 'Need to buy it' }))
    expect(api.setMark).toHaveBeenLastCalledWith('h1', '2026-10-26', 'salt|tsp', { haveIt: false })
  })

  it('changes an item’s section', async () => {
    renderTab()
    const sheet = await openItem('onion')
    fireEvent.change(within(sheet).getByLabelText('Section'), { target: { value: 'pantry' } })
    await waitFor(() => expect(api.setSection).toHaveBeenCalledWith(expect.objectContaining({ name: 'onion', key: 'onion|each' }), 'pantry'))
    await waitFor(() => expect(api.loadList).toHaveBeenCalledTimes(2))
  })

  it('shows packs for an item whose pack size is known', async () => {
    api.loadList.mockResolvedValue(data({ packs: { 'beef mince': { qty: 300, unit: 'g' }, milk: { qty: 1, unit: 'l' } } }))
    renderTab()
    expect(await screen.findByRole('button', { name: 'Change amount for beef mince' })).toHaveTextContent(/^500 g2 × 300 g$/)
    expect(within(screen.getByRole('button', { name: 'Change amount for milk' })).getByText('2 × 1 l')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change amount for onion' })).toHaveTextContent(/^1 each$/)
    expect(within(await openItem('beef mince')).getByText(/^Needed 500 g · 2 × 300 g/)).toBeInTheDocument()
  })

  it('sets and clears an ingredient’s pack size and shelf life', async () => {
    api.loadList.mockResolvedValue(data({ packs: { onion: { qty: 1, unit: 'kg' } }, shelfDays: { onion: 30 } }))
    renderTab()
    let sheet = await openItem('beef mince')
    expect(within(sheet).getByLabelText('Pack size')).toHaveValue(null)
    expect(within(sheet).getByLabelText('Pack unit')).toHaveValue('g')
    fireEvent.change(within(sheet).getByLabelText('Pack size'), { target: { value: '0' } })
    expect(within(sheet).getByText('Pack size must be more than 0.')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save pack size and shelf life' })).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Pack size'), { target: { value: '500' } })
    fireEvent.change(within(sheet).getByLabelText(/Keeps for/), { target: { value: '2' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save pack size and shelf life' }))
    await waitFor(() =>
      expect(api.setPackAndShelf).toHaveBeenCalledWith(expect.objectContaining({ name: 'beef mince' }), { pack: { qty: 500, unit: 'g' }, shelfDays: 2 }),
    )
    sheet = await openItem('onion')
    expect(within(sheet).getByLabelText('Pack size')).toHaveValue(1)
    expect(within(sheet).getByLabelText('Pack unit')).toHaveValue('kg')
    expect(within(sheet).getByLabelText(/Keeps for/)).toHaveValue(30)
    fireEvent.change(within(sheet).getByLabelText('Pack size'), { target: { value: '' } })
    fireEvent.change(within(sheet).getByLabelText(/Keeps for/), { target: { value: '' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save pack size and shelf life' }))
    await waitFor(() => expect(api.setPackAndShelf).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'onion' }), { pack: null, shelfDays: null }))
  })

  it('offers pack size on a hand-added item only when it is a known ingredient', async () => {
    const { unmount } = renderTab()
    expect(within(await openItem('milk')).queryByLabelText('Pack size')).not.toBeInTheDocument()
    unmount()
    api.loadList.mockResolvedValue(data({ sections: { milk: 'dairy and fridge' } }))
    renderTab()
    expect(within(await openItem('milk')).getByLabelText('Pack size')).toBeInTheDocument()
  })

  it('removes a hand-added item, and only those', async () => {
    renderTab()
    expect(within(await openItem('onion')).queryByRole('button', { name: 'Remove from list' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(await openItem('milk')).getByRole('button', { name: 'Remove from list' }))
    await waitFor(() => expect(api.removeExtra).toHaveBeenCalledWith('x1'))
  })
})

describe('Add item', () => {
  it('adds an item by hand, taking a known ingredient’s section', async () => {
    const onAddClose = vi.fn()
    renderTab(true, onAddClose)
    await screen.findByText('lettuce')
    const sheet = screen.getByRole('dialog', { name: 'Add an item' })
    fireEvent.change(within(sheet).getByLabelText('Item'), { target: { value: ' Onion ' } })
    expect(within(sheet).getByLabelText('Section')).toHaveValue('fruit and veg')
    fireEvent.change(within(sheet).getByLabelText('Amount'), { target: { value: '3' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to list' }))
    await waitFor(() =>
      expect(api.addExtra).toHaveBeenCalledWith('h1', '2026-10-26', { id: expect.any(String), name: 'onion', qty: 3, unit: 'each', section: 'fruit and veg' }),
    )
    expect(onAddClose).toHaveBeenCalled()
  })

  it('needs a name', async () => {
    renderTab(true)
    await screen.findByText('lettuce')
    expect(within(screen.getByRole('dialog', { name: 'Add an item' })).getByRole('button', { name: 'Add to list' })).toBeDisabled()
  })
})

describe('Offline', () => {
  const setOnline = (online: boolean) =>
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
      window.dispatchEvent(new Event(online ? 'online' : 'offline'))
    })
  afterEach(() => setOnline(true))

  it('ticks offline, keeps the tick through a reload, and sends it when the signal is back', async () => {
    renderTab()
    await screen.findByText('lettuce')
    setOnline(false)
    fireEvent.click(tick('lettuce'))
    expect(tick('lettuce')).toBeChecked()
    expect(api.setMark).not.toHaveBeenCalled()
    expect(pending('h1')).toMatchObject([{ kind: 'mark', week: '2026-10-26', key: 'lettuce|each', change: { ticked: true, missing: false } }])

    // Back online the list reloads before the queue is sent; the tick still shows.
    setOnline(true)
    await waitFor(() => expect(api.loadList).toHaveBeenCalledTimes(3))
    expect(tick('lettuce')).toBeChecked()
    await act(() => flush('h1'))
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'lettuce|each', { ticked: true, missing: false })
    expect(pending('h1')).toEqual([])
  })

  it('allows every change but moving a section', async () => {
    renderTab()
    await screen.findByText('lettuce')
    setOnline(false)
    expect(tick('lettuce')).toBeEnabled()
    const sheet = await openItem('milk')
    for (const name of ['Save and tick', 'Couldn’t get it', 'Already have it', 'Remove from list']) {
      expect(within(sheet).getByRole('button', { name })).toBeEnabled()
    }
    expect(within(sheet).getByLabelText('Section')).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(await openItem('lettuce')).getByRole('button', { name: 'Save pack size and shelf life' })).toBeDisabled()
  })

  it('adds and removes a hand-added item offline without sending either', async () => {
    renderTab(true)
    await screen.findByText('lettuce')
    setOnline(false)
    const sheet = screen.getByRole('dialog', { name: 'Add an item' })
    fireEvent.change(within(sheet).getByLabelText('Item'), { target: { value: 'bread' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to list' }))
    expect(await screen.findByText('bread')).toBeInTheDocument()
    fireEvent.click(within(await openItem('bread')).getByRole('button', { name: 'Remove from list' }))
    expect(screen.queryByText('bread')).not.toBeInTheDocument()
    expect(pending('h1')).toEqual([])
    setOnline(true)
    await act(() => flush('h1'))
    expect(api.addExtra).not.toHaveBeenCalled()
    expect(api.removeExtra).not.toHaveBeenCalled()
  })

  it('drops a change the database refuses, with a toast, and reloads', async () => {
    api.setMark.mockRejectedValueOnce({ code: '42501', message: 'not allowed' })
    renderTab()
    await screen.findByText('lettuce')
    fireEvent.click(tick('lettuce'))
    expect(await screen.findByText('A change could not be saved, so it was dropped: not allowed')).toBeInTheDocument()
    await waitFor(() => expect(api.loadList).toHaveBeenCalledTimes(2))
    expect(tick('lettuce')).not.toBeChecked()
    expect(pending('h1')).toEqual([])
  })
})

describe('Shopping list prices', () => {
  const price = (store: 'coles' | 'woolworths' | 'aldi', change: Record<string, unknown> = {}) => ({
    store,
    source: 'whichgrocer',
    seenOn: '2026-10-28',
    product: 'Beef Mince 500g',
    packQty: 500,
    packUnit: 'g',
    price: 8,
    unitPrice: 16,
    unitBasis: 'kg' as const,
    onSpecial: false,
    ...change,
  })
  const notFound = (store: 'coles' | 'woolworths' | 'aldi') =>
    price(store, { product: null, packQty: null, packUnit: null, price: null, unitPrice: null, unitBasis: null })
  const priced = (change: Partial<ListData> = {}) =>
    data({
      prices: {
        'beef mince': {
          coles: price('coles'),
          woolworths: price('woolworths', { product: 'Woolworths Mince 1kg', packQty: 1, packUnit: 'kg', price: 14, unitPrice: 14, onSpecial: true }),
          aldi: notFound('aldi'),
        },
        lettuce: { coles: price('coles', { product: 'Iceberg Lettuce', packQty: 1, packUnit: 'each', price: 3, unitPrice: 3, unitBasis: 'each', seenOn: '2026-10-12' }) },
        salt: { coles: price('coles', { product: 'Table Salt', price: 1 }) },
        milk: { aldi: price('aldi', { product: 'Full Cream Milk 2L', packQty: 2, packUnit: 'l', price: 3.29, unitPrice: 1.65, unitBasis: 'l' }) },
      },
      ...change,
    })
  const priceLine = (name: string) => {
    const label = tick(name).closest('label') as HTMLElement
    return (within(label).queryByLabelText('Prices')?.textContent ?? '').replaceAll(' ', ' ')
  }

  it('shows each store’s price on a row, with $/kg, specials, old dates and – for no match', async () => {
    api.loadList.mockResolvedValue(priced())
    renderTab()
    await screen.findByText('lettuce')
    expect(priceLine('beef mince')).toBe('Coles $8 $16.00/kg · Woolies $14 special $14.00/kg · Aldi –')
    expect(priceLine('lettuce')).toBe('Coles $3 $3.00 each · 12 Oct · Woolies – · Aldi –')
    expect(priceLine('salt')).toBe('')
    expect(priceLine('onion')).toBe('')
  })

  it('totals each store at the top, leaving out already have and unknown hand-added items', async () => {
    api.loadList.mockResolvedValue(priced({ marks: { 'onion|each': { ...NO_MARK, haveIt: true } } }))
    renderTab()
    await screen.findByText('lettuce')
    const totals = screen.getByRole('region', { name: 'Store totals' })
    expect(within(totals).getAllByText(/items?/).map((p) => p.textContent)).toEqual([
      'Coles $11 · 2 of 2 items · includes older prices',
      'Woolies $14 · 1 of 2 items',
      'Aldi – · 0 of 2 items',
    ])
  })

  it('prices a hand-added item that is a known ingredient', async () => {
    api.loadList.mockResolvedValue(priced({ sections: { ...data().sections, milk: 'dairy and fridge' } }))
    renderTab()
    await screen.findByText('lettuce')
    expect(priceLine('milk')).toBe('Coles – · Woolies – · Aldi $3.29 $1.65/L')
  })

  it('names the matched product on the item sheet', async () => {
    api.loadList.mockResolvedValue(priced())
    renderTab()
    const sheet = await openItem('beef mince')
    expect(within(sheet).getByText('Beef Mince 500g · 28 Oct')).toBeInTheDocument()
    expect(within(sheet).getByText('Woolworths Mince 1kg · 28 Oct')).toBeInTheDocument()
    expect(within(sheet).getByText('– no match found')).toBeInTheDocument()
    expect(within(sheet).getByText(/Tell Claude in chat/)).toBeInTheDocument()
  })

  it('reloads when Claude saves prices', async () => {
    renderTab()
    await screen.findByText('lettuce')
    expect(api.subscribeList).toHaveBeenCalled()
    api.loadList.mockResolvedValue(priced())
    act(() => realtime())
    await waitFor(() => expect(priceLine('beef mince')).toContain('Coles $8'))
  })
})

describe('Pantry on the list', () => {
  const mince = { id: 'p1', slug: 'beef-mince', name: 'beef mince', qty: 300, unit: 'g', location: 'freezer' as const, bestBefore: '2026-10-30', note: '' }

  it('says what is already in the pantry, with one tap to already have it', async () => {
    api.loadList.mockResolvedValue(data({ pantry: [mince] }))
    renderTab()
    expect(await screen.findByText('In pantry: 300 g, best before Fri')).toBeInTheDocument()
    expect(screen.getAllByText(/^In pantry/)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Already have beef mince' }))
    expect(api.setMark).toHaveBeenCalledWith('h1', '2026-10-26', 'beef mince|g', { haveIt: true })
    expect(within(section('Already have')).getByText('beef mince')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Already have beef mince' })).not.toBeInTheDocument()
  })

  it('offers to add what is left of a bought pack to the pantry, with its shelf life', async () => {
    api.loadList.mockResolvedValue(data({ packs: { 'beef mince': { qty: 300, unit: 'g' } }, shelfDays: { 'beef mince': 3 } }))
    renderTab()
    fireEvent.click(await screen.findByRole('checkbox', { name: /^beef mince/ }))
    const offer = screen.getByRole('group', { name: 'Left over beef mince' })
    fireEvent.click(within(offer).getByRole('button', { name: 'Add the rest to the pantry (100 g)' }))
    expect(api.addLeftover).toHaveBeenCalledWith('h1', 'beef mince', { qty: 100, unit: 'g', location: 'fridge', bestBefore: '2026-10-31' })
    expect(await screen.findByText('Added 100 g beef mince to the fridge, best before Sat.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Left over beef mince' })).not.toBeInTheDocument()
  })

  it('works out the rest from the amount bought, and can be turned down', async () => {
    renderTab()
    const sheet = await openItem('beef mince')
    fireEvent.change(within(sheet).getByLabelText('Bought'), { target: { value: '1' } })
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Bought unit' }), { target: { value: 'kg' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and tick' }))
    const offer = screen.getByRole('group', { name: 'Left over beef mince' })
    expect(within(offer).getByRole('button', { name: 'Add the rest to the pantry (500 g)' })).toBeInTheDocument()
    fireEvent.click(within(offer).getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(api.addLeftover).not.toHaveBeenCalled()
  })

  it('offers nothing when nothing is left over, or the item is not an ingredient', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('checkbox', { name: /^lettuce/ }))
    fireEvent.click(tick('milk'))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})
