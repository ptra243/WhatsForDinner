// Hand-off to Claude: open claude.ai with the question written (docs/architecture.md, Hand-off).
import { DAY_FULL, dateOf, dayLabel, rangeLabel, type Day } from './week'

/** A claude.ai link that starts a new chat with `prompt` filled in. */
export const claudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

/**
 * Opens Claude with the prompt filled in, and copies the prompt too in case the Claude app
 * drops the prefill. When the browser blocks the new tab, the copy is the fallback. Returns
 * what happened, so the caller can say so.
 */
export async function askClaude(prompt: string): Promise<'opened' | 'copied' | 'failed'> {
  // Started before the tab opens, while this page still has focus.
  const copied = copy(prompt)
  // Not 'noopener': with it, window.open returns null even when the tab opens.
  const tab = window.open(claudeUrl(prompt), '_blank')
  if (tab) {
    tab.opener = null
    return 'opened'
  }
  return (await copied) ? 'copied' : 'failed'
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Each prompt names the app so Claude picks up the Dinner Planner skill. The ones ending in
// ': ' leave the question for the owner to type before sending.

const week = (weekStart: string) => `the week of ${rangeLabel(weekStart)} (starting ${weekStart})`

export const planWeekPrompt = (weekStart: string) =>
  `Plan dinners in What's for Dinner for ${week(weekStart)}, from my recipes and household settings.`

export const weekPrompt = (weekStart: string) => `About my What's for Dinner plan for ${week(weekStart)}: `

export const nightPrompt = (weekStart: string, day: Day) =>
  `About ${DAY_FULL[day]} ${dayLabel(dateOf(weekStart, day))} in my What's for Dinner plan (week starting ${weekStart}): `

export const recipePrompt = (name: string, id: string) => `About my What's for Dinner recipe "${name}" (id ${id}): `

export const addRecipePrompt = () => `Add this recipe to my What's for Dinner recipes:\n`
