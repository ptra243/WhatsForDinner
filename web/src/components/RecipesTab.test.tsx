import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../lib/plan'
import type { Recipe } from '../lib/recipes'
import { RecipesTab } from './RecipesTab'

const api = vi.hoisted(() => ({
  loadRecipes: vi.fn(),
  updateRecipe: vi.fn(async () => {}),
  deleteRecipe: vi.fn(async () => {}),
  loadWeekMains: vi.fn(async () => ({ tue: 'Fish tacos' })),
  addToNight: vi.fn(async () => {}),
}))
vi.mock('../lib/recipes', async (actual) => ({ ...(await actual<typeof import('../lib/recipes')>()), ...api }))
const plan = vi.hoisted(() => ({ loadSettings: vi.fn() }))
vi.mock('../lib/plan', async (actual) => ({ ...(await actual<typeof import('../lib/plan')>()), ...plan }))

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
  recipe({
    id: 'dal',
    name: 'Red lentil dal',
    activeMins: 20,
    totalMins: 90,
    rating: 4,
    isExample: true,
    provides: ['protein', 'veg'],
    tags: ['vegetarian'],
    source: 'Grandma',
    ingredients: [
      { name: 'red lentil', qty: 0.5, unit: 'kg', note: '' },
      { name: 'onion', qty: 1, unit: 'each', note: 'diced' },
      { name: 'ghee', qty: 2, unit: 'tbsp', note: '', allergens: ['milk'] },
      { name: 'salt', qty: null, unit: 'tsp', note: '' },
    ],
    steps: [
      { text: 'Fry the onion.', timerMins: null },
      { text: 'Simmer the lentils.', timerMins: 25 },
    ],
  }),
  recipe({
    id: 'rice',
    name: 'Rice pudding',
    course: 'side',
    ingredients: [
      { name: 'jasmine rice', qty: 300, unit: 'g', note: '' },
      { name: 'milk', qty: 1, unit: 'l', note: '', allergens: ['milk'] },
    ],
  }),
]

const names = () =>
  within(document.querySelector('.reclist') as HTMLElement)
    .queryAllByRole('button')
    .map((b) => b.querySelector('.t > span')?.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  api.loadRecipes.mockResolvedValue(RECIPES.map((r) => ({ ...r })))
  plan.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, avoid: ['milk'] })
})

describe('Recipe list', () => {
  it('lists recipes with times, rating and markers', async () => {
    render(<RecipesTab householdId="h1" />)
    const dal = await screen.findByRole('button', { name: /Red lentil dal/ })
    expect(dal).toHaveTextContent('20 min hands-on · 1 h 30 total')
    expect(within(dal).getByLabelText('4 stars')).toBeInTheDocument()
    expect(within(dal).getByText('Example')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Rice pudding/ })).getByText('Side')).toBeInTheDocument()
    expect(api.loadRecipes).toHaveBeenCalledWith('h1')
  })

  it('searches by name, tag and ingredient', async () => {
    render(<RecipesTab householdId="h1" />)
    const search = await screen.findByLabelText('Search recipes')
    fireEvent.change(search, { target: { value: 'VEGETARIAN' } })
    expect(names()).toEqual(['Red lentil dal'])
    fireEvent.change(search, { target: { value: 'jasmine' } })
    expect(names()).toEqual(['Rice pudding'])
    fireEvent.change(search, { target: { value: 'pizza' } })
    expect(screen.getByText('No recipes match.')).toBeInTheDocument()
  })

  it('filters by course', async () => {
    render(<RecipesTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sides' }))
    expect(names()).toEqual(['Rice pudding'])
    fireEvent.click(screen.getByRole('button', { name: 'Mains' }))
    expect(names()).toEqual(['Red lentil dal'])
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(names()).toHaveLength(2)
  })

  it('says so when there are no recipes or they cannot load', async () => {
    api.loadRecipes.mockResolvedValueOnce([])
    const { unmount } = render(<RecipesTab householdId="h1" />)
    expect(await screen.findByRole('heading', { name: 'No recipes yet' })).toBeInTheDocument()
    unmount()
    api.loadRecipes.mockRejectedValueOnce({ message: 'offline' })
    render(<RecipesTab householdId="h1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load recipes: offline')
  })
})

describe('Recipe view', () => {
  const open = async () => {
    render(<RecipesTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Red lentil dal/ }))
    return screen.getByRole('dialog', { name: 'Red lentil dal' })
  }

  it('shows meta, provides, tags, ingredients and method with timers', async () => {
    const view = await open()
    expect(view).toHaveTextContent('Main · 20 min hands-on · 1 h 30 total')
    for (const t of ['protein', 'veg', 'vegetarian', 'Example recipe', 'From Grandma']) {
      expect(within(view).getByText(t)).toBeInTheDocument()
    }
    const ings = within(view).getByRole('region', { name: 'Ingredients' })
    expect(ings).toHaveTextContent('red lentil500 g')
    expect(ings).toHaveTextContent('onion diced1 each')
    expect(ings).toHaveTextContent('saltas needed')
    const method = within(view).getByRole('region', { name: 'Method' })
    expect(within(method).getAllByRole('listitem')[1]).toHaveTextContent('Simmer the lentils. 25 min timer')
  })

  it('warns about allergens the household avoids, and only those', async () => {
    const view = await open()
    expect(within(view).getByRole('note', { name: 'Allergens' })).toHaveTextContent('Contains milk (ghee)Swap it or check the label.')
    expect(plan.loadSettings).toHaveBeenCalledWith('h1')
  })

  it('shows no allergen warning when the household avoids none', async () => {
    plan.loadSettings.mockResolvedValue(DEFAULT_SETTINGS)
    const view = await open()
    expect(within(view).queryByRole('note', { name: 'Allergens' })).not.toBeInTheDocument()
  })

  it('does not repeat an ingredient named for its allergen', async () => {
    render(<RecipesTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Rice pudding/ }))
    const note = within(screen.getByRole('dialog', { name: 'Rice pudding' })).getByRole('note', { name: 'Allergens' })
    expect(note).toHaveTextContent(/^Contains milkSwap it or check the label\.$/)
  })

  it('scales ingredients with the servings stepper', async () => {
    const view = await open()
    const ings = within(view).getByRole('region', { name: 'Ingredients' })
    for (let i = 0; i < 4; i++) fireEvent.click(within(view).getByRole('button', { name: 'More servings' }))
    expect(ings).toHaveTextContent('8 serves')
    expect(ings).toHaveTextContent('red lentil1 kg')
    expect(ings).toHaveTextContent('2 each')
    for (let i = 0; i < 10; i++) fireEvent.click(within(view).getByRole('button', { name: 'Fewer servings' }))
    expect(ings).toHaveTextContent('1 serves')
    expect(ings).toHaveTextContent('red lentil125 g')
  })

  it('saves a rating, clears it on the same star, and saves notes', async () => {
    const view = await open()
    fireEvent.click(within(view).getByRole('button', { name: '2 stars' }))
    expect(api.updateRecipe).toHaveBeenLastCalledWith('dal', { rating: 2 })
    expect(await within(view).findByRole('button', { name: '2 stars', pressed: true })).toBeInTheDocument()
    fireEvent.click(within(view).getByRole('button', { name: '2 stars' }))
    expect(api.updateRecipe).toHaveBeenLastCalledWith('dal', { rating: null })

    const save = within(view).getByRole('button', { name: 'Save note' })
    expect(save).toBeDisabled()
    fireEvent.change(within(view).getByLabelText('Notes for next time'), { target: { value: 'More garlic' } })
    fireEvent.click(save)
    expect(api.updateRecipe).toHaveBeenLastCalledWith('dal', { notes: 'More garlic' })
    expect(await within(view).findByRole('status')).toHaveTextContent('Note saved.')
  })

  it('shows a save error', async () => {
    api.updateRecipe.mockRejectedValueOnce({ message: 'permission denied' })
    const view = await open()
    fireEvent.click(within(view).getByRole('button', { name: '5 stars' }))
    expect(await within(view).findByRole('alert')).toHaveTextContent('permission denied')
  })

  it('deletes only after the in-page confirmation', async () => {
    const view = await open()
    fireEvent.click(within(view).getByRole('button', { name: 'Delete recipe' }))
    fireEvent.click(within(view).getByRole('button', { name: 'Keep it' }))
    expect(api.deleteRecipe).not.toHaveBeenCalled()

    fireEvent.click(within(view).getByRole('button', { name: 'Delete recipe' }))
    expect(within(view).getByText('Delete Red lentil dal?')).toBeInTheDocument()
    fireEvent.click(within(view).getByRole('button', { name: 'Delete' }))
    expect(api.deleteRecipe).toHaveBeenCalledWith('dal')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(names()).toEqual(['Rice pudding'])
  })

  it('adds the recipe to a night of the shown week', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 28) })
    try {
      const view = await open()
      fireEvent.click(within(view).getByRole('button', { name: 'Add to a night' }))
      const sheet = screen.getByRole('dialog', { name: 'Add Red lentil dal to a night' })
      expect(sheet).toHaveTextContent('26 Oct to 1 NovThis week')
      expect(await within(sheet).findByText('Fish tacos')).toBeInTheDocument()
      expect(api.loadWeekMains).toHaveBeenCalledWith('h1', '2026-10-26')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Next week' }))
      expect(sheet).toHaveTextContent('2 Nov to 8 NovNext week')
      fireEvent.click(within(sheet).getByRole('button', { name: /Wed 4/ }))
      expect(api.addToNight).toHaveBeenCalledWith('h1', expect.objectContaining({ id: 'dal' }), '2026-11-02', 'wed')
      expect(await within(view).findByRole('status')).toHaveTextContent('Added to Wed 4.')
      expect(screen.queryByRole('dialog', { name: /to a night/ })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes back to the list', async () => {
    const view = await open()
    fireEvent.click(within(view).getByRole('button', { name: '‹ Back' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Ask Claude', () => {
  const asked = (open: { mock: { calls: unknown[][] } }) => new URL(String(open.mock.calls.at(-1)?.[0])).searchParams.get('q')

  it('asks about a recipe', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<RecipesTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Red lentil dal/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude about this recipe' }))
    expect(asked(open)).toBe(`About my What's for Dinner recipe "Red lentil dal" (id ${RECIPES[0].id}): `)
    open.mockRestore()
  })

  it('adds a recipe from the empty list', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    api.loadRecipes.mockResolvedValueOnce([])
    render(<RecipesTab householdId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a recipe with Claude' }))
    expect(asked(open)).toBe("Add this recipe to my What's for Dinner recipes:\n")
    open.mockRestore()
  })
})
