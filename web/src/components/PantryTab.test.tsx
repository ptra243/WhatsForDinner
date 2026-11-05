import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanAskClaude } from '../lib/askAccess'
import type { PantryItem } from '../lib/pantry'
import { PantryTab } from './PantryTab'

const api = vi.hoisted(() => ({
  loadPantry: vi.fn(),
  addPantryItem: vi.fn(async () => {}),
  updatePantryItem: vi.fn(async () => {}),
  removePantryItem: vi.fn(async () => {}),
  subscribePantry: vi.fn(),
  askClaude: vi.fn(async () => 'opened'),
}))
vi.mock('../lib/pantry', async (actual) => ({ ...(await actual<typeof import('../lib/pantry')>()), ...api }))
vi.mock('../lib/claude', async (actual) => ({ ...(await actual<typeof import('../lib/claude')>()), askClaude: api.askClaude }))

const item = (change: Partial<PantryItem>): PantryItem => ({
  id: 'p1',
  slug: 'chicken-thigh',
  name: 'chicken thigh',
  qty: 300,
  unit: 'g',
  location: 'fridge',
  bestBefore: '2026-11-05',
  note: 'on special',
  ...change,
})

const ingredients = {
  'chicken thigh': { slug: 'chicken-thigh', name: 'chicken thigh', section: 'meat and seafood', shelfDays: 3 },
  rice: { slug: 'rice', name: 'rice', section: 'pantry', shelfDays: 730 },
  milk: { slug: 'milk', name: 'milk', section: 'dairy and fridge', shelfDays: 10 },
}

let realtime: () => void = () => {}

beforeEach(() => {
  // Wednesday 4 November 2026.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 4, 12))
  vi.clearAllMocks()
  api.loadPantry.mockImplementation(async () => ({
    items: [
      item({}),
      item({ id: 'p2', slug: 'milk', name: 'milk', qty: 2, unit: 'l', bestBefore: '2026-11-03', note: '' }),
      item({ id: 'p3', slug: 'rice', name: 'rice', qty: null, unit: 'each', location: 'pantry', bestBefore: '2027-05-01', note: '' }),
    ],
    ingredients,
  }))
  api.subscribePantry.mockImplementation((_h: string, cb: () => void) => {
    realtime = cb
    return () => {}
  })
})
afterEach(() => vi.useRealTimers())

const renderTab = ({ adding = false, owner = true, onAddClose = () => {} } = {}) =>
  render(
    <CanAskClaude.Provider value={owner}>
      <PantryTab householdId="h1" adding={adding} onAddClose={onAddClose} />
    </CanAskClaude.Provider>,
  )

describe('Pantry tab', () => {
  it('lists items by location, flagging those past or near best-before', async () => {
    renderTab()
    await screen.findByText('chicken thigh')
    expect(api.loadPantry).toHaveBeenCalledWith('h1')
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Fridge', 'Pantry'])
    const fridge = within(screen.getByRole('region', { name: 'Fridge' }))
    const [milk, chicken] = fridge.getAllByRole('button')
    expect(milk).toHaveTextContent('milk2 lPast best before3 Nov')
    expect(chicken).toHaveTextContent('chicken thigh300 g · on specialUse soontomorrow')
    expect(within(screen.getByRole('region', { name: 'Pantry' })).getByRole('button')).toHaveTextContent('ricesomeBest before1 May 2027')
    expect(screen.getByRole('status')).toHaveTextContent('2 items past or near best-before')
  })

  it('says so when the pantry is empty', async () => {
    api.loadPantry.mockResolvedValue({ items: [], ingredients })
    renderTab()
    expect(await screen.findByRole('heading', { name: 'Nothing in the pantry yet' })).toBeInTheDocument()
  })

  it('adds an item, with the best-before from its shelf life until it is changed', async () => {
    const onAddClose = vi.fn()
    renderTab({ adding: true, onAddClose })
    const sheet = await screen.findByRole('dialog', { name: 'Add to the pantry' })
    fireEvent.change(within(sheet).getByLabelText('Item'), { target: { value: 'Chicken thigh' } })
    expect(within(sheet).getByLabelText('Best before')).toHaveValue('2026-11-07')
    expect(within(sheet).getByText('Keeps about 3 days once bought.')).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Amount'), { target: { value: '500' } })
    fireEvent.change(within(sheet).getByLabelText('Unit'), { target: { value: 'g' } })
    fireEvent.change(within(sheet).getByLabelText('Where'), { target: { value: 'freezer' } })
    fireEvent.change(within(sheet).getByLabelText('Best before'), { target: { value: '2027-01-31' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to the pantry' }))
    await waitFor(() =>
      expect(api.addPantryItem).toHaveBeenCalledWith(
        'h1',
        { slug: 'chicken-thigh', qty: 500, unit: 'g', location: 'freezer', bestBefore: '2027-01-31', note: '' },
        undefined,
      ),
    )
    expect(onAddClose).toHaveBeenCalled()
    await waitFor(() => expect(api.loadPantry).toHaveBeenCalledTimes(2))
  })

  it('asks for the section of a new ingredient before adding it', async () => {
    renderTab({ adding: true })
    const sheet = await screen.findByRole('dialog', { name: 'Add to the pantry' })
    fireEvent.change(within(sheet).getByLabelText('Item'), { target: { value: 'quince paste' } })
    expect(within(sheet).getByLabelText('Best before')).toHaveValue('')
    const add = within(sheet).getByRole('button', { name: 'Add to the pantry' })
    expect(add).toBeDisabled()
    expect(within(sheet).getByText('Pick a section for a new ingredient.')).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Section (a new ingredient)'), { target: { value: 'dairy and fridge' } })
    fireEvent.click(add)
    await waitFor(() =>
      expect(api.addPantryItem).toHaveBeenCalledWith(
        'h1',
        { slug: 'quince-paste', qty: null, unit: 'each', location: 'fridge', bestBefore: null, note: '' },
        { name: 'quince paste', section: 'dairy and fridge' },
      ),
    )
  })

  it('edits an item and takes it off when used up', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /^chicken thigh/ }))
    let sheet = screen.getByRole('dialog', { name: 'chicken thigh' })
    expect(within(sheet).getByLabelText('Best before')).toHaveValue('2026-11-05')
    fireEvent.change(within(sheet).getByLabelText('Amount'), { target: { value: '150' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updatePantryItem).toHaveBeenCalledWith(
        'p1',
        { slug: 'chicken-thigh', qty: 150, unit: 'g', location: 'fridge', bestBefore: '2026-11-05', note: 'on special' },
        undefined,
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^milk/ }))
    sheet = screen.getByRole('dialog', { name: 'milk' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Used up' }))
    await waitFor(() => expect(api.removePantryItem).toHaveBeenCalledWith('p2'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reloads when the other member changes the pantry', async () => {
    renderTab()
    await screen.findByText('rice')
    api.loadPantry.mockResolvedValue({ items: [item({ id: 'p9', slug: 'rice', name: 'rice', location: 'pantry' })], ingredients })
    vi.useFakeTimers()
    act(() => realtime())
    await act(async () => vi.advanceTimersByTime(300))
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByText('chicken thigh')).not.toBeInTheDocument())
  })

  it('lets the owner ask Claude to plan around the pantry', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Plan around my pantry' }))
    expect(api.askClaude).toHaveBeenCalledWith(
      "Plan around my What's for Dinner pantry for the week of 2 Nov to 8 Nov (starting 2026-11-02): rework the nights not cooked yet to use what's soonest best-before first.",
    )
  })

  it('shows members no Ask Claude button', async () => {
    renderTab({ owner: false })
    await screen.findByText('rice')
    expect(screen.queryByRole('button', { name: 'Plan around my pantry' })).not.toBeInTheDocument()
  })
})
