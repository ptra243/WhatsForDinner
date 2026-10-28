// Public by design: Row Level Security protects the data (docs/architecture.md, Keys).
// Never put the service (secret) key or the database password here.
// For the local Supabase stack, set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
// web/.env.local (see web/.env.example); builds without them use the live project.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fckheksaemriadvrveoj.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Toh5VFX4bRTT3jhy2X605g_Umd_T7Nd'

/** Where a magic link returns to: the app's own URL (the Pages URL in production, the dev server locally). */
export const appUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).href
