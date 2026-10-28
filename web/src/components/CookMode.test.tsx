import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recipe } from '../lib/recipes'
import { RecipesTab } from './RecipesTab'

const api = vi.hoisted(() => ({
  loadRecipes: vi.fn(),
  updateRecipe: vi.fn(async () => {}),
  markCooked: vi.fn(async () => true),
}))
vi.mock('../lib/recipes', async (actual) => ({ ...(await actual<typeof import('../lib/recipes')>()), ...api }))

const DAL: Recipe = {
  id: 'dal',
  name: 'Red lentil dal',
  course: 'main',
  serves: 4,
  activeMins: 20,
  totalMins: 60,
  provides: [],
  tags: [],
  source: '',
  rating: 3,
  notes: 'Less chilli',
  isExample: false,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [
    { name: 'red lentil', qty: 0.5, unit: 'kg', note: '' },
    { name: 'onion', qty: 1, unit: 'each', note: 'diced' },
    { name: 'water', qty: 1, unit: 'l', note: '' },
  ],
  steps: [
    { text: 'Fry the onion.', timerMins: null },
    { text: 'Add the lentils and water and simmer.', timerMins: 2 },
    { text: 'Rest, then serve.', timerMins: 1 },
  ],
}

const lock = { release: vi.fn(async () => {}), addEventListener: vi.fn() }
const wakeLock = { request: vi.fn(async () => lock) }

beforeEach(() => {
  vi.clearAllMocks()
  api.loadRecipes.mockResolvedValue([{ ...DAL }])
  Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

const startCooking = async (servings = 0) => {
  render(<RecipesTab householdId="h1" />)
  fireEvent.click(await screen.findByRole('button', { name: /Red lentil dal/ }))
  const view = screen.getByRole('dialog', { name: 'Red lentil dal' })
  for (let i = 0; i < servings; i++) fireEvent.click(within(view).getByRole('button', { name: 'More servings' }))
  fireEvent.click(within(view).getByRole('button', { name: 'Start cooking' }))
  return screen.getByRole('dialog', { name: 'Cooking Red lentil dal' })
}

describe('Cook mode', () => {
  it('shows one step at a time with progress and the scaled ingredients it uses', async () => {
    const cook = await startCooking(4)
    expect(cook).toHaveTextContent('Step 1 of 3')
    expect(within(cook).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(within(cook).getByText('Fry the onion.')).toBeInTheDocument()
    expect(within(cook).getByRole('region', { name: 'This step uses' })).toHaveTextContent('onion diced2 each')
    expect(within(cook).getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(within(cook).queryByRole('region', { name: 'Timer' })).not.toBeInTheDocument()

    fireEvent.click(within(cook).getByRole('button', { name: 'Next' }))
    expect(cook).toHaveTextContent('Step 2 of 3')
    const uses = within(cook).getByRole('region', { name: 'This step uses' })
    expect(uses).toHaveTextContent('red lentil1 kg')
    expect(uses).toHaveTextContent('water2 l')
    expect(uses).not.toHaveTextContent('onion')

    fireEvent.click(within(cook).getByRole('button', { name: 'Back' }))
    expect(cook).toHaveTextContent('Step 1 of 3')
  })

  it('runs a step timer: start, pause, resume, reset, and time’s up with a sound', async () => {
    const beeps = vi.fn()
    const node = () => ({ connect: vi.fn(), start: beeps, stop: vi.fn(), frequency: {}, gain: {} })
    class FakeAudio {
      state = 'suspended'
      currentTime = 0
      destination = {}
      resume = vi.fn(async () => {})
      close = vi.fn(async () => {})
      createOscillator = node
      createGain = node
    }
    vi.stubGlobal('AudioContext', FakeAudio)
    const cook = await startCooking()
    vi.useFakeTimers()
    fireEvent.click(within(cook).getByRole('button', { name: 'Next' }))
    const timer = within(cook).getByRole('region', { name: 'Timer' })
    expect(within(timer).getByRole('timer')).toHaveTextContent('2:00')

    fireEvent.click(within(timer).getByRole('button', { name: 'Start' }))
    act(() => vi.advanceTimersByTime(30_000))
    expect(within(timer).getByRole('timer')).toHaveTextContent('1:30')

    fireEvent.click(within(timer).getByRole('button', { name: 'Pause' }))
    act(() => vi.advanceTimersByTime(60_000))
    expect(within(timer).getByRole('timer')).toHaveTextContent('1:30')

    fireEvent.click(within(timer).getByRole('button', { name: 'Resume' }))
    act(() => vi.advanceTimersByTime(89_000))
    expect(beeps).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(within(timer).getByRole('timer')).toHaveTextContent('Time’s up')
    expect(beeps).toHaveBeenCalledTimes(3)

    fireEvent.click(within(timer).getByRole('button', { name: 'Reset' }))
    expect(within(timer).getByRole('timer')).toHaveTextContent('2:00')
    expect(within(timer).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('keeps a timer running on other steps and goes back to it', async () => {
    const cook = await startCooking()
    vi.useFakeTimers()
    fireEvent.click(within(cook).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(cook).getByRole('button', { name: 'Start' }))
    fireEvent.click(within(cook).getByRole('button', { name: 'Next' }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(within(cook).getByRole('timer')).toHaveTextContent('1:00')
    expect(within(cook).getByRole('button', { name: 'Step 2 timer: 1:50' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(110_000))
    fireEvent.click(within(cook).getByRole('button', { name: 'Step 2 timer: time’s up' }))
    expect(cook).toHaveTextContent('Step 2 of 3')
  })

  it('keeps the screen awake while open and lets go on exit', async () => {
    const cook = await startCooking()
    expect(wakeLock.request).toHaveBeenCalledWith('screen')
    expect(await within(cook).findByText('Screen stays awake while you cook.')).toBeInTheDocument()
    fireEvent.click(within(cook).getByRole('button', { name: '‹ Recipe' }))
    expect(screen.queryByRole('dialog', { name: /Cooking/ })).not.toBeInTheDocument()
    expect(lock.release).toHaveBeenCalled()
  })

  it('cooks without the wake lock where the browser has none', async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock
    const cook = await startCooking()
    expect(within(cook).queryByText('Screen stays awake while you cook.')).not.toBeInTheDocument()
  })

  it('finishes with a rating and note, and marks as cooked', async () => {
    const cook = await startCooking()
    for (let i = 0; i < 2; i++) fireEvent.click(within(cook).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(cook).getByRole('button', { name: 'Finish' }))

    const done = screen.getByRole('dialog', { name: 'Finished cooking' })
    fireEvent.click(within(done).getByRole('button', { name: '5 stars' }))
    expect(api.updateRecipe).toHaveBeenLastCalledWith('dal', { rating: 5 })
    expect(await within(done).findByRole('button', { name: '5 stars', pressed: true })).toBeInTheDocument()

    const note = within(done).getByLabelText('Note for next time')
    expect(note).toHaveValue('Less chilli')
    fireEvent.change(note, { target: { value: 'Less chilli, more lemon' } })
    fireEvent.click(within(done).getByRole('button', { name: 'Mark as cooked' }))
    await vi.waitFor(() => expect(api.markCooked).toHaveBeenCalledWith('h1', 'dal'))
    expect(api.updateRecipe).toHaveBeenCalledWith('dal', { notes: 'Less chilli, more lemon' })

    const view = screen.getByRole('dialog', { name: 'Red lentil dal' })
    expect(await within(view).findByRole('status')).toHaveTextContent('Marked as cooked. Tonight is ticked off.')
    expect(within(view).getByLabelText('Notes for next time')).toHaveValue('Less chilli, more lemon')
    expect(screen.queryByRole('dialog', { name: 'Finished cooking' })).not.toBeInTheDocument()
  })

  it('says so when the recipe is not planned tonight, and shows a save error', async () => {
    api.markCooked.mockResolvedValueOnce(false).mockRejectedValueOnce({ message: 'offline' })
    let cook = await startCooking()
    for (let i = 0; i < 3; i++) fireEvent.click(within(cook).getByRole('button', { name: /Next|Finish/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark as cooked' }))
    const view = screen.getByRole('dialog', { name: 'Red lentil dal' })
    expect(await within(view).findByRole('status')).toHaveTextContent(/^Marked as cooked\.$/)
    expect(api.updateRecipe).not.toHaveBeenCalled()

    fireEvent.click(within(view).getByRole('button', { name: 'Start cooking' }))
    cook = screen.getByRole('dialog', { name: 'Cooking Red lentil dal' })
    for (let i = 0; i < 3; i++) fireEvent.click(within(cook).getByRole('button', { name: /Next|Finish/ }))
    const done = screen.getByRole('dialog', { name: 'Finished cooking' })
    fireEvent.click(within(done).getByRole('button', { name: 'Mark as cooked' }))
    expect(await within(done).findByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(within(done).getByRole('button', { name: '‹ Steps' }))
    expect(screen.getByRole('dialog', { name: 'Cooking Red lentil dal' })).toHaveTextContent('Step 3 of 3')
  })
})
