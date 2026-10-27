import { useEffect, type ReactNode } from 'react'

/** Bottom sheet over a scrim. Closes on the scrim, Escape, or the caller's own buttons. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" data-testid="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="wrap">
          <div className="grab" />
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    </>
  )
}
