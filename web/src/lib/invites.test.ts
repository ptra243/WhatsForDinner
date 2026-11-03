import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingInvite, inviteFromUrl, inviteUrl, pendingInvite, shareInvite } from './invites'

vi.mock('./supabase', () => ({ supabase: {} }))

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('invite links', () => {
  it('puts the token in the app link and reads it back', () => {
    const url = inviteUrl('abc-_123', 'https://ptra243.github.io/WhatsForDinner/')
    expect(url).toBe('https://ptra243.github.io/WhatsForDinner/?invite=abc-_123')
    expect(inviteFromUrl(url)).toBe('abc-_123')
    expect(inviteFromUrl('https://ptra243.github.io/WhatsForDinner/#list')).toBeUndefined()
    expect(inviteFromUrl('https://ptra243.github.io/WhatsForDinner/?invite=')).toBeUndefined()
  })

  it('keeps the invite from the link until it is cleared, and takes it out of the address bar', () => {
    window.history.replaceState(null, '', '/?invite=tok#week')
    expect(pendingInvite()).toBe('tok')
    // The magic link may come back without it.
    window.history.replaceState(null, '', '/#week')
    expect(pendingInvite()).toBe('tok')
    window.history.replaceState(null, '', '/?invite=tok#week')
    clearPendingInvite()
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#week')
    expect(pendingInvite()).toBeUndefined()
  })
})

describe('shareInvite', () => {
  const url = 'https://example.test/?invite=tok'

  it('copies the link and opens the share sheet', async () => {
    const nav = { clipboard: { writeText: vi.fn(async () => {}) }, share: vi.fn(async () => {}) }
    expect(await shareInvite(url, nav as never)).toBe('shared')
    expect(nav.clipboard.writeText).toHaveBeenCalledWith(url)
    expect(nav.share).toHaveBeenCalledWith(expect.objectContaining({ url }))
  })

  it('says copied when there is no share sheet, or it was closed', async () => {
    const writeText = vi.fn(async () => {})
    expect(await shareInvite(url, { clipboard: { writeText } } as never)).toBe('copied')
    const closed = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError')
    })
    expect(await shareInvite(url, { clipboard: { writeText }, share: closed } as never)).toBe('copied')
  })

  it('says failed when neither copying nor sharing worked', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    expect(await shareInvite(url, { clipboard: { writeText } } as never)).toBe('failed')
  })
})
