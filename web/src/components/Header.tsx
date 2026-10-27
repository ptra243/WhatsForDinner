import type { ReactNode } from 'react'

/** Sticky page header: the page title and an optional action on the right. */
export function Header({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="top">
      <div className="wrap">
        <h1>{title}</h1>
        {action}
      </div>
    </header>
  )
}
