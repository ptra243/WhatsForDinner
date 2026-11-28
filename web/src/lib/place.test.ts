import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPlace, getPlace, setPlace } from './place'

afterEach(() => vi.useRealTimers())

describe('place', () => {
  it('keeps values and forgets one set to undefined', () => {
    setPlace('tab', 'list')
    setPlace('week.week', '2026-11-16')
    expect(getPlace('tab')).toBe('list')
    setPlace('tab', undefined)
    expect(getPlace('tab')).toBeUndefined()
    expect(getPlace('week.week')).toBe('2026-11-16')
  })

  it('forgets everything three hours after the app was last used', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 17, 18, 0) })
    setPlace('tab', 'list')
    vi.setSystemTime(new Date(2026, 10, 17, 20, 59))
    expect(getPlace('tab')).toBe('list')
    vi.setSystemTime(new Date(2026, 10, 17, 21, 1))
    expect(getPlace('tab')).toBeUndefined()
  })

  it('counts the time from when the app last went off screen', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 17, 18, 0) })
    setPlace('tab', 'list')
    vi.setSystemTime(new Date(2026, 10, 17, 20, 0))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    vi.setSystemTime(new Date(2026, 10, 17, 22, 0))
    expect(getPlace('tab')).toBe('list')
  })

  it('ignores storage that is not its own', () => {
    localStorage.setItem('wfd-place-1', 'not json')
    expect(getPlace('tab')).toBeUndefined()
    setPlace('tab', 'pantry')
    expect(getPlace('tab')).toBe('pantry')
  })

  it('forgets everything on clearPlace', () => {
    setPlace('tab', 'list')
    clearPlace()
    expect(getPlace('tab')).toBeUndefined()
  })
})
