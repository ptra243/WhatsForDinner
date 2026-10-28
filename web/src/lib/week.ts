// Weeks start on Monday and are stored as local dates, YYYY-MM-DD (docs/data-model.md).

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]

export const DAY_NAMES: Record<Day, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The Monday of the week holding `d`. */
export function weekStartOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return ymd(x)
}

/** The weekday of `d`. */
export const dayOf = (d: Date): Day => DAYS[(d.getDay() + 6) % 7]

export function addDays(s: string, n: number): string {
  const x = parseYmd(s)
  x.setDate(x.getDate() + n)
  return ymd(x)
}

export const dateOf = (weekStart: string, day: Day) => addDays(weekStart, DAYS.indexOf(day))

/** "3 Nov" */
export function dayLabel(s: string): string {
  const x = parseYmd(s)
  return `${x.getDate()} ${MONTHS[x.getMonth()]}`
}

/** "2 Nov to 8 Nov" */
export const rangeLabel = (weekStart: string) => `${dayLabel(weekStart)} to ${dayLabel(addDays(weekStart, 6))}`
