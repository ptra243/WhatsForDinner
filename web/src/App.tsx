import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Sheet } from './components/Sheet'
import { Tabs } from './components/Tabs'
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
          <p className="muted small">Settings arrive with sign-in.</p>
          <button className="btn wide" type="button" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </Sheet>
      )}
    </>
  )
}
