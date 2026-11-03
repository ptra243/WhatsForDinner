import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canEdit,
  cleanSuggestion,
  deleteSuggestion,
  loadSuggestions,
  openOnes,
  shownSince,
  statusWord,
  updateSuggestion,
  type Suggestion,
} from './suggestions'

type Call = [string, ...unknown[]]

// A stand-in for supabase-js that records each query's builder calls; `respond` gives each result.
const db = vi.hoisted(() => {
  const state = {
    queries: [] as { table: string; calls: Call[] }[],
    respond: (() => ({ data: null, error: null })) as (calls: Call[]) => { data: unknown; error: unknown },
  }
  const from = (table: string) => {
    const q = { table, calls: [] as Call[] }
    state.queries.push(q)
    const builder: unknown = new Proxy(
      {},
      {
        get: (_, key: string) =>
          key === 'then'
            ? (ok: (v: unknown) => unknown) => Promise.resolve(state.respond(q.calls)).then(ok)
            : (...args: unknown[]) => {
                q.calls.push([key, ...args])
                return builder
              },
      },
    )
    return builder
  }
  return { state, client: { from } }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

beforeEach(() => {
  db.state.queries = []
  db.state.respond = () => ({ data: null, error: null })
})

const row = (id: string, status: string, created_at: string) => ({
  id,
  created_by: 'sam',
  name: id,
  description: '',
  status,
  reply: '',
  recipe_id: null,
  created_at,
})

const s = (over: Partial<Suggestion>): Suggestion => ({
  id: 's1',
  createdBy: 'me',
  name: 'Pho',
  description: '',
  status: 'open',
  reply: '',
  recipeId: null,
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
})

describe('loadSuggestions', () => {
  it('reads open ones and those handled in the last two weeks, open ones first', async () => {
    db.state.respond = () => ({
      data: [
        row('newest-added', 'added', '2026-11-03T00:00:00Z'),
        row('new-open', 'open', '2026-11-02T00:00:00Z'),
        row('declined', 'declined', '2026-10-30T00:00:00Z'),
        row('old-open', 'open', '2026-10-01T00:00:00Z'),
      ],
      error: null,
    })
    const list = await loadSuggestions('h1', new Date('2026-11-04T00:00:00Z'))
    expect(list.map((x) => x.id)).toEqual(['new-open', 'old-open', 'newest-added', 'declined'])
    const [q] = db.state.queries
    expect(q.table).toBe('suggestions')
    expect(q.calls).toContainEqual(['eq', 'household_id', 'h1'])
    expect(q.calls).toContainEqual(['or', 'status.eq.open,handled_at.gte.2026-10-21T00:00:00.000Z'])
  })

  it('throws the load error', async () => {
    db.state.respond = () => ({ data: null, error: { message: 'offline' } })
    await expect(loadSuggestions('h1')).rejects.toEqual({ message: 'offline' })
  })
})

describe('changing a suggestion', () => {
  it('edits only the name and description', async () => {
    db.state.respond = () => ({ data: [{ id: 's1' }], error: null })
    await updateSuggestion('s1', 'Beef pho', 'link')
    expect(db.state.queries[0].calls).toContainEqual(['update', { name: 'Beef pho', description: 'link' }])
  })

  it('says so when it was refined meanwhile (no row changed)', async () => {
    db.state.respond = () => ({ data: [], error: null })
    await expect(updateSuggestion('s1', 'Pho', '')).rejects.toThrow('already been refined')
    await expect(deleteSuggestion('s1')).rejects.toThrow('already been refined')
  })
})

describe('helpers', () => {
  it('shows handled ones for two weeks', () => {
    expect(shownSince(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11-01T12:00:00.000Z')
  })

  it('lets only the author edit, and only while open', () => {
    expect(canEdit(s({}), 'me')).toBe(true)
    expect(canEdit(s({}), 'sam')).toBe(false)
    expect(canEdit(s({ status: 'added' }), 'me')).toBe(false)
  })

  it('needs a name and trims both fields', () => {
    expect(cleanSuggestion('  Pho ', ' a link ')).toEqual({ name: 'Pho', description: 'a link' })
    expect(cleanSuggestion('  ', 'x')).toBeNull()
  })

  it('counts open ones and names the status', () => {
    expect(openOnes([s({}), s({ id: 's2', status: 'declined' })]).map((x) => x.id)).toEqual(['s1'])
    expect(statusWord('declined')).toBe('Declined')
  })
})
