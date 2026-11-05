import { useEffect, useState, type ReactNode } from 'react'
import { Toast } from './components/AskClaude'
import { Header } from './components/Header'
import { ListTab } from './components/ListTab'
import { PantryTab } from './components/PantryTab'
import { RecipesTab } from './components/RecipesTab'
import { SignIn } from './components/SignIn'
import { SettingsSheet } from './components/SettingsSheet'
import { Tabs } from './components/Tabs'
import { WeekTab } from './components/WeekTab'
import { useHousehold, useSession, type Household } from './lib/auth'
import { CanAskClaude } from './lib/askAccess'
import { flush, flushWhenShown, usePendingCount, useStalled } from './lib/offlineQueue'
import { useOnline } from './lib/online'
import { supabase } from './lib/supabase'
import { CurrentUser } from './lib/votes'
import { TABS, type Tab } from './tabs'

const TITLES: Record<Tab, string> = { week: 'This week', list: 'Shopping list', recipes: 'Recipes', pantry: 'Pantry' }

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1)
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'week'
}

export default function App() {
  const session = useSession()
  const household = useHousehold(session?.user.id)

  if (session === undefined) return <Notice text="Loading…" />
  if (!session) return <SignIn />
  if (household.inviteError) {
    return (
      <Notice text={`Could not join the household: ${household.inviteError}`}>
        <button className="btn wide" type="button" onClick={household.skipInvite}>
          Continue to your own household
        </button>
      </Notice>
    )
  }
  if (household.error) {
    return (
      <Notice text={`Could not set up your household: ${household.error}`}>
        <button className="btn ghost" type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Notice>
    )
  }
  if (!household.household) return <Notice text="Setting up your household…" />
  return (
    <CanAskClaude.Provider value={household.household.role === 'owner'}>
      <CurrentUser.Provider value={session.user.id}>
        <Shell user={{ id: session.user.id, email: session.user.email ?? '' }} household={household.household} />
      </CurrentUser.Provider>
    </CanAskClaude.Provider>
  )
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
function Shell({ user, household }: { user: { id: string; email: string }; household: Household }) {
  const householdId = household.id
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addingRecipe, setAddingRecipe] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  // The week whose 👍 recipes the Recipes tab opens filtered to, from the Week tab's vote tally.
  const [likedWeek, setLikedWeek] = useState<string>()
  const online = useOnline()
  const waiting = usePendingCount(householdId)
  const stalled = useStalled(householdId)
  const changes = `${waiting} ${waiting === 1 ? 'change' : 'changes'}`

  // List changes made with no signal are sent when the app opens, when the signal returns and
  // when the app is shown again; the queue also retries on a timer while sends get no answer.
  useEffect(() => {
    if (online) void flush(householdId)
  }, [householdId, online])
  useEffect(() => flushWhenShown(householdId), [householdId])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const changeTab = (t: Tab) => {
    setLikedWeek(undefined)
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

  const addRecipeButton = (
    <button className="btn ghost" type="button" onClick={() => setAddingRecipe(true)}>
      Add recipe
    </button>
  )

  return (
    <>
      <Header
        title={TITLES[tab]}
        action={tab === 'week' ? settingsButton : tab === 'list' || tab === 'pantry' ? addButton : addRecipeButton}
      />
      <main>
        <div className="wrap">
          {!online ? (
            <p className="banner" role="status">
              <b>{waiting ? `Offline, ${changes} will sync.` : 'Offline.'}</b> Showing what was last loaded; list changes sync when the
              signal is back.
            </p>
          ) : (
            stalled &&
            waiting > 0 && (
              <p className="banner" role="status">
                <b>Weak signal, {changes} waiting to sync.</b> They send by themselves when the signal is better.
              </p>
            )
          )}
          {tab === 'recipes' ? (
            <RecipesTab
              householdId={householdId}
              likedWeek={likedWeek}
              adding={addingRecipe}
              onAddClose={() => setAddingRecipe(false)}
            />
          ) : tab === 'week' ? (
            <WeekTab
              householdId={householdId}
              settingsVersion={settingsVersion}
              onShowVotes={(week) => {
                changeTab('recipes')
                setLikedWeek(week)
              }}
            />
          ) : tab === 'pantry' ? (
            <PantryTab householdId={householdId} adding={adding} onAddClose={() => setAdding(false)} />
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
          user={user}
          isOwner={household.role === 'owner'}
          onChanged={() => setSettingsVersion((v) => v + 1)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}
