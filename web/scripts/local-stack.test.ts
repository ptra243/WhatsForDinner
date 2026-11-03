import { describe, expect, it } from 'vitest'
import { assertLocal, envLocalUrl, parseStatus } from './local-stack.ts'

const status = (apiUrl: string) =>
  [`API_URL="${apiUrl}"`, 'PUBLISHABLE_KEY="sb_publishable_local"', 'SECRET_KEY="sb_secret_local"', 'DB_URL="postgresql://x"'].join('\n')

describe('assertLocal', () => {
  it('allows the local stack', () => {
    expect(() => assertLocal('http://127.0.0.1:54321')).not.toThrow()
    expect(() => assertLocal('http://localhost:5173/')).not.toThrow()
  })

  it('refuses the live project and anything else not on this machine', () => {
    expect(() => assertLocal('https://fckheksaemriadvrveoj.supabase.co')).toThrow(/Refusing/)
    expect(() => assertLocal('http://127.0.0.1.example.com:54321')).toThrow(/Refusing/)
    expect(() => assertLocal('http://localhost.evil.test')).toThrow(/Refusing/)
    expect(() => assertLocal('http://192.168.1.10:54321')).toThrow(/Refusing/)
    expect(() => assertLocal('not a url')).toThrow(/Not a URL/)
  })
})

describe('parseStatus', () => {
  it('reads the local API URL and keys', () => {
    expect(parseStatus(status('http://127.0.0.1:54321'))).toEqual({
      apiUrl: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_local',
      secretKey: 'sb_secret_local',
    })
  })

  it('refuses a status that points at a non-local URL', () => {
    expect(() => parseStatus(status('https://fckheksaemriadvrveoj.supabase.co'))).toThrow(/Refusing/)
  })

  it('says the stack is not running when there are no keys', () => {
    expect(() => parseStatus('')).toThrow(/not running|running/)
  })
})

describe('envLocalUrl', () => {
  it('reads VITE_SUPABASE_URL, or nothing when unset', () => {
    expect(envLocalUrl('# note\nVITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=x\n')).toBe('http://127.0.0.1:54321')
    expect(envLocalUrl('VITE_SUPABASE_URL=\n')).toBeUndefined()
    expect(envLocalUrl('')).toBeUndefined()
  })
})
