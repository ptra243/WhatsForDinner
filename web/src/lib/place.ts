import { useEffect, useState } from 'react'

// Where the user was (tab, week, open recipe, cook step, how far down each tab), kept in local
// storage so the app reopens there after the phone reloads it or it is opened again soon after.
// Signing out forgets it.

const KEY = 'wfd-place-1'
/** How long after the app was last in use it still reopens where it was. */
const KEEP_MS = 3 * 60 * 60 * 1000

type Stored = { at: number; v: Record<string, unknown> }

function read(): Record<string, unknown> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null
    if (s && typeof s.v === 'object' && s.v && Date.now() - s.at < KEEP_MS) return s.v
  } catch {
    // No storage, or not ours: start from nothing.
  }
  return {}
}

function write(v: Record<string, unknown>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v } satisfies Stored))
  } catch {
    // Storage full or blocked: the app works without it.
  }
}

/** What was kept under `key`, when it is recent enough. The caller checks its shape. */
export const getPlace = (key: string): unknown => read()[key]

/** Keeps `value` under `key`; undefined forgets it. */
export function setPlace(key: string, value: unknown): void {
  const v = read()
  if (value === undefined) delete v[key]
  else v[key] = value
  write(v)
}

export function clearPlace(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing kept.
  }
}

/** Counts the time from when the app was last on screen, not from the last change. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') write(read())
  })
}

/**
 * State that is kept under `key` and starts from what was kept. `valid` turns what was kept
 * into a value, or undefined when it no longer fits.
 */
export function usePlaceState<T>(key: string, initial: T | (() => T), valid: (kept: unknown) => T | undefined) {
  const [value, setValue] = useState<T>(() => {
    const kept = getPlace(key)
    const from = kept === undefined ? undefined : valid(kept)
    return from !== undefined ? from : typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => setPlace(key, value), [key, value])
  return [value, setValue] as const
}

/**
 * Scrolls the page to `y`. A tab's content loads after it shows, so this keeps trying as the
 * page grows, until it gets there, the user scrolls, or a few seconds pass. Returns the stop.
 */
export function scrollPageTo(y: number): () => void {
  window.scrollTo(0, y)
  if (y <= 0 || window.scrollY >= y - 1) return () => {}
  const events = ['touchstart', 'wheel', 'keydown'] as const
  let tries = 40
  const stop = () => {
    clearInterval(timer)
    events.forEach((e) => window.removeEventListener(e, stop))
  }
  // A timer, not a watch on the page's size: that only reports while the page is being drawn.
  const timer = setInterval(() => {
    window.scrollTo(0, y)
    if (window.scrollY >= y - 1 || --tries <= 0) stop()
  }, 100)
  events.forEach((e) => window.addEventListener(e, stop, { passive: true }))
  return stop
}
