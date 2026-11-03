// Household members and invites (#16): the invite link, joining, leaving and removing.
// Joining and removing go through database functions that check the caller (docs/data-model.md).
import { appUrl } from '../config'
import { supabase } from './supabase'

const PARAM = 'invite'
/** Where the invite waits while the magic link is sent and opened, in case the link drops it. */
const PENDING_KEY = 'wfd-invite'

/** The link that joins the household: `…/WhatsForDinner/?invite=<token>`. */
export const inviteUrl = (token: string, base = appUrl()) => {
  const url = new URL(base)
  url.searchParams.set(PARAM, token)
  return url.href
}

/** The invite token in a link, if it has one. */
export const inviteFromUrl = (href: string) => new URL(href).searchParams.get(PARAM)?.trim() || undefined

/**
 * The invite this device is joining with: the one in the address bar (kept, so it survives the
 * magic link's round trip) or one kept earlier.
 */
export function pendingInvite(): string | undefined {
  const fromUrl = inviteFromUrl(window.location.href)
  try {
    if (fromUrl) localStorage.setItem(PENDING_KEY, fromUrl)
    return fromUrl ?? localStorage.getItem(PENDING_KEY) ?? undefined
  } catch {
    return fromUrl
  }
}

/** Forgets the invite and takes it out of the address bar. */
export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage blocked: nothing was kept.
  }
  const url = new URL(window.location.href)
  if (url.searchParams.has(PARAM)) {
    url.searchParams.delete(PARAM)
    window.history.replaceState(null, '', url.href)
  }
}

export type InviteStatus = 'open' | 'used' | 'cancelled' | 'expired' | 'unknown'

/** The household an invite is for and whether it can still be used. Works signed out. */
export async function inviteInfo(token: string): Promise<{ householdName?: string; status: InviteStatus }> {
  const { data, error } = await supabase.rpc('invite_info', { token })
  if (error) throw error
  const row = data[0]
  return row ? { householdName: row.household_name, status: row.status as InviteStatus } : { status: 'unknown' }
}

/** What to tell someone whose invite cannot be used. */
export const INVITE_PROBLEM: Record<Exclude<InviteStatus, 'open'>, string> = {
  used: 'This invite link has already been used.',
  cancelled: 'This invite link was cancelled.',
  expired: 'This invite link has expired.',
  unknown: 'This invite link isn’t valid.',
}

/** Joins the invite's household as a member. Returns its id; throws with a plain message if refused. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { token })
  if (error) throw error
  return data
}

/** Makes a single-use invite for the household (owner only) and returns its link. */
export async function createInvite(householdId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', { hid: householdId })
  if (error) throw error
  return inviteUrl(data)
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_invite', { invite_id: inviteId })
  if (error) throw error
}

export type OpenInvite = { id: string; expiresAt: string }

/** Invites that can still be used. Only the owner can see any. */
export async function loadOpenInvites(householdId: string): Promise<OpenInvite[]> {
  const { data, error } = await supabase
    .from('household_invites')
    .select('id, expires_at')
    .eq('household_id', householdId)
    .is('used_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at')
  if (error) throw error
  return data.map((i) => ({ id: i.id, expiresAt: i.expires_at }))
}

export type Member = { userId: string; email: string; role: 'owner' | 'member' }

/** The household's members, owner first. */
export async function loadMembers(householdId: string): Promise<Member[]> {
  const { data, error } = await supabase.rpc('household_member_list', { hid: householdId })
  if (error) throw error
  return data.map((m) => ({ userId: m.user_id, email: m.email, role: m.role === 'owner' ? 'owner' : 'member' }))
}

/** Removes a member (owner), or the caller themself (leaving). */
export async function removeMember(householdId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { hid: householdId, member_id: userId })
  if (error) throw error
}

type ShareNavigator = Pick<Navigator, 'clipboard'> & { share?: Navigator['share'] }

/**
 * Copies the invite link, then opens the share sheet where there is one. Returns 'shared'
 * when the share sheet sent it, 'copied' when only the copy worked (no share sheet, or it was
 * closed), 'failed' when neither did.
 */
export async function shareInvite(url: string, nav: ShareNavigator = navigator): Promise<'shared' | 'copied' | 'failed'> {
  let copied = false
  try {
    await nav.clipboard.writeText(url)
    copied = true
  } catch {
    // No clipboard access; the share sheet or the shown link is the fallback.
  }
  if (nav.share) {
    try {
      await nav.share({ title: 'What’s for Dinner', text: 'Join our household on What’s for Dinner', url })
      return 'shared'
    } catch {
      // Closed, or not allowed after the wait for the link.
    }
  }
  return copied ? 'copied' : 'failed'
}
