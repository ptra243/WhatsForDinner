import { useEffect, useState, type ReactNode } from 'react'
import { Toast } from './components/AskClaude'
import { Header } from './components/Header'
import { ListTab } from './components/ListTab'
import { PantryTab } from './components/PantryTab'
import { RecipesTab } from './components/RecipesTab'
import { ResumeCook } from './components/ResumeCook'
import { SignIn } from './components/SignIn'
import { SettingsSheet } from './components/SettingsSheet'
import { Tabs } from './components/Tabs'
import { WeekTab } from './components/WeekTab'
import { useHousehold, useSession, type Household } from './lib/auth'
import { useWeekStartsOn } from './lib/household'
import { CanAskClaude } from './lib/askAccess'
import { flush, flushWhenShown, usePendingCount, useStalled } from './lib/offlineQueue'
import { useBackCloses } from './lib/back'
import { useOnline } from './lib/online'
import { getPlace, scrollPageTo, setPlace } from './lib/place'
import { supabase } from './lib/supabase'
import { CurrentUser } from './lib/votes'
import { TABS, type Tab } from './tabs'

const TITLES: Record<Tab, string> = { week: 'This week', list: 'Shopping list', recipes: 'Recipes', pantry: 'Pantry' }

const isTab = (v: unknown): v is Tab => (TABS as readonly unknown[]).includes(v)

/** The tab to open on: the one in the URL, else the one the app was last on, else Week. */
function startTab(): Tab {
  const h = window.location.hash.slice(1)
  if (isTab(h)) return h
  const kept = getPlace('tab')
  return isTab(kept) ? kept : 'week'
}

/** How far down each tab was, to go back to. */
function keptScroll(): Partial<Record<Tab, number>> {
  const kept = getPlace('scroll')
  return kept && typeof kept === 'object' ? (kept as Partial<Record<Tab, number>>) : {}
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
  const [tab, setTab] = useState<Tab>(startTab)
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
  // The day weeks start on; the tabs show once it is known and start again when it changes.
  const weekStart = useWeekStartsOn(householdId, settingsVersion)

  // List changes made with no signal are sent when the app opens, when the signal returns and
  // when the app is shown again; the queue also retries on a timer while sends get no answer.
  useEffect(() => {
    if (online) void flush(householdId)
  }, [householdId, online])
  useEffect(() => flushWhenShown(householdId), [householdId])

  // The tab goes in the URL and is kept, and the page goes back to where it was on that tab.
  useEffect(() => {
    // Also after history moves: closing something steps back to an entry that may name another tab.
    const show = () => window.history.replaceState(window.history.state, '', `#${tab}`)
    show()
    window.addEventListener('popstate', show)
    setPlace('tab', tab)
    const stop = scrollPageTo(keptScroll()[tab] ?? 0)
    return () => {
      window.removeEventListener('popstate', show)
      stop()
    }
  }, [tab])

  // Keeps how far down this tab is when the app goes off screen or reloads.
  useEffect(() => {
    const keep = () => setPlace('scroll', { ...keptScroll(), [tab]: window.scrollY })
    const hidden = () => {
      if (document.visibilityState === 'hidden') keep()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', keep)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', keep)
    }
  }, [tab])

  /** Shows a tab where it was left, or from its top with `fromTop`. */
  const changeTab = (t: Tab, fromTop = false) => {
    setPlace('scroll', { ...keptScroll(), [tab]: window.scrollY, ...(fromTop && { [t]: 0 }) })
    setLikedWeek(undefined)
    setTab(t)
  }
  // Back from another tab goes to Week; back on Week leaves the app.
  useBackCloses(() => changeTab('week'), tab !== 'week')

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
          {!weekStart ? (
            <p className="muted" role="status">
              Loading…
            </p>
          ) : tab === 'recipes' ? (
            <RecipesTab
              key={weekStart}
              householdId={householdId}
              likedWeek={likedWeek}
              adding={addingRecipe}
              onAddClose={() => setAddingRecipe(false)}
            />
          ) : tab === 'week' ? (
            <WeekTab
              key={weekStart}
              householdId={householdId}
              settingsVersion={settingsVersion}
              onShowVotes={(week) => {
                changeTab('recipes', true)
                setLikedWeek(week)
              }}
            />
          ) : tab === 'pantry' ? (
            <PantryTab key={weekStart} householdId={householdId} adding={adding} onAddClose={() => setAdding(false)} />
          ) : (
            <ListTab key={weekStart} householdId={householdId} adding={adding} onAddClose={() => setAdding(false)} />
          )}
        </div>
      </main>
      <Tabs current={tab} onChange={changeTab} />
      {weekStart && <ResumeCook householdId={householdId} />}
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
