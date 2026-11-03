import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recipe } from '../lib/recipes'
import { RecipeForm } from './RecipeForm'

const api = vi.hoisted(() => ({
  loadIngredients: vi.fn(async () => [
    { name: 'onion', section: 'fruit and veg', allergens: [] },
    { name: 'red lentil', section: 'pantry', allergens: [] },
  ]),
  loadRecipeNames: vi.fn(async () => [
    { id: 'dal', name: 'Red lentil dal' },
    { id: 'soup', name: 'Pea soup' },
  ]),
  saveRecipe: vi.fn(async () => 'new-id'),
  loadRecipe: vi.fn(),
}))
vi.mock('../lib/recipes', async (actual) => ({ ...(await actual<typeof import('../lib/recipes')>()), ...api }))

const dal: Recipe = {
  id: 'dal',
  name: 'Red lentil dal',
  course: 'main',
  serves: 4,
  activeMins: 20,
  totalMins: 50,
  provides: ['protein'],
  spice: null,
  tags: [],
  source: '',
  rating: null,
  notes: '',
  isExample: true,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [
    { id: 'i1', name: 'red lentil', qty: 300, unit: 'g', note: '' },
    { id: 'i2', name: 'onion', qty: 1, unit: 'each', note: 'diced' },
  ],
  steps: [{ id: 's1', text: 'Simmer.', timerMins: 25 }],
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  api.loadRecipe.mockImplementation(async (id: string) => ({ ...dal, id, isExample: false }))
})

describe('RecipeForm', () => {
  it('adds a recipe with a new ingredient once its section is picked', async () => {
    const onSaved = vi.fn()
    render(<RecipeForm householdId="h1" onSaved={onSaved} onClose={() => {}} />)
    await waitFor(() => expect(api.loadIngredients).toHaveBeenCalled())

    type('Name', 'Leek gratin')
    type('Hands-on min', '15')
    type('Total min', '45')
    fireEvent.click(screen.getByRole('button', { name: 'veg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spice 1' }))
    type('Ingredient 1 name', 'Leek')
    type('Ingredient 1 amount', '2')
    fireEvent.change(screen.getByLabelText('Ingredient 1 unit'), { target: { value: 'each' } })
    type('Step 1', 'Bake.')
    type('Step 1 timer minutes', '30')

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    expect(await screen.findByText('New ingredient: pick its section.')).toBeInTheDocument()
    expect(api.saveRecipe).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Ingredient 1 section'), { target: { value: 'fruit and veg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id' })))
    expect(api.saveRecipe).toHaveBeenCalledWith('h1', {
      name: 'Leek gratin',
      course: 'main',
      serves: 4,
      active_mins: 15,
      total_mins: 45,
      provides: ['veg'],
      spice: 1,
      tags: [],
      source: '',
      notes: '',
      ingredients: [{ name: 'leek', qty: 2, unit: 'each', note: '', section: 'fruit and veg', allergens: [] }],
      steps: [{ text: 'Bake.', timer_mins: 30 }],
    })
  })

  it('shows problems next to their fields', async () => {
    render(<RecipeForm householdId="h1" onSaved={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(api.loadRecipeNames).toHaveBeenCalled())
    type('Name', 'pea soup')
    type('Hands-on min', '40')
    type('Total min', '30')
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect(await screen.findByText('There is already a recipe with this name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('There is already a recipe with this name.')
    expect(screen.getByLabelText('Total min')).toHaveAccessibleDescription('Total can’t be less than hands-on.')
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the marked fields first.')
    expect(api.saveRecipe).not.toHaveBeenCalled()
  })

  it('edits a recipe keeping row ids, reordering and removing rows', async () => {
    const onSaved = vi.fn()
    render(<RecipeForm householdId="h1" recipe={dal} onSaved={onSaved} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save recipe' })).toBeEnabled())
    expect(screen.getByRole('dialog', { name: 'Edit Red lentil dal' })).toBeInTheDocument()
    expect(screen.getByText(/Saving makes it your own/)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Red lentil dal')

    fireEvent.click(screen.getByRole('button', { name: 'Move ingredient 2 up' }))
    expect(screen.getByLabelText('Ingredient 1 name')).toHaveValue('onion')
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    type('Step 2', 'Serve with rice.')
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove ingredient 2' }))
    type('Name', 'Weeknight dal')

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.saveRecipe).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        id: 'dal',
        name: 'Weeknight dal',
        ingredients: [{ id: 'i2', name: 'onion', qty: 1, unit: 'each', note: 'diced' }],
        steps: [
          { text: 'Serve with rice.', timer_mins: null },
          { id: 's1', text: 'Simmer.', timer_mins: 25 },
        ],
      }),
    )
    expect(api.loadRecipe).toHaveBeenCalledWith('new-id')
  })

  it('offers only the fixed units and asks a new ingredient for its allergens', async () => {
    render(<RecipeForm householdId="h1" onSaved={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(api.loadIngredients).toHaveBeenCalled())
    const units = within(screen.getByLabelText('Ingredient 1 unit')).getAllByRole('option')
    expect(units.map((o) => o.textContent)).toEqual(['g', 'kg', 'ml', 'l', 'each', 'tsp', 'tbsp', 'bunch', 'tin'])

    type('Ingredient 1 name', 'onion')
    expect(screen.queryByLabelText('Ingredient 1 section')).not.toBeInTheDocument()
    type('Ingredient 1 name', 'egg noodle')
    const allergens = screen.getByRole('group', { name: 'Ingredient 1 allergens' })
    fireEvent.click(within(allergens).getByRole('button', { name: 'wheat' }))
    fireEvent.click(within(allergens).getByRole('button', { name: 'egg' }))
    expect(within(allergens).getByRole('button', { name: 'egg' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a refusal from the database next to its field, or above the buttons', async () => {
    render(<RecipeForm householdId="h1" recipe={dal} onSaved={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save recipe' })).toBeEnabled())
    api.saveRecipe.mockRejectedValueOnce({ message: 'A recipe called Red lentil dal already exists' })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    expect(await screen.findByText('A recipe called Red lentil dal already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')

    api.saveRecipe.mockRejectedValueOnce({ message: 'Failed to fetch' })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
  })
})
