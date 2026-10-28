import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearExamples, exportHousehold, parseEquipment, saveHouseholdSettings, toHouseholdSettings } from './household'

type Call = [string, ...unknown[]]

// A stand-in for supabase-js: every builder call is recorded, and awaiting the query asks
// `respond` for the result of that table and those calls.
const db = vi.hoisted(() => {
  const state = {
    queries: [] as { table: string; calls: Call[] }[],
    respond: (() => ({ data: null, error: null })) as (table: string, calls: Call[]) => { data: unknown; error: unknown },
  }
  const from = (table: string) => {
    const q = { table, calls: [] as Call[] }
    state.queries.push(q)
    const builder: unknown = new Proxy(
      {},
      {
        get: (_, key: string) =>
          key === 'then'
            ? (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(state.respond(table, q.calls)).then(ok, fail)
            : (...args: unknown[]) => {
                q.calls.push([key, ...args])
                return builder
              },
      },
    )
    return builder
  }
  return { state, client: { from: vi.fn(from) } }
})
vi.mock('./supabase', () => ({ supabase: db.client }))

beforeEach(() => {
  db.state.queries = []
  db.state.respond = () => ({ data: null, error: null })
})

describe('toHouseholdSettings', () => {
  it('fills in the defaults', () => {
    expect(toHouseholdSettings(null)).toEqual({
      notes: '',
      equipment: [],
      dinnerTime: '18:30',
      minutes: { mon: 45, tue: 45, wed: 45, thu: 45, fri: 45, sat: 120, sun: 120 },
      mealRule: 'veg+carb',
    })
  })

  it('keeps what is stored and drops what is malformed', () => {
    const s = toHouseholdSettings({ notes: 'mild', equipment: ['wok', 3], dinnerTime: '7pm', minutes: { fri: 20 }, mealRule: 'veg' })
    expect(s).toMatchObject({ notes: 'mild', equipment: ['wok'], dinnerTime: '18:30', mealRule: 'veg' })
    expect(s.minutes.fri).toBe(20)
  })
})

describe('parseEquipment', () => {
  it('splits on commas and drops blanks', () => {
    expect(parseEquipment(' pressure cooker,, slow cooker ,')).toEqual(['pressure cooker', 'slow cooker'])
    expect(parseEquipment('')).toEqual([])
  })
})

describe('saveHouseholdSettings', () => {
  it('keeps keys the sheet does not show', async () => {
    db.state.respond = (_, calls) =>
      calls[0][0] === 'select' ? { data: { settings: { notes: 'old', pantryNote: 'from Claude' } }, error: null } : { data: null, error: null }
    const settings = toHouseholdSettings({ notes: 'new' })
    await saveHouseholdSettings('h1', settings)
    const upsert = db.state.queries[1].calls.find((c) => c[0] === 'upsert')
    expect(upsert?.[1]).toEqual({ household_id: 'h1', settings: { pantryNote: 'from Claude', ...settings } })
  })

  it('throws what the database says', async () => {
    db.state.respond = (_, calls) => (calls[0][0] === 'upsert' ? { data: null, error: { message: 'denied' } } : { data: null, error: null })
    await expect(saveHouseholdSettings('h1', toHouseholdSettings({}))).rejects.toEqual({ message: 'denied' })
  })
})

describe('clearExamples', () => {
  it('deletes only the household’s example recipes', async () => {
    db.state.respond = () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    expect(await clearExamples('h1')).toBe(2)
    expect(db.state.queries[0].table).toBe('recipes')
    expect(db.state.queries[0].calls).toEqual([
      ['delete'],
      ['eq', 'household_id', 'h1'],
      ['eq', 'is_example', true],
      ['select', 'id'],
    ])
  })
})

describe('exportHousehold', () => {
  it('collects every table and pages past the row limit', async () => {
    db.state.respond = (table, calls) => {
      const range = calls.find((c) => c[0] === 'range') as [string, number, number] | undefined
      if (table === 'ingredients' && range) {
        const n = range[1] === 0 ? 1000 : 3
        return { data: Array.from({ length: n }, (_, i) => ({ slug: `i${range[1] + i}` })), error: null }
      }
      if (table === 'households') return { data: { id: 'h1', name: 'Home' }, error: null }
      return { data: [{ table }], error: null }
    }
    const out = await exportHousehold('h1')
    expect(out).toMatchObject({
      app: 'whats-for-dinner',
      format: 1,
      household: { id: 'h1', name: 'Home' },
      recipes: [{ table: 'recipes' }],
      meal_plan_dishes: [{ table: 'meal_plan_dishes' }],
      meal_plan_nights: [{ table: 'meal_plan_nights' }],
      list_marks: [{ table: 'list_marks' }],
      list_extras: [{ table: 'list_extras' }],
    })
    expect(out.ingredients).toHaveLength(1003)
    expect(db.state.queries.filter((q) => q.table === 'ingredients')).toHaveLength(2)
    for (const q of db.state.queries.filter((q) => q.table !== 'ingredients')) {
      const scoped = q.calls.some((c) => c[0] === 'eq' && (c[1] === 'household_id' || (q.table === 'households' && c[1] === 'id')))
      expect(scoped, q.table).toBe(true)
    }
  })

  it('throws when a table cannot be read', async () => {
    db.state.respond = (table) => (table === 'list_extras' ? { data: null, error: { message: 'denied' } } : { data: [], error: null })
    await expect(exportHousehold('h1')).rejects.toEqual({ message: 'denied' })
  })
})
