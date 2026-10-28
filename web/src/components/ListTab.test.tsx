import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  subscribeList: vi.fn(),
  askClaude: vi.fn(async () => 'opened'),
}))
vi.mock('../lib/shop', async (actual) => ({ ...(await actual<typeof import('../lib/shop')>()), ...api }))
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
    week === '2026-10-26' ? data() : { dishes: [], sections: {}, extras: [], marks: {} },
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
    expect(api.setMark).toHaveBeenLastCalledWith('h1', '2026-10-26', 'lettuce|each', { ticked: false })
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
      expect(api.addExtra).toHaveBeenCalledWith('h1', '2026-10-26', { name: 'onion', qty: 3, unit: 'each', section: 'fruit and veg' }),
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

  it('shows the last-loaded list but no ticking or other changes', async () => {
    renderTab()
    await screen.findByText('lettuce')
    setOnline(false)
    expect(tick('lettuce')).toBeDisabled()
    const sheet = await openItem('milk')
    for (const name of ['Save and tick', 'Couldn’t get it', 'Already have it', 'Remove from list']) {
      expect(within(sheet).getByRole('button', { name })).toBeDisabled()
    }
    expect(within(sheet).getByLabelText('Section')).toBeDisabled()
  })

  it('reloads and allows ticking again when the signal is back', async () => {
    renderTab()
    await screen.findByText('lettuce')
    setOnline(false)
    expect(api.loadList).toHaveBeenCalledTimes(2)
    setOnline(true)
    await waitFor(() => expect(api.loadList).toHaveBeenCalledTimes(3))
    expect(tick('lettuce')).toBeEnabled()
  })
})
