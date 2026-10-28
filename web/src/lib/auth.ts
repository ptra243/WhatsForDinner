import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/** The signed-in session: undefined while loading, null when signed out. Persists across reloads. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
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
