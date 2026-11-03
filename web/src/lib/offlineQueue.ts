// Shopping-list changes waiting to be saved. Every tick, amount, couldn't-get, already-have and
// hand-added item goes through here, online or not: the change shows at once, is kept in local
// storage per household, and is sent oldest first whenever there is signal. Moving an item's
// section is not queued; it changes every list, so it needs signal.
import { useSyncExternalStore } from 'react'
import type { ListExtra, Mark } from './list'
import { addExtra, applyMark, removeExtra, setMark, type ListData } from './shop'
import { showToast } from './toast'

export type Change =
  /** Only the columns that changed, as `setMark` writes them. */
  | { kind: 'mark'; week: string; key: string; change: Partial<Mark> }
  /** The extra's id is made on the phone, so removing it before it is sent works. */
  | { kind: 'add'; week: string; extra: ListExtra }
  | { kind: 'remove'; week: string; id: string }

/** A queued change and its place in the queue. */
export type Queued = Change & { n: number }

const PREFIX = 'wfd.queue.'
const storageKey = (householdId: string) => PREFIX + householdId

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const dropListeners = new Set<() => void>()

/** The entry being sent for each household; never merged into, since it may already be saved. */
const sending = new Map<string, number>()
const flushing = new Map<string, Promise<void>>()

/**
 * Households whose last send got no answer. In a shop the phone often reports a connection
 * while nothing gets through, so no `online` event will come: retry on a timer, backing off.
 */
const stalled = new Set<string>()
const retries = new Map<string, { timer?: ReturnType<typeof setTimeout>; delay: number }>()
export const RETRY_FIRST = 15_000
const RETRY_MAX = 120_000

function retryLater(householdId: string, save: typeof send) {
  const last = retries.get(householdId)
  clearTimeout(last?.timer)
  const delay = last ? Math.min(last.delay * 2, RETRY_MAX) : RETRY_FIRST
  retries.set(householdId, { delay, timer: setTimeout(() => void flush(householdId, save), delay) })
  if (!stalled.has(householdId)) {
    stalled.add(householdId)
    notify()
  }
}

function caughtUp(householdId: string) {
  clearTimeout(retries.get(householdId)?.timer)
  retries.delete(householdId)
  if (stalled.delete(householdId)) notify()
}

/** The household's waiting changes, oldest first. */
export function pending(householdId: string): Queued[] {
  try {
    const q = JSON.parse(localStorage.getItem(storageKey(householdId)) ?? '[]')
    return Array.isArray(q) ? q : []
  } catch {
    return []
  }
}

function write(householdId: string, queue: Queued[]) {
  try {
    if (queue.length) localStorage.setItem(storageKey(householdId), JSON.stringify(queue))
    else localStorage.removeItem(storageKey(householdId))
  } catch {
    // Storage full or blocked: the change still shows, and is sent if there is signal now.
  }
  notify()
}

/**
 * Adds a change to the queue. Repeated changes to one item's mark collapse into one, keeping
 * only the columns changed. Removing an extra that was never sent cancels it and its marks.
 */
export function enqueue(householdId: string, change: Change) {
  const queue = pending(householdId)
  const busy = sending.get(householdId)
  const n = queue.reduce((max, q) => Math.max(max, q.n), 0) + 1
  if (change.kind === 'mark') {
    const same = queue.find((q) => q.kind === 'mark' && q.n !== busy && q.week === change.week && q.key === change.key)
    if (same?.kind === 'mark') same.change = { ...same.change, ...change.change }
    else queue.push({ ...change, n })
    return write(householdId, queue)
  }
  if (change.kind === 'remove') {
    const added = queue.find((q) => q.kind === 'add' && q.extra.id === change.id && q.n !== busy)
    const rest = queue.filter((q) => q.n === busy || !(q.kind === 'mark' && q.key === `extra:${change.id}`))
    if (added) return write(householdId, rest.filter((q) => q !== added))
    return write(householdId, [...rest, { ...change, n }])
  }
  write(householdId, [...queue, { ...change, n }])
}

/** Saves one change to the database. */
export function send(householdId: string, change: Change): Promise<void> {
  if (change.kind === 'mark') return setMark(householdId, change.week, change.key, change.change)
  if (change.kind === 'add') return addExtra(householdId, change.week, change.extra)
  return removeExtra(change.id)
}

/**
 * Whether the database answered and said no (a PostgREST error has a code). No signal, or no
 * answer at all, leaves the change queued for the next try.
 */
const refused = (e: unknown) => !!(e as { code?: string })?.code

const errorText = (e: unknown) => (e as { message?: string })?.message ?? String(e)

/**
 * Sends the queue oldest first while there is signal. A change the database refuses is dropped
 * with a toast so it does not hold up the rest; anything else stops and tries again later
 * (`retryLater`). Only one run per household at a time; changes queued meanwhile are sent in
 * the same run. Runs on app start, when the signal returns, when the app is shown again,
 * after each change, and on the retry timer.
 */
export function flush(householdId: string, save = send): Promise<void> {
  const running = flushing.get(householdId)
  if (running) return running
  const run = (async () => {
    for (;;) {
      // Offline, the `online` event starts the next run.
      if (!navigator.onLine) return
      const next = pending(householdId)[0]
      if (!next) return caughtUp(householdId)
      sending.set(householdId, next.n)
      try {
        await save(householdId, next)
        caughtUp(householdId)
      } catch (e) {
        if (!refused(e)) return retryLater(householdId, save)
        showToast(`A change could not be saved, so it was dropped: ${errorText(e)}`)
        dropListeners.forEach((l) => l())
      } finally {
        sending.delete(householdId)
      }
      write(
        householdId,
        pending(householdId).filter((q) => q.n !== next.n),
      )
    }
  })().finally(() => flushing.delete(householdId))
  flushing.set(householdId, run)
  return run
}

/** The list with the household's waiting changes for that week laid over it. */
export function withPending(data: ListData, queue: Queued[], week: string): ListData {
  let { marks, extras } = data
  for (const q of queue) {
    if (q.week !== week) continue
    if (q.kind === 'mark') marks = { ...marks, [q.key]: applyMark(marks[q.key], q.change) }
    else if (q.kind === 'add') extras = extras.some((x) => x.id === q.extra.id) ? extras : [...extras, q.extra]
    else extras = extras.filter((x) => x.id !== q.id)
  }
  return { ...data, marks, extras }
}

/** Forgets every household's waiting changes (on sign-out). */
export function clearQueues() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {
    // Nothing stored to forget.
  }
  for (const householdId of [...retries.keys()]) caughtUp(householdId)
  notify()
}

/** Sends the queue whenever the app is shown again. Returns the unsubscribe. */
export function flushWhenShown(householdId: string): () => void {
  const onShow = () => {
    if (document.visibilityState === 'visible') void flush(householdId)
  }
  document.addEventListener('visibilitychange', onShow)
  return () => document.removeEventListener('visibilitychange', onShow)
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Calls `onDrop` when a refused change is dropped, so the list can reload. Returns the unsubscribe. */
export function onDropped(onDrop: () => void): () => void {
  dropListeners.add(onDrop)
  return () => {
    dropListeners.delete(onDrop)
  }
}

/** How many changes are waiting to be saved. */
export const usePendingCount = (householdId: string) => useSyncExternalStore(subscribe, () => pending(householdId).length)

/** Whether the last send got no answer, so changes are waiting though the phone says it has signal. */
export const useStalled = (householdId: string) => useSyncExternalStore(subscribe, () => stalled.has(householdId))
