import { describe, expect, it } from 'vitest'
import { addDays, dateOf, rangeLabel, weekStartOf } from './week'

describe('weeks', () => {
  it('starts on the Monday', () => {
    expect(weekStartOf(new Date(2026, 9, 28))).toBe('2026-10-26') // Wednesday
    expect(weekStartOf(new Date(2026, 10, 1))).toBe('2026-10-26') // Sunday
    expect(weekStartOf(new Date(2026, 10, 2))).toBe('2026-11-02') // Monday
  })

  it('moves by days across months', () => {
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02')
    expect(dateOf('2026-10-26', 'sun')).toBe('2026-11-01')
    expect(rangeLabel('2026-10-26')).toBe('26 Oct to 1 Nov')
  })
})
