import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_MARK } from './list'
import { clearQueues, enqueue, flush, pending, withPending, type Change, type Queued } from './offlineQueue'
import type { ListData } from './shop'

vi.mock('./supabase', () => ({ supabase: {} }))

const W = '2026-10-26'
const milk = { id: 'x9', name: 'milk', qty: 2, unit: 'l', section: 'dairy and fridge' }
/** The changes without their place in the queue. */
const strip = (q: Queued[]): Change[] => q.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'n')) as Change)

const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })

beforeEach(() => localStorage.clear())
afterEach(() => setOnline(true))

describe('enqueue', () => {
  it('keeps changes in order, per household, in local storage', () => {
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true } })
    enqueue('h1', { kind: 'add', week: W, extra: milk })
    enqueue('h2', { kind: 'mark', week: W, key: 'salt|tsp', change: { haveIt: true } })
    expect(strip(pending('h1'))).toEqual([
      { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true } },
      { kind: 'add', week: W, extra: milk },
    ])
    expect(pending('h2')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('wfd.queue.h1')!)).toHaveLength(2)
  })

  it('collapses repeated changes to one item, keeping only the columns changed', () => {
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true, missing: false } })
    enqueue('h1', { kind: 'mark', week: W, key: 'lettuce|each', change: { ticked: true } })
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: false } })
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { boughtQty: 3 } })
    expect(strip(pending('h1'))).toEqual([
      { kind: 'mark', week: W, key: 'onion|each', change: { ticked: false, missing: false, boughtQty: 3 } },
      { kind: 'mark', week: W, key: 'lettuce|each', change: { ticked: true } },
    ])
  })

  it('keeps one item’s changes apart in different weeks', () => {
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true } })
    enqueue('h1', { kind: 'mark', week: '2026-11-02', key: 'onion|each', change: { ticked: true } })
    expect(pending('h1')).toHaveLength(2)
  })

  it('cancels an unsent extra, and its marks, when it is removed', () => {
    enqueue('h1', { kind: 'add', week: W, extra: milk })
    enqueue('h1', { kind: 'mark', week: W, key: 'extra:x9', change: { ticked: true } })
    enqueue('h1', { kind: 'remove', week: W, id: 'x9' })
    expect(pending('h1')).toEqual([])
  })

  it('queues removing an extra that is already saved', () => {
    enqueue('h1', { kind: 'mark', week: W, key: 'extra:x1', change: { ticked: true } })
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    expect(strip(pending('h1'))).toEqual([{ kind: 'remove', week: W, id: 'x1' }])
  })

  it('forgets every household’s queue on sign-out', () => {
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    enqueue('h2', { kind: 'remove', week: W, id: 'x2' })
    localStorage.setItem('wfd.hideTicked', '1')
    clearQueues()
    expect(pending('h1')).toEqual([])
    expect(pending('h2')).toEqual([])
    expect(localStorage.getItem('wfd.hideTicked')).toBe('1')
  })
})

describe('flush', () => {
  it('sends oldest first and empties the queue', async () => {
    const sent: Change[] = []
    enqueue('h1', { kind: 'add', week: W, extra: milk })
    enqueue('h1', { kind: 'mark', week: W, key: 'extra:x9', change: { ticked: true } })
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    await flush('h1', async (_h, c) => void sent.push(c))
    expect(sent.map((c) => c.kind)).toEqual(['add', 'mark', 'remove'])
    expect(pending('h1')).toEqual([])
  })

  it('sends nothing with no signal', async () => {
    setOnline(false)
    const save = vi.fn(async () => {})
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    await flush('h1', save)
    expect(save).not.toHaveBeenCalled()
    expect(pending('h1')).toHaveLength(1)
  })

  it('stops and keeps the queue when there is no answer', async () => {
    const save = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    enqueue('h1', { kind: 'remove', week: W, id: 'x2' })
    await flush('h1', save)
    expect(save).toHaveBeenCalledTimes(1)
    expect(pending('h1')).toHaveLength(2)
  })

  it('drops a change the database refuses and carries on', async () => {
    const save = vi.fn().mockRejectedValueOnce({ code: '23514', message: 'check failed' }).mockResolvedValue(undefined)
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    enqueue('h1', { kind: 'remove', week: W, id: 'x2' })
    await flush('h1', save)
    expect(save).toHaveBeenCalledTimes(2)
    expect(pending('h1')).toEqual([])
  })

  it('sends a change made while another is being sent, without merging into the one in flight', async () => {
    let release = () => {}
    const sent: Change[] = []
    const save = vi.fn(async (_h: string, c: Change) => {
      sent.push(c)
      if (sent.length === 1) await new Promise<void>((r) => (release = r))
    })
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true } })
    const run = flush('h1', save)
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: false } })
    expect(flush('h1', save)).toBe(run)
    release()
    await run
    expect(sent).toMatchObject([{ change: { ticked: true } }, { change: { ticked: false } }])
    expect(pending('h1')).toEqual([])
  })
})

describe('withPending', () => {
  const data = (): ListData => ({ dishes: [], sections: {}, extras: [{ ...milk, id: 'x1' }], marks: { 'onion|each': { ...NO_MARK, haveIt: true } } })

  it('lays the week’s waiting changes over what was loaded', () => {
    enqueue('h1', { kind: 'mark', week: W, key: 'onion|each', change: { ticked: true } })
    enqueue('h1', { kind: 'add', week: W, extra: milk })
    enqueue('h1', { kind: 'remove', week: W, id: 'x1' })
    enqueue('h1', { kind: 'mark', week: '2026-11-02', key: 'salt|tsp', change: { ticked: true } })
    const out = withPending(data(), pending('h1'), W)
    expect(out.marks).toEqual({ 'onion|each': { ...NO_MARK, haveIt: true, ticked: true } })
    expect(out.extras).toEqual([milk])
  })

  it('does not add an extra twice once it is saved', () => {
    enqueue('h1', { kind: 'add', week: W, extra: { ...milk, id: 'x1' } })
    expect(withPending(data(), pending('h1'), W).extras).toHaveLength(1)
  })
})
