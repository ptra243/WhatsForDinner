import { useEffect, useState, type ReactNode } from 'react'
import { AskClaudeButton, Toast } from './components/AskClaude'
import { Header } from './components/Header'
import { ListTab } from './components/ListTab'
import { RecipesTab } from './components/RecipesTab'
import { SignIn } from './components/SignIn'
import { SettingsSheet } from './components/SettingsSheet'
import { Tabs } from './components/Tabs'
import { WeekTab } from './components/WeekTab'
import { useHousehold, useSession } from './lib/auth'
import { addRecipePrompt } from './lib/claude'
import { supabase } from './lib/supabase'
import { TABS, type Tab } from './tabs'

const TITLES: Record<Tab, string> = { week: 'This week', list: 'Shopping list', recipes: 'Recipes' }

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
  return <Shell email={session.user.email ?? ''} householdId={household.id} />
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
function Shell({ email, householdId }: { email: string; householdId: string }) {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)

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

  const addButton = (
    <button className="btn ghost" type="button" onClick={() => setAdding(true)}>
      Add item
    </button>
  )

  const addRecipeButton = <AskClaudeButton prompt={addRecipePrompt()}>Add recipe</AskClaudeButton>

  return (
    <>
      <Header title={TITLES[tab]} action={tab === 'week' ? settingsButton : tab === 'list' ? addButton : addRecipeButton} />
      <main>
        <div className="wrap">
          {tab === 'recipes' ? (
            <RecipesTab householdId={householdId} />
          ) : tab === 'week' ? (
            <WeekTab householdId={householdId} settingsVersion={settingsVersion} />
          ) : (
            <ListTab householdId={householdId} adding={adding} onAddClose={() => setAdding(false)} />
          )}
        </div>
      </main>
      <Tabs current={tab} onChange={changeTab} />
      <Toast />
      {settingsOpen && (
        <SettingsSheet
          householdId={householdId}
          email={email}
          onChanged={() => setSettingsVersion((v) => v + 1)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}
