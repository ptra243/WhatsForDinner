// The cook mode session kept on this device, so a tab the phone threw away comes back to the
// same dish, step and timers. One localStorage entry per household, week, night and recipe.
import { doneTimer, type Timer } from './cook'
import { isDay, type Day } from './week'

const PREFIX = 'wfd.cook.'

/** A session older than this is ignored: that dinner is over. */
export const COOK_SESSION_HOURS = 12

export type CookSession = {
  householdId: string
  /** The night being cooked: its week's first day (YYYY-MM-DD) and its day. */
  week: string
  day: Day
  recipeId: string
  /** The method cooked by; null for the recipe's own steps. */
  methodId: string | null
  /** The chosen optional steps, by id. */
  extras: string[]
  servings: number
  /** The step shown, from 0; -1 is the prep list. */
  step: number
  /** On the finish screen. */
  finished: boolean
  /** Timers by step. A running one holds the time it ends, a paused one the seconds left. */
  timers: Record<number, Timer>
  savedAt: number
}

type Night = Pick<CookSession, 'householdId' | 'week' | 'day' | 'recipeId'>

const keyOf = (n: Night) => `${PREFIX}${n.householdId}.${n.week}.${n.day}.${n.recipeId}`

const isTimer = (t: unknown): t is Timer => {
  const x = t as Timer | null
  return !!x && typeof x.left === 'number' && typeof x.done === 'boolean' && (x.endAt === null || typeof x.endAt === 'number')
}

/** The session stored under `key` when it is whole and fresh; a broken or old one is removed. */
function read(key: string, now: number): CookSession | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as CookSession | null
    const ok =
      !!s &&
      typeof s.householdId === 'string' &&
      typeof s.week === 'string' &&
      isDay(s.day) &&
      typeof s.recipeId === 'string' &&
      (s.methodId === null || typeof s.methodId === 'string') &&
      Array.isArray(s.extras) &&
      typeof s.servings === 'number' &&
      Number.isInteger(s.step) &&
      typeof s.finished === 'boolean' &&
      !!s.timers &&
      Object.values(s.timers).every(isTimer) &&
      typeof s.savedAt === 'number' &&
      now - s.savedAt < COOK_SESSION_HOURS * 3600_000
    if (ok) return s
    if (localStorage.getItem(key) != null) localStorage.removeItem(key)
  } catch {
    // No storage, or not a session: nothing to resume.
  }
  return undefined
}

export function saveCookSession(session: CookSession): void {
  try {
    localStorage.setItem(keyOf(session), JSON.stringify(session))
  } catch {
    // No storage (private mode, full): cook without resuming.
  }
}

/** The unfinished session for that dish on that night, if any. */
export const loadCookSession = (night: Night, now = Date.now()): CookSession | undefined => read(keyOf(night), now)

/** The household's most recently saved unfinished session: the one to reopen when the app loads. */
export function latestCookSession(householdId: string, now = Date.now()): CookSession | undefined {
  let keys: string[] = []
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIX}${householdId}.`))
  } catch {
    // No storage.
  }
  return keys
    .map((k) => read(k, now))
    .filter((s) => s !== undefined)
    .sort((a, b) => b.savedAt - a.savedAt)[0]
}

/** Forgets a session: the dish was marked cooked, or cook mode was closed on purpose. */
export function clearCookSession(night: Night): void {
  try {
    localStorage.removeItem(keyOf(night))
  } catch {
    // Nothing stored.
  }
}

/** Saved timers as they stand at `now`: one whose end time has passed is done. */
export function caughtUp(timers: Record<number, Timer>, now: number): Record<number, Timer> {
  return Object.fromEntries(Object.entries(timers).map(([ix, t]) => [ix, t.endAt != null && t.endAt <= now ? doneTimer : t]))
}
