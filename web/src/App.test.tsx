import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { SUPABASE_URL } from './config'
import { clearQueues, enqueue, pending } from './lib/offlineQueue'

// A stand-in for the Supabase client: a session (or none), the user's memberships and create_household.
const db = vi.hoisted(() => {
  const state = {
    session: null as null | { user: { id: string; email: string } },
    memberships: [] as { household_id: string; role: string }[],
    authListener: undefined as undefined | ((event: string, session: unknown) => void),
  }
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        state.authListener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      }),
      signInWithOtp: vi.fn<(args: unknown) => Promise<{ error: null | { message: string } }>>(async () => ({ error: null })),
      signOut: vi.fn(async () => {
        state.session = null
        state.authListener?.('SIGNED_OUT', null)
        return { error: null }
      }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: state.memberships, error: null }) }) }),
    })),
    rpc: vi.fn<(fn: string, args: unknown) => Promise<{ data: string | null; error: null | { message: string } }>>(
      async () => ({ data: 'new-household', error: null }),
    ),
    // The shell listens for settings changes (the day weeks start on).
    channel: vi.fn(() => {
      const channel = { on: () => channel, subscribe: () => channel }
      return channel
    }),
    removeChannel: vi.fn(async () => 'ok'),
  }
  return { state, client }
})
vi.mock('./lib/supabase', () => ({ supabase: db.client }))
// The Week tab has its own tests (components/WeekTab.test.tsx).
vi.mock('./components/WeekTab', () => ({ WeekTab: () => null }))
// So has the Shopping list tab (components/ListTab.test.tsx).
vi.mock('./components/ListTab', () => ({ ListTab: () => null }))
// And the suggestions on the Recipes tab (components/Suggestions.test.tsx).
vi.mock('./components/Suggestions', () => ({ Suggestions: () => null }))
vi.mock('./lib/votes', async (actual) => ({
  ...(await actual<typeof import('./lib/votes')>()),
  useVotes: () => ({ votes: [], loadError: undefined, saveError: undefined, vote: () => {} }),
}))
// The settings sheet's own fields are tested in components/SettingsSheet.test.tsx.
vi.mock('./lib/household', async (actual) => {
  const mod = await actual<typeof import('./lib/household')>()
  return { ...mod, loadHouseholdSettings: async () => mod.DEFAULT_HOUSEHOLD_SETTINGS, countExamples: async () => 0 }
})
// So is the Household section (components/HouseholdMembers.test.tsx).
vi.mock('./components/HouseholdMembers', () => ({ HouseholdMembers: () => null }))

const signedIn = (memberships: { household_id: string; role: string }[] = [{ household_id: 'h1', role: 'owner' }]) => {
  db.state.session = { user: { id: 'u1', email: 'cook@example.test' } }
  db.state.memberships = memberships
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
  db.state.session = null
  db.state.memberships = []
})

describe('Sign-in', () => {
  it('shows the sign-in screen when signed out', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('sends a magic link that returns to the app', async () => {
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: ' cook@example.test ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(db.client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'cook@example.test',
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
  })

  it('shows the error when the link cannot be sent', async () => {
    db.client.auth.signInWithOtp.mockResolvedValueOnce({ error: { message: 'Email rate limit exceeded' } })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'cook@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email rate limit exceeded')
  })
})

describe('Household setup', () => {
  it('creates the household on first sign-in', async () => {
    signedIn([])
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument()
    expect(db.client.rpc).toHaveBeenCalledWith('create_household', { household_name: 'Home' })
  })

  it('uses the existing household on later sign-ins', async () => {
    signedIn()
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument()
    expect(db.client.rpc).not.toHaveBeenCalled()
  })

  it('says so when the household cannot be set up', async () => {
    signedIn([])
    db.client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<App />)
    expect(await screen.findByText('Could not set up your household: boom')).toBeInTheDocument()
  })
})

describe('Invites', () => {
  afterEach(() => {
    localStorage.clear()
    db.client.rpc.mockImplementation(async () => ({ data: 'new-household', error: null }))
  })
  /** rpc answers by function name; the rest return the default. */
  const answers = (by: Record<string, { data: unknown; error: null | { message: string } }>) =>
    db.client.rpc.mockImplementation(async (fn: string) => (by[fn] ?? { data: 'new-household', error: null }) as never)

  it('signed out, names the household and keeps the invite in the magic link', async () => {
    window.history.replaceState(null, '', '/?invite=tok')
    answers({ invite_info: { data: [{ household_name: 'Home', status: 'open' }], error: null } })
    render(<App />)
    expect(await screen.findByText(/You’ve been invited to/)).toHaveTextContent('You’ve been invited to Home.')
    expect(db.client.rpc).toHaveBeenCalledWith('invite_info', { token: 'tok' })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'partner@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(db.client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'partner@example.test',
      options: { emailRedirectTo: `${window.location.origin}/?invite=tok` },
    })
  })

  it('signed out, says when the link is used and offers normal sign-in', async () => {
    window.history.replaceState(null, '', '/?invite=tok')
    answers({ invite_info: { data: [{ household_name: 'Home', status: 'used' }], error: null } })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite link has already been used.')
    expect(window.location.search).toBe('')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'partner@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    await screen.findByRole('heading', { name: 'Check your email' })
    expect(db.client.auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { emailRedirectTo: `${window.location.origin}/` } }),
    )
  })

  it('signed in, joins the household instead of making one, as a member without Ask Claude', async () => {
    window.history.replaceState(null, '', '/?invite=tok#recipes')
    signedIn([])
    answers({ accept_invite: { data: 'h1', error: null } })
    db.client.rpc.mockImplementationOnce(async () => {
      db.state.memberships = [{ household_id: 'h1', role: 'member' }]
      return { data: 'h1', error: null }
    })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument()
    expect(db.client.rpc).toHaveBeenCalledWith('accept_invite', { token: 'tok' })
    expect(db.client.rpc).not.toHaveBeenCalledWith('create_household', expect.anything())
    expect(window.location.search).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Add recipe' }))
    expect(await screen.findByRole('dialog', { name: 'Add a recipe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add it with Claude/ })).not.toBeInTheDocument()
  })

  it('signed in, says why a join was refused and carries on to their own household', async () => {
    window.history.replaceState(null, '', '/?invite=tok')
    signedIn()
    answers({ accept_invite: { data: null, error: { message: 'This invite has expired' } } })
    render(<App />)
    expect(await screen.findByText('Could not join the household: This invite has expired')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your own household' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument()
    expect(db.client.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('App shell', () => {
  beforeEach(() => signedIn())

  it('opens on the Week tab', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-current', 'page')
  })

  it('switches tabs and remembers the tab in the URL', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'List' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shopping list')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Week' })).not.toHaveAttribute('aria-current')
    expect(window.location.hash).toBe('#list')
  })

  it('starts on the tab named in the URL', async () => {
    window.history.replaceState(null, '', '/#recipes')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument()
  })

  it('adds a recipe through Claude, toasting when it copies the prompt instead', async () => {
    window.history.replaceState(null, '', '/#recipes')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add recipe' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it as text or a photo? Add it with Claude' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Add this recipe to my What's for Dinner recipes:\n")
    expect(await screen.findByText('Copied the question. Open Claude and paste it.')).toBeInTheDocument()
    open.mockRestore()
  })

  it('opens the settings sheet and closes it with Escape or the scrim', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Household settings' }))
    expect(screen.getByRole('dialog', { name: 'Household settings' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Household settings' }))
    fireEvent.click(screen.getByTestId('scrim'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('signs out from settings', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Household settings' }))
    expect(screen.getByText('Signed in as cook@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(db.client.auth.signOut).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
  })
})

describe('Offline', () => {
  const setOnline = (online: boolean) =>
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
      window.dispatchEvent(new Event(online ? 'online' : 'offline'))
    })
  afterEach(() => {
    setOnline(true)
    act(() => clearQueues())
    localStorage.clear()
  })

  // The stand-in client cannot save list changes, so every send here gets no answer, as on a weak signal.
  it('says how many changes will sync, still allows hand-added items, and says when they are still waiting online', async () => {
    signedIn()
    window.history.replaceState(null, '', '/#list')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Add item' })).toBeEnabled()
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    setOnline(false)
    expect(screen.getByText('Offline.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled()
    act(() => {
      enqueue('h1', { kind: 'mark', week: '2026-10-26', key: 'milk|ml', change: { ticked: true } })
      enqueue('h1', { kind: 'mark', week: '2026-10-26', key: 'bread|each', change: { ticked: true } })
    })
    expect(screen.getByText('Offline, 2 changes will sync.')).toBeInTheDocument()
    setOnline(true)
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    expect(await screen.findByText('Weak signal, 2 changes waiting to sync.')).toBeInTheDocument()
  })

  it('asks before signing out with changes waiting', async () => {
    signedIn()
    enqueue('h1', { kind: 'mark', week: '2026-10-26', key: 'milk|ml', change: { ticked: true } })
    setOnline(false)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Household settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText('1 list change has not synced yet')).toBeInTheDocument()
    expect(db.client.auth.signOut).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }))
    expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
    expect(pending('h1')).toEqual([])
  })

  it('stays signed in when an expired login cannot be refreshed with no signal', async () => {
    // supabase-js reports no session but keeps it in storage until a real sign-out.
    localStorage.setItem(
      // The key auth.ts reads: the live project's, or the local stack's when web/.env.local sets one.
      `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`,
      JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'cook@example.test' } }),
    )
    db.state.memberships = [{ household_id: 'h1', role: 'owner' }]
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument()
  })

  it('forgets the last-loaded data on sign-out', async () => {
    const remove = vi.fn(async () => true)
    Object.defineProperty(window, 'caches', { value: { delete: remove }, configurable: true })
    signedIn()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Household settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
    expect(remove).toHaveBeenCalledWith('wfd-data')
  })
})
