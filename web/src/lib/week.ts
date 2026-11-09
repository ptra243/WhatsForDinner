// Weeks start on the household's day (settings `weekStartsOn`, Monday by default) and are
// stored as local dates, YYYY-MM-DD (docs/data-model.md). A week's nights run from that day.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]

export const DAY_NAMES: Record<Day, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

export const DAY_FULL: Record<Day, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const isDay = (v: unknown): v is Day => typeof v === 'string' && (DAYS as readonly string[]).includes(v)

let householdStart: Day = 'mon'

/**
 * Sets the day the signed-in household's weeks start on, the default for `weekStartOf` and
 * `weekDays`. The app sets it from the household settings before showing any week.
 */
export function setWeekStartsOn(day: Day): void {
  householdStart = day
}

type Loader = () => Promise<Day>
let loader: Loader | undefined

/** Registers how to load the household's start day again (the app shell does). Returns the unregister. */
export function setWeekStartLoader(load: Loader): () => void {
  loader = load
  return () => {
    if (loader === load) loader = undefined
  }
}

/**
 * Loads the household's start day again, for when a write was refused because its week no
 * longer starts on that day (another member changed it). Resolves to the day now in use.
 */
export const recheckWeekStart = (): Promise<Day> => (loader ? loader() : Promise.resolve(householdStart))

/**
 * The week a week-wide row (a list mark or extra, a vote) moves to when weeks start on `start`
 * instead: the one that overlaps it most, at most 3 days away, as the database moves them.
 */
export function movedWeek(week: string, start: Day): string {
  const shift = ((DAYS.indexOf(start) - DAYS.indexOf(dayOf(parseYmd(week))) + 10) % 7) - 3
  return addDays(week, shift)
}

/** The first day of the week holding `d`, for weeks starting on `start`. */
export function weekStartOf(d: Date, start: Day = householdStart): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6 - DAYS.indexOf(start) + 7) % 7))
  return ymd(x)
}

/** The weekday of `d`. */
export const dayOf = (d: Date): Day => DAYS[(d.getDay() + 6) % 7]

/** The seven days in order from `start`: from 'sat', Sat Sun Mon … Fri. */
export function weekDays(start: Day = householdStart): Day[] {
  const i = DAYS.indexOf(start)
  return [...DAYS.slice(i), ...DAYS.slice(0, i)]
}

/** The nights of the week starting `weekStart`, in order from its first day. */
export const nightsOf = (weekStart: string): Day[] => weekDays(dayOf(parseYmd(weekStart)))

export function addDays(s: string, n: number): string {
  const x = parseYmd(s)
  x.setDate(x.getDate() + n)
  return ymd(x)
}

/** The date of `day`'s night in the week starting `weekStart` (whatever day that is). */
export const dateOf = (weekStart: string, day: Day) => addDays(weekStart, nightsOf(weekStart).indexOf(day))

/** "3 Nov" */
export function dayLabel(s: string): string {
  const x = parseYmd(s)
  return `${x.getDate()} ${MONTHS[x.getMonth()]}`
}

/** "2 Nov to 8 Nov" */
export const rangeLabel = (weekStart: string) => `${dayLabel(weekStart)} to ${dayLabel(addDays(weekStart, 6))}`
