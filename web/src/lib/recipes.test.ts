import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addToNight, type Recipe } from './recipes'

// A stand-in for meal_plan_dishes: one night's dishes, recording updates and inserts.
const db = vi.hoisted(() => {
  const state = {
    dishes: [] as { id: string; position: number; role: string }[],
    updates: [] as { id: string; patch: object }[],
    inserts: [] as object[],
  }
  const client = {
    from: () => ({
      select: () => ({ match: () => ({ order: async () => ({ data: state.dishes, error: null }) }) }),
      update: (patch: object) => ({
        eq: async (_col: string, id: string) => {
          state.updates.push({ id, patch })
          return { error: null }
        },
      }),
      insert: async (row: object) => {
        state.inserts.push(row)
        return { error: null }
      },
    }),
  }
  return { state, client }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

const recipe = (course: 'main' | 'side') => ({ id: 'r1', course, serves: 3 }) as Recipe
const night = { household_id: 'h1', week_start: '2026-11-02', day: 'wed' }

beforeEach(() => {
  db.state.dishes = []
  db.state.updates = []
  db.state.inserts = []
})

describe('addToNight', () => {
  it('plans a recipe on an empty night at its serves', async () => {
    await addToNight('h1', recipe('main'), '2026-11-02', 'wed')
    expect(db.state.inserts).toEqual([{ ...night, position: 0, recipe_id: 'r1', role: 'main', servings: 3 }])
  })

  it('puts a main first and makes the other dishes sides', async () => {
    db.state.dishes = [
      { id: 'a', position: 0, role: 'main' },
      { id: 'b', position: 1, role: 'side' },
    ]
    await addToNight('h1', recipe('main'), '2026-11-02', 'wed')
    expect(db.state.updates).toEqual([
      { id: 'a', patch: { position: 1, role: 'side' } },
      { id: 'b', patch: { position: 2, role: 'side' } },
    ])
    expect(db.state.inserts).toEqual([expect.objectContaining({ position: 0, role: 'main' })])
  })

  it('puts a side last and leaves the others alone', async () => {
    db.state.dishes = [
      { id: 'a', position: 0, role: 'main' },
      { id: 'b', position: 3, role: 'side' },
    ]
    await addToNight('h1', recipe('side'), '2026-11-02', 'wed')
    expect(db.state.updates).toEqual([])
    expect(db.state.inserts).toEqual([expect.objectContaining({ position: 4, role: 'side' })])
  })

  it('gives the dish the id it is asked to', async () => {
    await addToNight('h1', recipe('side'), '2026-11-02', 'wed', 2, 'd1')
    expect(db.state.inserts).toEqual([{ ...night, id: 'd1', position: 0, recipe_id: 'r1', role: 'side', servings: 2 }])
  })
})
