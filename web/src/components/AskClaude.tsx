import { useEffect, useState, type ReactNode } from 'react'
import { askClaude } from '../lib/claude'
import { onToast, showToast } from '../lib/toast'

/** Where toasts show, above the tab bar. Rendered once, by the app shell. */
export function Toast() {
  const [text, setText] = useState<string>()
  useEffect(() => onToast(setText), [])
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {text && <div className="toast">{text}</div>}
    </div>
  )
}

type Props = { prompt: string | (() => string); className?: string; children: ReactNode }

/** A button that opens Claude with `prompt`, toasting when it had to copy the prompt instead. */
export function AskClaudeButton({ prompt, className = 'btn ghost', children }: Props) {
  const ask = async () => {
    const result = await askClaude(typeof prompt === 'function' ? prompt() : prompt)
    if (result === 'copied') showToast('Copied the question. Open Claude and paste it.')
    if (result === 'failed') showToast('Could not open Claude or copy the question. Open Claude and ask there.')
  }
  return (
    <button className={className} type="button" onClick={ask}>
      {children}
    </button>
  )
}
