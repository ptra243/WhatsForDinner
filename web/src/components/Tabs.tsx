import type { ReactNode } from 'react'
import { TAB_NAMES, TABS, type Tab } from '../tabs'

const ICONS: Record<Tab, ReactNode> = {
  week: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </svg>
  ),
  recipes: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
    </svg>
  ),
  pantry: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3h8v3H8z" />
      <path d="M7 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M5 12h14" />
    </svg>
  ),
}

/** Fixed bottom tab bar. */
export function Tabs({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <div className="wrap">
        {TABS.map((t) => (
          <button key={t} type="button" aria-current={current === t ? 'page' : undefined} onClick={() => onChange(t)}>
            {ICONS[t]}
            <span>{TAB_NAMES[t]}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
