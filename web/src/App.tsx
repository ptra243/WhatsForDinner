import { useEffect, useState, type ReactNode } from 'react'
import { Header } from './components/Header'
import { SignIn } from './components/SignIn'
import { Sheet } from './components/Sheet'
import { Tabs } from './components/Tabs'
import { useHousehold, useSession } from './lib/auth'
import { supabase } from './lib/supabase'
import { TABS, type Tab } from './tabs'

const TITLES: Record<Tab, string> = { week: 'This week', list: 'Shopping list', recipes: 'Recipes' }

const EMPTY: Record<Tab, { heading: string; body: string }> = {
  week: { heading: 'No plan yet', body: 'Your week of dinners will show here.' },
  list: { heading: 'Nothing to buy yet', body: 'The shopping list is made from the week’s plan.' },
  recipes: { heading: 'No recipes yet', body: 'Your household’s recipes will show here.' },
}

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1)
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'week'
}

export default function App() {
  const session = useSession()
  const household = useHousehold(session?.user.id)

  if (session === undefined) return <Notice text="Loading…" />
  if (!session) return <SignIn />
  if (household.error) {
    return (
      <Notice text={`Could not set up your household: ${household.error}`}>
        <button className="btn ghost" type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Notice>
    )
  }
  if (!household.id) return <Notice text="Setting up your household…" />
  return <Shell email={session.user.email ?? ''} />
}

/** Full-page message while signing in or setting up. */
function Notice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <main>
      <div className="wrap sign-in">
        <h1>What’s for Dinner</h1>
        <p className="muted" role="status">
          {text}
        </p>
        {children}
      </div>
    </main>
  )
}

/** The signed-in app: tabs, header and the settings sheet. */
function Shell({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const changeTab = (t: Tab) => {
    setTab(t)
    window.history.replaceState(null, '', `#${t}`)
    window.scrollTo(0, 0)
  }

  const settingsButton = (
    <button className="icon" type="button" aria-label="Household settings" onClick={() => setSettingsOpen(true)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </svg>
    </button>
  )

  return (
    <>
      <Header title={TITLES[tab]} action={tab === 'week' ? settingsButton : undefined} />
      <main>
        <div className="wrap">
          <div className="empty-state">
            <h2>{EMPTY[tab].heading}</h2>
            <p className="muted">{EMPTY[tab].body}</p>
          </div>
        </div>
      </main>
      <Tabs current={tab} onChange={changeTab} />
      {settingsOpen && (
        <Sheet title="Household settings" onClose={() => setSettingsOpen(false)}>
          <p className="muted small">Signed in as {email}</p>
          <button className="btn ghost wide" type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <button className="btn wide" type="button" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </Sheet>
      )}
    </>
  )
}
