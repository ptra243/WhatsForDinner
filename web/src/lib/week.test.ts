import { afterEach, describe, expect, it } from 'vitest'
import { addDays, dateOf, dayOf, nightsOf, rangeLabel, setWeekStartsOn, weekDays, weekStartOf } from './week'

describe('weeks', () => {
  it('starts on the Monday', () => {
    expect(weekStartOf(new Date(2026, 9, 28))).toBe('2026-10-26') // Wednesday
    expect(weekStartOf(new Date(2026, 10, 1))).toBe('2026-10-26') // Sunday
    expect(weekStartOf(new Date(2026, 10, 2))).toBe('2026-11-02') // Monday
  })

  it('names the weekday', () => {
    expect(dayOf(new Date(2026, 9, 28))).toBe('wed')
    expect(dayOf(new Date(2026, 10, 1))).toBe('sun')
    expect(dayOf(new Date(2026, 10, 2))).toBe('mon')
  })

  it('moves by days across months', () => {
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02')
    expect(dateOf('2026-10-26', 'sun')).toBe('2026-11-01')
    expect(rangeLabel('2026-10-26')).toBe('26 Oct to 1 Nov')
  })
})

describe('weeks from another day', () => {
  afterEach(() => setWeekStartsOn('mon'))

  it('starts on the given day', () => {
    expect(weekStartOf(new Date(2026, 10, 5), 'sat')).toBe('2026-10-31') // Thursday 5 Nov
    expect(weekStartOf(new Date(2026, 9, 31), 'sat')).toBe('2026-10-31') // Saturday
    expect(weekStartOf(new Date(2026, 10, 6), 'sat')).toBe('2026-10-31') // Friday
    expect(weekStartOf(new Date(2026, 10, 7), 'sat')).toBe('2026-11-07')
    expect(weekStartOf(new Date(2026, 10, 2), 'sun')).toBe('2026-11-01')
  })

  it("defaults to the household's day once set", () => {
    setWeekStartsOn('sat')
    expect(weekStartOf(new Date(2026, 10, 5))).toBe('2026-10-31')
    expect(weekDays()).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])
  })

  it("orders a week's nights from its first day and dates them", () => {
    expect(nightsOf('2026-10-31')).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])
    expect(nightsOf('2026-11-02')[0]).toBe('mon')
    expect(dateOf('2026-10-31', 'sat')).toBe('2026-10-31')
    expect(dateOf('2026-10-31', 'wed')).toBe('2026-11-04')
    expect(dateOf('2026-10-31', 'fri')).toBe('2026-11-06')
    expect(rangeLabel('2026-10-31')).toBe('31 Oct to 6 Nov')
  })
})
