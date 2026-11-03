// Helpers for scripts that work on the local Supabase stack (`npx supabase start --workdir ..`).
// They read the stack's own keys from `supabase status` and refuse anything that is not local,
// so the service key they use can never reach the live project.

/** The local stack's URLs and keys, as printed by `supabase status -o env`. */
export type LocalStack = { apiUrl: string; publishableKey: string; secretKey: string }

/** Throws unless url is on this machine (127.0.0.1 or localhost). */
export function assertLocal(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`Not a URL: ${url}`)
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run against ${url}: only the local stack (127.0.0.1 or localhost) is allowed.`)
  }
}

/** Reads `supabase status -o env` output (KEY="value" lines) and checks the API is local. */
export function parseStatus(output: string): LocalStack {
  const env: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
    if (m) env[m[1]] = m[2]
  }
  const apiUrl = env.API_URL
  const publishableKey = env.PUBLISHABLE_KEY || env.ANON_KEY
  const secretKey = env.SECRET_KEY || env.SERVICE_ROLE_KEY
  if (!apiUrl || !publishableKey || !secretKey) {
    throw new Error('`supabase status` printed no API URL and keys. Is the local stack running? (npx supabase start --workdir ..)')
  }
  assertLocal(apiUrl)
  return { apiUrl, publishableKey, secretKey }
}

/** Reads VITE_SUPABASE_URL from the text of web/.env.local, if it sets one. */
export function envLocalUrl(text: string): string | undefined {
  return text.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1].trim().replace(/^"(.*)"$/, '$1') || undefined
}
