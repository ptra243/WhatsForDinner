import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// A stand-in for the Supabase client: a session (or none), the user's memberships and create_household.
const db = vi.hoisted(() => {
  const state = {
    session: null as null | { user: { id: string; email: string } },
    memberships: [] as { household_id: string }[],
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
      select: () => ({ limit: async () => ({ data: state.memberships, error: null }) }),
    })),
    rpc: vi.fn<(fn: string, args: unknown) => Promise<{ data: string | null; error: null | { message: string } }>>(
      async () => ({ data: 'new-household', error: null }),
    ),
  }
  return { state, client }
})
vi.mock('./lib/supabase', () => ({ supabase: db.client }))
// The Week tab has its own tests (components/WeekTab.test.tsx).
vi.mock('./components/WeekTab', () => ({ WeekTab: () => null }))
// So has the Shopping list tab (components/ListTab.test.tsx).
vi.mock('./components/ListTab', () => ({ ListTab: () => null }))
// The settings sheet's own fields are tested in components/SettingsSheet.test.tsx.
vi.mock('./lib/household', async (actual) => {
  const mod = await actual<typeof import('./lib/household')>()
  return { ...mod, loadHouseholdSettings: async () => mod.DEFAULT_HOUSEHOLD_SETTINGS, countExamples: async () => 0 }
})

const signedIn = (memberships: { household_id: string }[] = [{ household_id: 'h1' }]) => {
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
    localStorage.clear()
  })

  it('says ticks need signal and stops hand-added items', async () => {
    signedIn()
    window.history.replaceState(null, '', '/#list')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Add item' })).toBeEnabled()
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    setOnline(false)
    expect(screen.getByText('Offline, ticks need signal.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled()
    setOnline(true)
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
  })

  it('stays signed in when an expired login cannot be refreshed with no signal', async () => {
    // supabase-js reports no session but keeps it in storage until a real sign-out.
    localStorage.setItem(
      'sb-fckheksaemriadvrveoj-auth-token',
      JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'cook@example.test' } }),
    )
    db.state.memberships = [{ household_id: 'h1' }]
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
