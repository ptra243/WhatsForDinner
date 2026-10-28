import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { SUPABASE_URL } from '../config'
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

/** Removes the last-loaded data the service worker keeps for offline use. */
const clearOfflineData = () => {
  if ('caches' in window) caches.delete('wfd-data').catch(() => {})
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

/**
 * The signed-in user's household id. On first sign-in there is none, so create_household
 * makes one with the example recipes in it (and returns the existing one if a racing call won).
 */
export async function ensureHousehold(): Promise<string> {
  const { data, error } = await supabase.from('household_members').select('household_id').limit(1)
  if (error) throw error
  if (data.length > 0) return data[0].household_id

  const { data: id, error: createError } = await supabase.rpc('create_household', { household_name: 'Home' })
  if (createError) throw createError
  return id
}

/** Household id for a signed-in user: undefined while loading; error if it could not be found or made. */
export function useHousehold(userId: string | undefined) {
  const [state, setState] = useState<{ userId?: string; id?: string; error?: string }>({})

  useEffect(() => {
    if (!userId) return
    let live = true
    ensureHousehold().then(
      (id) => live && setState({ userId, id }),
      (e: { message?: string }) => live && setState({ userId, error: e.message ?? String(e) }),
    )
    return () => {
      live = false
    }
  }, [userId])

  return state.userId === userId ? state : {}
}
