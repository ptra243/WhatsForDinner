import { createClient, type SupportedStorage } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config'
import type { Database } from './database.types'

/**
 * Where supabase-js keeps the login: localStorage, except that with no signal a stored login
 * reads as not yet expired. An expired token cannot be refreshed offline, and supabase-js
 * would retry for up to 30 seconds before every read, holding back the last-loaded data the
 * service worker has. Back online it reads the real expiry and refreshes as usual.
 */
export const offlineStorage: SupportedStorage = {
  getItem(key) {
    const value = localStorage.getItem(key)
    if (!value || navigator.onLine) return value
    try {
      const s = JSON.parse(value)
      if (typeof s?.expires_at === 'number') {
        return JSON.stringify({ ...s, expires_at: Math.max(s.expires_at, Math.floor(Date.now() / 1000) + 3600) })
      }
    } catch {
      // Not a login; returned as it is.
    }
    return value
  },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}

/** The app's one Supabase client, typed from the schema (`npm run gen:types`). */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { storage: offlineStorage } })
