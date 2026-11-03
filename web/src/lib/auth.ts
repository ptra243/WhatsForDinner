import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { SUPABASE_URL } from '../config'
import { acceptInvite, clearPendingInvite, pendingInvite } from './invites'
import { clearQueues } from './offlineQueue'
import { supabase } from './supabase'

/** Where supabase-js keeps the session (its default key for this project). */
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`

/**
 * The session supabase-js still holds in storage. With no signal an expired token cannot be
 * refreshed, so supabase-js reports no session but keeps it; a real sign-out removes it.
 */
export function storedSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return s?.access_token && s?.user ? (s as Session) : null
  } catch {
    return null
  }
}

/** Removes the last-loaded data the service worker keeps for offline use, and unsent list changes. */
const clearOfflineData = () => {
  if ('caches' in window) caches.delete('wfd-data').catch(() => {})
  clearQueues()
}

/**
 * The signed-in session: undefined while loading, null when signed out. Persists across reloads,
 * and stays signed in with no signal so the last-loaded data can show.
 */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? storedSession()))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') clearOfflineData()
      setSession(s ?? (event === 'SIGNED_OUT' ? null : storedSession()))
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}

export type Household = { id: string; role: 'owner' | 'member' }

/**
 * The signed-in user's household and their role in it. On first sign-in there is none, so
 * create_household makes one with the example recipes in it (and returns the existing one if a
 * racing call won).
 */
export async function ensureHousehold(userId: string): Promise<Household> {
  // Co-members' rows are readable too, so pick the user's own.
  const { data, error } = await supabase.from('household_members').select('household_id, role').eq('user_id', userId).limit(1)
  if (error) throw error
  if (data.length > 0) return { id: data[0].household_id, role: data[0].role === 'owner' ? 'owner' : 'member' }

  const { data: id, error: createError } = await supabase.rpc('create_household', { household_name: 'Home' })
  if (createError) throw createError
  return { id, role: 'owner' }
}

/**
 * Joins the household of the invite this device is holding, if any, then finds the user's
 * household. A refused invite is reported as `inviteError` and kept until `skipInvite` drops it.
 */
async function joinOrEnsureHousehold(userId: string): Promise<Household> {
  const token = pendingInvite()
  if (token) {
    try {
      await acceptInvite(token)
    } catch (e) {
      throw new InviteError((e as { message?: string }).message ?? String(e))
    }
    clearPendingInvite()
  }
  return ensureHousehold(userId)
}

class InviteError extends Error {}

type HouseholdState = { userId?: string; household?: Household; error?: string; inviteError?: string }

/**
 * Household for a signed-in user: undefined while loading; `error` if it could not be found or
 * made; `inviteError` if the invite they came with was refused. `skipInvite` forgets the invite
 * and carries on to their own household.
 */
export function useHousehold(userId: string | undefined) {
  const [state, setState] = useState<HouseholdState>({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!userId) return
    let live = true
    joinOrEnsureHousehold(userId).then(
      (household) => live && setState({ userId, household }),
      (e: { message?: string }) =>
        live && setState(e instanceof InviteError ? { userId, inviteError: e.message } : { userId, error: e.message ?? String(e) }),
    )
    return () => {
      live = false
    }
  }, [userId, attempt])

  const skipInvite = () => {
    clearPendingInvite()
    setState({})
    setAttempt((a) => a + 1)
  }

  return { ...(state.userId === userId ? state : {}), skipInvite }
}
