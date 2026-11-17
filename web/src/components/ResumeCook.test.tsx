import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CookSession } from '../lib/cookSession'
import type { Recipe } from '../lib/recipes'
import { CookMode } from './CookMode'
import { ResumeCook } from './ResumeCook'

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
  rating: null,
  notes: '',
  isExample: false,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [
    { name: 'red lentil', qty: 0.5, unit: 'kg', note: '' },
    { name: 'onion', qty: 1, unit: 'each', note: 'diced' },
  ],
  steps: [
    { text: 'Fry the onion.', timerMins: 5 },
    { text: 'Add the lentils and simmer.', timerMins: 2 },
    { id: 'rest', text: 'Rest it.', timerMins: null, optional: true },
    { text: 'Serve.', timerMins: null },
  ],
}
const RICE: Recipe = { ...DAL, id: 'rice', name: 'Steamed rice', course: 'side', steps: [{ text: 'Steam the rice.', timerMins: 12 }] }

/** Wednesday 28 Oct 2026, 6 pm, in the week starting Monday 26 Oct. */
const SIX_PM = new Date(2026, 9, 28, 18).getTime()
const KEY = 'wfd.cook.h1.2026-10-26.wed.dal'
const saved = (key = KEY): CookSession | null => JSON.parse(localStorage.getItem(key) ?? 'null')

const later = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const flush = () => act(async () => {})

const noop = () => {}
const cook = (recipe = DAL, props: Partial<Parameters<typeof CookMode>[0]> = {}) =>
  render(<CookMode householdId="h1" recipe={recipe} servings={6} onChange={noop} onExit={noop} onDone={noop} {...props} />)
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

/** The app loading again: cook mode comes back only from what was saved. */
const reload = async (view: { unmount: () => void }) => {
  view.unmount()
  const next = render(<ResumeCook householdId="h1" />)
  await flush()
  return next
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(SIX_PM)
  api.loadRecipes.mockResolvedValue([RICE, DAL])
})
afterEach(() => vi.useRealTimers())

describe('Cook mode session', () => {
  it('saves the night, the dish, the step and each timer as you go', () => {
    cook(DAL, { extras: ['rest'] })
    expect(saved()).toMatchObject({
      householdId: 'h1',
      week: '2026-10-26',
      day: 'wed',
      recipeId: 'dal',
      methodId: null,
      extras: ['rest'],
      servings: 6,
      step: -1,
      finished: false,
      timers: {},
      savedAt: SIX_PM,
    })

    click('Start step 1')
    click('Start')
    later(60_000)
    click('Pause')
    click('Next')
    click('Start')
    // A paused timer keeps the seconds left, a running one the time it ends.
    expect(saved()).toMatchObject({
      step: 1,
      timers: {
        0: { endAt: null, left: 240, done: false },
        1: { endAt: SIX_PM + 60_000 + 120_000, left: 120, done: false },
      },
    })

    for (let i = 0; i < 2; i++) click('Next')
    click('Finish')
    expect(saved()).toMatchObject({ step: 3, finished: true })
  })

  it('reopens on the same dish and step after a reload, with the timers still right', async () => {
    const view = cook(DAL, { extras: ['rest'] })
    click('Start step 1')
    click('Start')
    later(60_000)
    click('Pause')
    click('Next')
    click('Start')

    // Away for 30 seconds while the phone throws the tab away.
    view.unmount()
    vi.setSystemTime(SIX_PM + 90_000)
    render(<ResumeCook householdId="h1" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await flush()

    expect(api.loadRecipes).toHaveBeenCalledWith('h1')
    const dialog = screen.getByRole('dialog', { name: 'Cooking Red lentil dal' })
    expect(dialog).toHaveTextContent('Step 2 of 4')
    expect(within(dialog).getByRole('region', { name: 'This step uses' })).toHaveTextContent('red lentil750 g')
    expect(within(dialog).getByRole('timer')).toHaveTextContent('1:30')
    expect(within(dialog).getByRole('button', { name: 'Step 1 timer: 4:00 paused' })).toBeInTheDocument()

    later(90_000)
    expect(within(dialog).getByRole('timer')).toHaveTextContent('Time’s up')
    expect(saved()?.timers[1]).toEqual({ endAt: null, left: 0, done: true })
  })

  it('shows a timer that ended while you were away as done', async () => {
    const view = cook()
    click('Start step 1')
    click('Next')
    click('Start')
    click('Back')
    view.unmount()
    vi.setSystemTime(SIX_PM + 10 * 60_000)
    render(<ResumeCook householdId="h1" />)
    await flush()

    expect(screen.getByRole('dialog')).toHaveTextContent('Step 1 of 3')
    click('Step 2 timer: time’s up')
    expect(screen.getByRole('timer')).toHaveTextContent('Time’s up')
  })

  it('comes back to the prep list and to the finish screen', async () => {
    let view = await reload(cook())
    expect(screen.getByRole('heading', { name: 'Get these ready' })).toBeInTheDocument()

    view = await reload(view)
    click('Start step 1')
    for (let i = 0; i < 2; i++) click('Next')
    click('Finish')
    await reload(view)
    expect(screen.getByRole('dialog', { name: 'Finished cooking' })).toBeInTheDocument()
  })

  it('keeps two dishes on a night apart', async () => {
    const dal = cook()
    click('Start step 1')
    click('Next')
    dal.unmount()
    vi.setSystemTime(SIX_PM + 60_000)
    const rice = cook(RICE)
    click('Start step 1')
    click('Start')
    expect(saved()).toMatchObject({ recipeId: 'dal', step: 1, timers: {} })
    expect(saved('wfd.cook.h1.2026-10-26.wed.rice')).toMatchObject({ recipeId: 'rice', step: 0, timers: { 0: { left: 720 } } })

    // The app reopens the one cooked last; the other is picked up when it is opened again.
    const reopened = await reload(rice)
    expect(screen.getByRole('dialog', { name: 'Cooking Steamed rice' })).toHaveTextContent('Step 1 of 1')
    reopened.unmount()
    cook()
    expect(screen.getByRole('dialog', { name: 'Cooking Red lentil dal' })).toHaveTextContent('Step 2 of 3')
  })

  it('starts again when the dish is cooked another way', () => {
    const view = cook()
    click('Start step 1')
    click('Next')
    view.unmount()
    cook(DAL, { extras: ['rest'] })
    expect(screen.getByRole('heading', { name: 'Get these ready' })).toBeInTheDocument()
    expect(saved()).toMatchObject({ extras: ['rest'], step: -1 })
  })

  it('forgets the session when cook mode is closed on purpose', async () => {
    const onExit = vi.fn()
    const view = cook(DAL, { onExit })
    click('Start step 1')
    click('‹ Recipe')
    expect(onExit).toHaveBeenCalled()
    expect(saved()).toBeNull()
    await reload(view)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.loadRecipes).not.toHaveBeenCalled()
  })

  it('forgets the session when the dish is marked cooked, and keeps it when that fails', async () => {
    api.markCooked.mockRejectedValueOnce({ message: 'offline' })
    const onDone = vi.fn()
    cook(DAL, { onDone })
    click('Start step 1')
    for (let i = 0; i < 2; i++) click('Next')
    click('Finish')
    click('Mark as cooked')
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('offline')
    expect(saved()).toMatchObject({ finished: true })

    click('Mark as cooked')
    await flush()
    expect(onDone).toHaveBeenCalledWith('Marked as cooked. Tonight is ticked off.')
    expect(saved()).toBeNull()
  })

  it('closes the reopened cook mode on going back, and on marking as cooked', async () => {
    let view = cook()
    click('Start step 1')
    view = await reload(view)
    click('‹ Recipe')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved()).toBeNull()

    view.unmount()
    view = cook()
    click('Start step 1')
    for (let i = 0; i < 2; i++) click('Next')
    click('Finish')
    await reload(view)
    click('Mark as cooked')
    await flush()
    expect(api.markCooked).toHaveBeenCalledWith('h1', 'dal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved()).toBeNull()
  })

  it('ignores a session more than 12 hours old, and one that is not a session', async () => {
    const view = cook()
    click('Start step 1')
    view.unmount()
    vi.setSystemTime(SIX_PM + 11 * 3600_000)
    const first = render(<ResumeCook householdId="h1" />)
    await flush()
    expect(screen.getByRole('dialog')).toHaveTextContent('Step 1 of 3')

    // Reopening saved it again at 5 am; 12 hours on it is too old.
    first.unmount()
    vi.setSystemTime(SIX_PM + 23 * 3600_000 + 1)
    const second = render(<ResumeCook householdId="h1" />)
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBeNull()

    localStorage.setItem(KEY, '{"step":"two"}')
    localStorage.setItem('wfd.cook.h1.2026-10-26.wed.rice', 'not json')
    second.unmount()
    render(<ResumeCook householdId="h1" />)
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves another household’s session alone', async () => {
    const view = cook(DAL, { householdId: 'h2' })
    await reload(view)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved('wfd.cook.h2.2026-10-26.wed.dal')).toMatchObject({ householdId: 'h2' })
  })

  it('drops the session of a recipe that is gone, and keeps it when the recipes cannot be loaded', async () => {
    api.loadRecipes.mockRejectedValueOnce({ message: 'offline' })
    const view = await reload(cook())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved()).toMatchObject({ step: -1 })

    api.loadRecipes.mockResolvedValueOnce([RICE])
    await reload(view)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved()).toBeNull()
  })

  it('keeps the night it started on when reopened after midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 23, 50))
    const view = cook()
    click('Start step 1')
    view.unmount()
    vi.setSystemTime(new Date(2026, 9, 29, 0, 5))
    render(<ResumeCook householdId="h1" />)
    await flush()
    click('Next')
    expect(saved()).toMatchObject({ day: 'wed', step: 1 })
    expect(localStorage.getItem('wfd.cook.h1.2026-10-26.thu.dal')).toBeNull()
  })
})
