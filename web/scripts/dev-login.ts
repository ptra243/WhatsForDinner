// npm run dev:login [-- --email someone@example.test] [-- --app http://localhost:5174/]
//
// Signs a test user in to the dev server on the local Supabase stack (issue #59): creates the
// user if needed, loads the examples if the database has none, makes sure the user has a
// household with them, and prints a magic link that opens the dev server signed in.
// It only ever talks to the local stack, with the keys `supabase status` prints for it.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { assertLocal, envLocalUrl, parseStatus } from './local-stack.ts'

process.on('uncaughtException', (e) => {
  console.error(`dev:login: ${e.message}`)
  process.exit(1)
})

const TEMPLATE_HOUSEHOLD = '00000000-0000-4000-8000-000000000001'

const { values: args } = parseArgs({
  options: {
    email: { type: 'string', default: 'dev@example.test' },
    app: { type: 'string', default: 'http://localhost:5173/' },
  },
})
assertLocal(args.app)

let status: string
try {
  status = execSync('npx supabase status --workdir .. -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch {
  throw new Error('The local stack is not running. Start it with `npx supabase start --workdir ..` (needs Docker).')
}
const stack = parseStatus(status)

// The dev server reads the URL and key from web/.env.local; point it at the local stack.
const envFile = '.env.local'
if (!existsSync(envFile)) {
  writeFileSync(envFile, `VITE_SUPABASE_URL=${stack.apiUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${stack.publishableKey}\n`)
  console.log(`Wrote ${envFile} for the local stack. Restart the dev server if it is running.`)
} else {
  const text = readFileSync(envFile, 'utf8')
  const url = envLocalUrl(text)
  if (!url) throw new Error(`${envFile} sets no VITE_SUPABASE_URL, so the dev server would use the live project. Set it to ${stack.apiUrl}.`)
  assertLocal(url)
  if (!text.includes(`VITE_SUPABASE_PUBLISHABLE_KEY=${stack.publishableKey}`)) {
    const key = `VITE_SUPABASE_PUBLISHABLE_KEY=${stack.publishableKey}`
    writeFileSync(envFile, /^VITE_SUPABASE_PUBLISHABLE_KEY=.*$/m.test(text) ? text.replace(/^VITE_SUPABASE_PUBLISHABLE_KEY=.*$/m, key) : `${text.trimEnd()}\n${key}\n`)
    console.log(`Set the local publishable key in ${envFile}. Restart the dev server if it is running.`)
  }
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(stack.apiUrl, stack.secretKey, noSession)

// New households copy the template household, so load the examples into it first.
const { count, error: countError } = await admin
  .from('recipes')
  .select('id', { count: 'exact', head: true })
  .eq('household_id', TEMPLATE_HOUSEHOLD)
if (countError) throw countError
if (!count) {
  const projectId = readFileSync('../supabase/config.toml', 'utf8').match(/^project_id = "(.*)"$/m)?.[1]
  execSync(`docker exec -i supabase_db_${projectId} psql -U postgres -v ON_ERROR_STOP=1 -q`, {
    input: readFileSync('../supabase/seed/seed.sql'),
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  console.log('Loaded the examples (supabase/seed/seed.sql).')
}

// The same user every run: find it, or create it with its email already confirmed.
const { data: users, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listError) throw listError
if (!users.users.some((u) => u.email === args.email)) {
  const { error } = await admin.auth.admin.createUser({ email: args.email, email_confirm: true })
  if (error) throw error
  console.log(`Created ${args.email}.`)
}

/** A one-time magic link for the user that returns to the dev server. */
async function magicLink() {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: args.email, options: { redirectTo: args.app } })
  if (error) throw error
  return data.properties
}

// Sign in as the user to make the household the way the app does on first sign-in;
// create_household returns the existing one when there is one.
const asUser = createClient(stack.apiUrl, stack.publishableKey, noSession)
const { error: verifyError } = await asUser.auth.verifyOtp({ type: 'magiclink', token_hash: (await magicLink()).hashed_token })
if (verifyError) throw verifyError
const { data: householdId, error: householdError } = await asUser.rpc('create_household', { household_name: 'Home' })
if (householdError) throw householdError
const { count: recipes } = await asUser.from('recipes').select('id', { count: 'exact', head: true }).eq('household_id', householdId)
console.log(`${args.email} is in household ${householdId} with ${recipes ?? 0} recipes.`)

console.log(`\nOpen this link to sign in to the dev server at ${args.app} (one use only; run again for another):\n`)
console.log((await magicLink()).action_link)
