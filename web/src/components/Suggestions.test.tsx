import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanAskClaude } from '../lib/askAccess'
import type { Suggestion } from '../lib/suggestions'
import { Suggestions } from './Suggestions'

const api = vi.hoisted(() => ({
  list: [] as Suggestion[],
  reload: vi.fn(),
  addSuggestion: vi.fn(async () => {}),
  updateSuggestion: vi.fn(async () => {}),
  deleteSuggestion: vi.fn(async () => {}),
}))
vi.mock('../lib/suggestions', async (actual) => ({
  ...(await actual<typeof import('../lib/suggestions')>()),
  addSuggestion: api.addSuggestion,
  updateSuggestion: api.updateSuggestion,
  deleteSuggestion: api.deleteSuggestion,
  useSuggestions: () => ({ suggestions: api.list, error: undefined, reload: api.reload }),
}))
vi.mock('../lib/votes', async (actual) => ({
  ...(await actual<typeof import('../lib/votes')>()),
  useCurrentUser: () => 'me',
  useMemberNames: () => new Map([['sam', 'Sam']]),
}))
const claude = vi.hoisted(() => ({ askClaude: vi.fn<(prompt: string) => Promise<'opened'>>(async () => 'opened') }))
vi.mock('../lib/claude', async (actual) => ({ ...(await actual<typeof import('../lib/claude')>()), ...claude }))

const suggestion = (s: Partial<Suggestion> & Pick<Suggestion, 'id' | 'name'>): Suggestion => ({
  createdBy: 'me',
  description: '',
  status: 'open',
  reply: '',
  recipeId: null,
  createdAt: '2026-11-01T00:00:00Z',
  ...s,
})

const LIST = [
  suggestion({ id: 's1', name: 'Pho', description: 'https://example.test/pho' }),
  suggestion({ id: 's2', name: 'Laksa', createdBy: 'sam' }),
  suggestion({ id: 's3', name: 'Tripe', createdBy: 'sam', status: 'declined', reply: 'Nobody else eats tripe' }),
]

const show = (owner: boolean) =>
  render(
    <CanAskClaude.Provider value={owner}>
      <Suggestions householdId="h1" onOpenRecipe={() => {}} />
    </CanAskClaude.Provider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  api.list = LIST.map((s) => ({ ...s }))
})

describe('Suggest a dinner', () => {
  it('suggests a dish by name, with an optional description', async () => {
    api.list = []
    show(false)
    expect(screen.queryByRole('button', { name: /Suggestions/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a dinner' }))
    const sheet = screen.getByRole('dialog', { name: 'Suggest a dinner' })
    expect(within(sheet).getByRole('button', { name: 'Suggest it' })).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Dish'), { target: { value: '  Beef pho ' } })
    fireEvent.change(within(sheet).getByLabelText('Description (optional)'), { target: { value: 'https://example.test/pho' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Suggest it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.addSuggestion).toHaveBeenCalledWith('h1', 'Beef pho', 'https://example.test/pho')
    expect(api.reload).toHaveBeenCalled()
  })

  it('keeps the sheet up with the reason when saving fails', async () => {
    api.addSuggestion.mockRejectedValueOnce({ message: 'offline' })
    show(false)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a dinner' }))
    fireEvent.change(screen.getByLabelText('Dish'), { target: { value: 'Ramen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: offline')
  })
})

describe('The list', () => {
  it('shows who suggested each, its status and Claude’s reply', () => {
    show(false)
    fireEvent.click(screen.getByRole('button', { name: 'Suggestions (3)' }))
    const items = within(screen.getByRole('dialog', { name: 'Suggestions' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('PhoOpen')
    expect(items[0]).toHaveTextContent('Suggested by you')
    expect(within(items[0]).getByRole('link', { name: 'https://example.test/pho' })).toHaveAttribute('href', 'https://example.test/pho')
    expect(items[1]).toHaveTextContent('Suggested by Sam')
    expect(items[2]).toHaveTextContent('Declined')
    expect(items[2]).toHaveTextContent('Claude: Nobody else eats tripe')
  })

  it('lets the author edit or delete only their own open suggestion', async () => {
    show(false)
    fireEvent.click(screen.getByRole('button', { name: 'Suggestions (3)' }))
    const items = within(screen.getByRole('dialog', { name: 'Suggestions' })).getAllByRole('listitem')
    expect(within(items[1]).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(items[2]).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    fireEvent.click(within(items[0]).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('dialog', { name: 'Edit suggestion' })
    expect(within(form).getByLabelText('Dish')).toHaveValue('Pho')
    fireEvent.change(within(form).getByLabelText('Dish'), { target: { value: 'Chicken pho' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateSuggestion).toHaveBeenCalledWith('s1', 'Chicken pho', 'https://example.test/pho'))

    fireEvent.click(within(items[0]).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteSuggestion).toHaveBeenCalledWith('s1'))
  })
})

describe('Refining with Claude', () => {
  it('shows the owner how many are left, Refine this on each open one and Refine all', async () => {
    show(true)
    fireEvent.click(screen.getByRole('button', { name: '2 to refine' }))
    const sheet = screen.getByRole('dialog', { name: 'Suggestions' })
    const items = within(sheet).getAllByRole('listitem')
    expect(within(items[2]).queryByRole('button', { name: 'Refine this' })).not.toBeInTheDocument()
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Refine this' }))
    await waitFor(() =>
      expect(claude.askClaude).toHaveBeenCalledWith(
        `Refine this What's for Dinner suggestion into a recipe: "Pho" (https://example.test/pho) (suggestion id s1).`,
      ),
    )
    fireEvent.click(within(sheet).getByRole('button', { name: 'Refine all with Claude (2 open)' }))
    await waitFor(() => expect(claude.askClaude).toHaveBeenCalledWith("Refine all open What's for Dinner suggestions into recipes."))
  })

  it('shows members no refine buttons or badge', () => {
    show(false)
    expect(screen.queryByText(/to refine/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suggestions (3)' }))
    expect(screen.queryByRole('button', { name: /Refine/ })).not.toBeInTheDocument()
  })
})
