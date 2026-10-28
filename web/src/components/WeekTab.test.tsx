import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, emptyWeek, type Week } from '../lib/plan'
import type { Recipe } from '../lib/recipes'
import { WeekTab } from './WeekTab'

const api = vi.hoisted(() => ({
  loadWeek: vi.fn(),
  loadSettings: vi.fn(),
  setServings: vi.fn(async () => {}),
  removeDish: vi.fn(async () => {}),
  setNightFlags: vi.fn(async () => {}),
  subscribePlan: vi.fn(),
  loadRecipes: vi.fn(),
  addToNight: vi.fn(async () => {}),
  updateRecipe: vi.fn(async () => {}),
  markCooked: vi.fn(async () => true),
}))
vi.mock('../lib/plan', async (actual) => ({ ...(await actual<typeof import('../lib/plan')>()), ...api }))
vi.mock('../lib/recipes', async (actual) => ({ ...(await actual<typeof import('../lib/recipes')>()), ...api }))

const recipe = (r: Partial<Recipe> & Pick<Recipe, 'id' | 'name'>): Recipe => ({
  course: 'main',
  serves: 4,
  activeMins: null,
  totalMins: null,
  provides: [],
  tags: [],
  source: '',
  rating: null,
  notes: '',
  isExample: false,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [],
  steps: [],
  ...r,
})

const RECIPES = [
  recipe({ id: 'curry', name: 'Chicken curry', activeMins: 30, totalMins: 60, provides: ['protein', 'veg'] }),
  recipe({ id: 'stew', name: 'Beef stew', activeMins: 50, totalMins: 150, provides: ['protein', 'veg', 'carb'], tags: ['slow'] }),
  recipe({ id: 'rice', name: 'Steamed rice', course: 'side', activeMins: 5, totalMins: 25, provides: ['carb'], rating: 4 }),
  recipe({ id: 'naan', name: 'Naan', course: 'side', provides: ['carb'], rating: 5 }),
  recipe({ id: 'salad', name: 'Green salad', course: 'side', provides: ['veg'] }),
]

/** This week (Mon 26 Oct 2026): curry tonight (Wednesday), stew with rice on Thursday, Monday cooked. */
const plan = (): Week => {
  const w = emptyWeek()
  w.mon = { dishes: [{ id: 'm1', recipeId: 'stew', role: 'main', servings: 4, position: 0 }], cooked: true, skipCheck: false }
  w.wed.dishes = [{ id: 'w1', recipeId: 'curry', role: 'main', servings: 4, position: 0 }]
  w.thu.dishes = [
    { id: 't1', recipeId: 'stew', role: 'main', servings: 4, position: 0 },
    { id: 't2', recipeId: 'rice', role: 'side', servings: 4, position: 1 },
  ]
  return w
}

let realtime: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 12)) // Wednesday
  vi.clearAllMocks()
  api.loadWeek.mockImplementation(async (_h: string, week: string) => (week === '2026-10-26' ? plan() : emptyWeek()))
  api.loadSettings.mockResolvedValue(DEFAULT_SETTINGS)
  api.loadRecipes.mockResolvedValue(RECIPES)
  api.subscribePlan.mockImplementation((_h: string, cb: () => void) => {
    realtime = cb
    return () => {}
  })
})
afterEach(() => vi.useRealTimers())

const night = (day: RegExp) => screen.getByRole('group', { name: day })
const openNight = async (day: RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name: day }))
  return screen.getByRole('dialog')
}

describe('Week card', () => {
  it('shows this week’s seven nights with mains, sides and times', async () => {
    render(<WeekTab householdId="h1" />)
    expect(await screen.findByText('26 Oct to 1 Nov')).toBeInTheDocument()
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(api.loadWeek).toHaveBeenCalledWith('h1', '2026-10-26')
    expect(document.querySelectorAll('.night')).toHaveLength(7)
    expect(night(/^Thu 29/)).toHaveTextContent('Beef stew')
    expect(night(/^Thu 29/)).toHaveTextContent('Steamed rice')
    expect(night(/^Thu 29/)).toHaveTextContent('2 h 30')
    expect(night(/^Fri 30/)).toHaveTextContent('Nothing planned')
  })

  it('marks tonight with a start-by time from dinner time', async () => {
    render(<WeekTab householdId="h1" />)
    const wed = await screen.findByRole('group', { name: /^Wed 28/ })
    expect(wed).toHaveTextContent('Tonight')
    expect(wed).toHaveTextContent('Start by 5:30 pm')
    expect(night(/^Thu 29/)).not.toHaveTextContent('Start by')
  })

  it('marks cooked nights', async () => {
    render(<WeekTab householdId="h1" />)
    const mon = await screen.findByRole('group', { name: /^Mon 26/ })
    expect(mon).toHaveClass('cooked')
    expect(mon).toHaveTextContent('cooked')
  })

  it('flags gaps and hands-on minutes over budget', async () => {
    render(<WeekTab householdId="h1" />)
    expect(await screen.findByRole('group', { name: /^Wed 28/ })).toHaveTextContent('No carb yet')
    expect(night(/^Thu 29/)).not.toHaveTextContent('No ')
    expect(night(/^Thu 29/)).toHaveTextContent('55 min hands-on')
    expect(night(/^Wed 28/)).not.toHaveTextContent('hands-on')
  })

  it('moves between weeks', async () => {
    render(<WeekTab householdId="h1" />)
    await screen.findAllByText('Beef stew')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText('Nothing planned for this week')).toBeInTheDocument()
    expect(screen.getByText('Next week')).toBeInTheDocument()
    expect(api.loadWeek).toHaveBeenLastCalledWith('h1', '2026-11-02')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByText('19 Oct to 25 Oct')).toBeInTheDocument()
  })

  it('reloads when the plan changes in the database', async () => {
    render(<WeekTab householdId="h1" />)
    await screen.findByRole('button', { name: /^Fri 30/ })
    const changed = plan()
    changed.fri.dishes = [{ id: 'f1', recipeId: 'curry', role: 'main', servings: 2, position: 0 }]
    api.loadWeek.mockResolvedValue(changed)
    act(() => realtime())
    await waitFor(() => expect(night(/^Fri 30/)).toHaveTextContent('Chicken curry'))
  })
})

describe('From the card to the recipe', () => {
  it('opens a night’s main or side at the night’s servings', async () => {
    api.loadWeek.mockImplementation(async () => {
      const w = plan()
      w.thu.dishes[1].servings = 6
      return w
    })
    api.loadRecipes.mockResolvedValue([
      RECIPES[0],
      { ...RECIPES[1], ingredients: [{ name: 'beef', qty: 1, unit: 'kg', note: '' }] },
      { ...RECIPES[2], serves: 2, ingredients: [{ name: 'rice', qty: 200, unit: 'g', note: '' }] },
      ...RECIPES.slice(3),
    ])
    render(<WeekTab householdId="h1" />)
    await screen.findByRole('group', { name: /^Thu 29/ })
    fireEvent.click(within(night(/^Thu 29/)).getByRole('button', { name: 'Steamed rice' }))
    const view = screen.getByRole('dialog', { name: 'Steamed rice' })
    expect(view).toHaveTextContent('6 serves')
    expect(view).toHaveTextContent('600 g')
    fireEvent.click(within(view).getByRole('button', { name: '‹ Back' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(within(night(/^Thu 29/)).getByRole('button', { name: 'Beef stew' }))
    expect(screen.getByRole('dialog', { name: 'Beef stew' })).toHaveTextContent('4 serves')
  })

  it('cooks tonight’s main from the card and ticks the night off', async () => {
    api.loadWeek.mockImplementation(async () => {
      const w = plan()
      w.wed.dishes[0].servings = 2
      return w
    })
    api.loadRecipes.mockResolvedValue([
      {
        ...RECIPES[0],
        ingredients: [{ name: 'chicken thigh', qty: 1, unit: 'kg', note: '' }],
        steps: [{ text: 'Brown the chicken thigh.', timerMins: null }],
      },
      ...RECIPES.slice(1),
    ])
    render(<WeekTab householdId="h1" />)
    const wed = await screen.findByRole('group', { name: /^Wed 28/ })
    expect(within(night(/^Thu 29/)).queryByRole('button', { name: /^Cook/ })).not.toBeInTheDocument()
    fireEvent.click(within(wed).getByRole('button', { name: 'Cook Chicken curry' }))
    const cook = screen.getByRole('dialog', { name: 'Cooking Chicken curry' })
    expect(within(cook).getByRole('region', { name: 'This step uses' })).toHaveTextContent('500 g')
    expect(screen.queryByRole('dialog', { name: /Wednesday/ })).not.toBeInTheDocument()

    fireEvent.click(within(cook).getByRole('button', { name: /Finish/ }))
    const finished = screen.getByRole('dialog', { name: 'Finished cooking' })
    fireEvent.click(within(finished).getByRole('button', { name: /Mark as cooked/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Tonight is ticked off.')
    expect(api.markCooked).toHaveBeenCalledWith('h1', 'curry')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has no Cook button once tonight is cooked', async () => {
    api.loadWeek.mockImplementation(async () => {
      const w = plan()
      w.wed.cooked = true
      return w
    })
    render(<WeekTab householdId="h1" />)
    const wed = await screen.findByRole('group', { name: /^Wed 28/ })
    expect(within(wed).queryByRole('button', { name: /^Cook/ })).not.toBeInTheDocument()
  })

  it('still edits the night from the day or the rest of the row', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    expect(sheet).toHaveAccessibleName('Thursday 29 Oct')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    fireEvent.click(within(night(/^Thu 29/)).getByText('2 h 30'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Thursday 29 Oct')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(within(night(/^Fri 30/)).getByRole('button', { name: 'Nothing planned' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Friday 30 Oct')
  })
})

describe('Night sheet', () => {
  it('shows the night’s dishes, times and budget', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    expect(sheet).toHaveAccessibleName('Thursday 29 Oct')
    expect(sheet).toHaveTextContent('55 min hands-on · 2 h 30 total · budget 45 min · over the budget')
    expect(within(sheet).getByText('Beef stew')).toBeInTheDocument()
    expect(within(sheet).getAllByText('4 serves')).toHaveLength(2)
  })

  it('changes servings and removes dishes', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'More servings of Beef stew' }))
    expect(api.setServings).toHaveBeenCalledWith('t1', 5)
    expect(within(sheet).getByText('5 serves')).toBeInTheDocument()
    const remove = within(sheet).getByRole('button', { name: 'Remove Steamed rice' })
    await waitFor(() => expect(remove).toBeEnabled())
    fireEvent.click(remove)
    expect(api.removeDish).toHaveBeenCalledWith('t2')
    await waitFor(() => expect(within(sheet).queryByText('Steamed rice')).not.toBeInTheDocument())
  })

  it('never goes below one serving', async () => {
    api.loadWeek.mockImplementation(async () => {
      const w = plan()
      w.wed.dishes[0].servings = 1
      return w
    })
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Wed 28/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fewer servings of Chicken curry' }))
    expect(api.setServings).not.toHaveBeenCalled()
  })

  it('suggests sides for a gap and adds one at the main’s servings', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Wed 28/)
    expect(within(sheet).getByText('No carb yet')).toBeInTheDocument()
    const chips = within(sheet).getAllByRole('button', { name: /^\+ / })
    expect(chips.map((c) => c.textContent)).toEqual(['+ Naan', '+ Steamed rice'])
    fireEvent.click(chips[0])
    await waitFor(() => expect(api.addToNight).toHaveBeenCalledWith('h1', RECIPES[3], '2026-10-26', 'wed', 4, expect.any(String)))
  })

  it('adds a main or side from a searchable picker', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Fri 30/)
    expect(sheet).toHaveTextContent('Nothing planned yet.')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add main' }))
    const search = within(sheet).getByLabelText('Choose a main')
    expect(within(sheet).queryByRole('button', { name: /Naan/ })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'slow' } })
    expect(within(sheet).queryByRole('button', { name: /Chicken curry/ })).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: /Beef stew/ }))
    await waitFor(() => expect(api.addToNight).toHaveBeenCalledWith('h1', RECIPES[1], '2026-10-26', 'fri', 4, expect.any(String)))
    await waitFor(() => expect(api.loadWeek.mock.calls.length).toBeGreaterThan(1))

    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add side' }))
    fireEvent.change(within(sheet).getByLabelText('Choose a side'), { target: { value: 'zzz' } })
    expect(within(sheet).getByText('No sides match.')).toBeInTheDocument()
  })

  it('toggles cooked and the skip check', async () => {
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Wed 28/)
    fireEvent.click(within(sheet).getByLabelText('Cooked'))
    expect(api.setNightFlags).toHaveBeenCalledWith('h1', '2026-10-26', 'wed', { cooked: true })
    fireEvent.click(within(sheet).getByLabelText('Skip the veg and carb check this night'))
    expect(api.setNightFlags).toHaveBeenCalledWith('h1', '2026-10-26', 'wed', { skip_check: true })
    await waitFor(() => expect(within(sheet).queryByText('No carb yet')).not.toBeInTheDocument())
  })

  /** A write that waits until the test lets it finish (or fail). */
  const held = () => {
    let finish: (error?: unknown) => void = () => {}
    const write = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve())
    })
    return { write, finish }
  }
  const pickMain = (sheet: HTMLElement, name: RegExp) => {
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add main' }))
    fireEvent.click(within(sheet).getByRole('button', { name }))
  }
  const names = (day: RegExp) => within(night(day)).getAllByRole('button', { name: /curry|stew|rice/i }).map((b) => b.textContent)

  it('shows a chosen main on the night before the write finishes, and reloads once after', async () => {
    const { write, finish } = held()
    api.addToNight.mockReturnValueOnce(write)
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    const loads = api.loadWeek.mock.calls.length
    pickMain(sheet, /Chicken curry/)

    // Straight away: curry first as the main, the old main and rice now sides; the picker is closed.
    expect(names(/^Thu 29/)).toEqual(['Chicken curry', 'Beef stew', 'Steamed rice'])
    expect(within(sheet).getAllByText('Side')).toHaveLength(2)
    expect(within(sheet).queryByLabelText('Choose a main')).not.toBeInTheDocument()

    // Realtime changes from the write in progress do not reload over it.
    act(() => realtime())
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(api.loadWeek.mock.calls.length).toBe(loads)
    expect(names(/^Thu 29/)).toEqual(['Chicken curry', 'Beef stew', 'Steamed rice'])

    const id = (api.addToNight.mock.calls.at(-1) as unknown[])[5] as string
    api.loadWeek.mockImplementation(async () => {
      const w = plan()
      w.thu.dishes = [
        { id, recipeId: 'curry', role: 'main', servings: 4, position: 0 },
        { id: 't1', recipeId: 'stew', role: 'side', servings: 4, position: 1 },
        { id: 't2', recipeId: 'rice', role: 'side', servings: 4, position: 2 },
      ]
      return w
    })
    await act(async () => finish())
    await waitFor(() => expect(api.loadWeek.mock.calls.length).toBe(loads + 1))
    expect(names(/^Thu 29/)).toEqual(['Chicken curry', 'Beef stew', 'Steamed rice'])
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a later change shown while the reload from an earlier save comes back without it', async () => {
    const first = held()
    const second = held()
    api.addToNight.mockReturnValueOnce(first.write)
    api.setServings.mockReturnValueOnce(second.write)
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Fri 30/)
    pickMain(sheet, /Chicken curry/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'More servings of Chicken curry' }))
    expect(within(sheet).getByText('5 serves')).toBeInTheDocument()
    const loads = api.loadWeek.mock.calls.length
    await act(async () => first.finish())
    // Nothing reloads under the servings save still going; it reloads once when that finishes.
    expect(api.loadWeek.mock.calls.length).toBe(loads)
    expect(names(/^Fri 30/)).toEqual(['Chicken curry'])
    expect(within(sheet).getByText('5 serves')).toBeInTheDocument()
    await act(async () => second.finish())
    await waitFor(() => expect(api.loadWeek.mock.calls.length).toBe(loads + 1))
  })

  it('takes a chosen main back off the night and says why when the write fails', async () => {
    const { write, finish } = held()
    api.addToNight.mockReturnValueOnce(write)
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    pickMain(sheet, /Chicken curry/)
    expect(names(/^Thu 29/)).toEqual(['Chicken curry', 'Beef stew', 'Steamed rice'])
    await act(async () => finish({ message: 'network down' }))
    expect(names(/^Thu 29/)).toEqual(['Beef stew', 'Steamed rice'])
    expect(within(sheet).getByText('Main').closest('.dish')).toHaveTextContent('Beef stew')
    expect(within(sheet).getByRole('alert')).toHaveTextContent('network down')
  })

  it('shows a failed save', async () => {
    api.removeDish.mockRejectedValueOnce({ message: 'permission denied' })
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Wed 28/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Chicken curry' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('permission denied')
  })
})

describe('Ask Claude', () => {
  const asked = (open: { mock: { calls: unknown[][] } }) => new URL(String(open.mock.calls.at(-1)?.[0])).searchParams.get('q')

  it('asks about this week, or to plan an empty one', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<WeekTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Claude about this week' }))
    expect(asked(open)).toBe("About my What's for Dinner plan for the week of 26 Oct to 1 Nov (starting 2026-10-26): ")
    expect(screen.queryByRole('button', { name: 'Plan this week with Claude' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Plan this week with Claude' }))
    expect(asked(open)).toContain("Plan dinners in What's for Dinner for the week of 2 Nov to 8 Nov (starting 2026-11-02)")
    expect(screen.queryByRole('button', { name: 'Ask Claude about this week' })).not.toBeInTheDocument()
    open.mockRestore()
  })

  it('asks about a night', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<WeekTab householdId="h1" />)
    const sheet = await openNight(/^Thu 29/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ask Claude about Thursday' }))
    expect(asked(open)).toBe("About Thursday 29 Oct in my What's for Dinner plan (week starting 2026-10-26): ")
    open.mockRestore()
  })
})
