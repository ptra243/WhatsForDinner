import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { offlineStorage } from './supabase'

const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
const now = () => Math.floor(Date.now() / 1000)
const read = (key: string) => JSON.parse(offlineStorage.getItem(key) as string)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 12))
  localStorage.clear()
  localStorage.setItem('login', JSON.stringify({ access_token: 'a', expires_at: now() - 60 }))
})
afterEach(() => {
  setOnline(true)
  vi.useRealTimers()
})

describe('Login storage', () => {
  it('reads the real expiry online, so an expired login is refreshed', () => {
    expect(read('login').expires_at).toBe(now() - 60)
  })

  it('treats an expired login as current with no signal, without changing what is stored', () => {
    setOnline(false)
    expect(read('login')).toEqual({ access_token: 'a', expires_at: now() + 3600 })
    expect(JSON.parse(localStorage.getItem('login')!).expires_at).toBe(now() - 60)
  })

  it('passes anything else through', () => {
    setOnline(false)
    offlineStorage.setItem('verifier', 'abc')
    expect(offlineStorage.getItem('verifier')).toBe('abc')
    expect(offlineStorage.getItem('missing')).toBeNull()
    offlineStorage.removeItem('verifier')
    expect(localStorage.getItem('verifier')).toBeNull()
  })
})
