import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { comingWeek, memberName, nextVote, saveVote, tally, tallyText, useVotes, voteSummary, weekWords, type Vote } from './votes'

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
  const channel = () => ({ on: () => ({}), subscribe: () => ({}) })
  return { state, client: { from, channel, removeChannel: () => {} } }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

beforeEach(() => {
  db.state.queries = []
  db.state.respond = () => ({ data: null, error: null })
})

// Wednesday 4 Nov 2026: this week starts 2 Nov, next week 9 Nov.
const now = new Date(2026, 10, 4)
const votes: Vote[] = [
  { recipeId: 'curry', userId: 'sam', vote: -1 },
  { recipeId: 'curry', userId: 'me', vote: 1 },
  { recipeId: 'stew', userId: 'sam', vote: 1 },
  { recipeId: 'tacos', userId: 'me', vote: 1 },
]

describe('weeks', () => {
  it('votes for next Monday’s week unless switched', () => {
    expect(comingWeek(now)).toBe('2026-11-09')
    // On a Monday the coming week is still next Monday's.
    expect(comingWeek(new Date(2026, 10, 2))).toBe('2026-11-09')
  })

  it('names the week', () => {
    expect(weekWords('2026-11-02', now)).toBe('this week')
    expect(weekWords('2026-11-09', now)).toBe('next week')
    expect(weekWords('2026-11-16', now)).toBe('for 16 Nov')
  })
})

describe('nextVote', () => {
  it('sets, changes, and clears when the same vote is tapped again', () => {
    expect(nextVote(undefined, 1)).toBe(1)
    expect(nextVote(1, -1)).toBe(-1)
    expect(nextVote(-1, -1)).toBeNull()
  })
})

describe('who voted what', () => {
  it('puts the caller first, then other members by name', () => {
    const names = new Map([['sam', 'Sam']])
    expect(voteSummary(votes, 'curry', 'me', names)).toBe('👍 you · 👎 Sam')
    expect(voteSummary(votes, 'stew', 'me', names)).toBe('👍 Sam')
    expect(voteSummary(votes, 'rice', 'me', names)).toBe('')
    expect(voteSummary(votes, 'stew', 'me', new Map())).toBe('👍 someone')
  })

  it('makes a short name from an email', () => {
    expect(memberName('sam@example.com')).toBe('Sam')
    expect(memberName('jo.smith+food@example.com')).toBe('Jo')
  })
})

describe('tally', () => {
  it('counts recipes with a 👍 and with a 👎', () => {
    expect(tally(votes)).toEqual({ liked: 3, not: 1 })
    expect(tallyText(votes, '2026-11-09', now)).toBe('3 liked, 1 not next week')
    expect(tallyText(votes.slice(2), '2026-11-02', now)).toBe('2 liked this week')
    expect(tallyText([], '2026-11-02', now)).toBe('')
  })
})

describe('saveVote', () => {
  it('upserts the caller’s vote and deletes it when cleared', async () => {
    await saveVote('h1', '2026-11-09', 'curry', 'me', 1)
    await saveVote('h1', '2026-11-09', 'curry', 'me', null)
    const key = { household_id: 'h1', week_start: '2026-11-09', recipe_id: 'curry', user_id: 'me' }
    expect(db.state.queries.map((q) => [q.table, q.calls])).toEqual([
      ['recipe_votes', [['upsert', { ...key, vote: 1 }]]],
      ['recipe_votes', [['delete'], ['match', key]]],
    ])
  })
})

describe('useVotes', () => {
  it('puts the vote back and keeps the error up when the save is refused', async () => {
    db.state.respond = (calls) =>
      calls.some((c) => c[0] === 'upsert') ? { data: null, error: { message: 'refused' } } : { data: [], error: null }
    const { result } = renderHook(() => useVotes('h1', '2026-11-09'))
    await waitFor(() => expect(result.current.votes).toEqual([]))
    await act(() => result.current.vote('curry', 1))
    expect(result.current.saveError).toBe('refused')
    // The reload that puts the vote back succeeds, and the save error stays.
    await waitFor(() => expect(db.state.queries.filter((q) => q.calls[0]?.[0] === 'select')).toHaveLength(2))
    await waitFor(() => expect(result.current.votes).toEqual([]))
    expect(result.current.saveError).toBe('refused')
    expect(result.current.loadError).toBeUndefined()
  })
})
