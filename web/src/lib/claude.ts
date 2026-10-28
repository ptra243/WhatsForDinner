// Hand-off to Claude: open claude.ai with the question written (docs/architecture.md, Hand-off).

/** A claude.ai link that starts a new chat with `prompt` filled in. */
export const claudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

/**
 * Opens Claude with the prompt filled in. When the browser blocks the new tab, copies the
 * prompt instead. Returns what happened, so the caller can say so.
 */
export async function askClaude(prompt: string): Promise<'opened' | 'copied' | 'failed'> {
  // Not 'noopener': with it, window.open returns null even when the tab opens.
  const tab = window.open(claudeUrl(prompt), '_blank')
  if (tab) {
    tab.opener = null
    return 'opened'
  }
  try {
    await navigator.clipboard.writeText(prompt)
    return 'copied'
  } catch {
    return 'failed'
  }
}
