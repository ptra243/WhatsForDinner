import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_PROJECT_ID } from '../config'
import { addRecipePrompt, askClaude, claudeUrl, nightPrompt, planWeekPrompt, recipePrompt, weekPrompt } from './claude'

const clipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true })

afterEach(() => vi.restoreAllMocks())

describe('askClaude', () => {
  it('opens a new chat in the Dinner Skill project with the prompt filled in, and copies it too', async () => {
    const tab = { opener: window } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    clipboard(async () => {})
    expect(await askClaude('Plan & save?')).toBe('opened')
    expect(open).toHaveBeenCalledWith(`https://claude.ai/new?project=${CLAUDE_PROJECT_ID}&q=Plan%20%26%20save%3F`, '_blank')
    expect(tab.opener).toBeNull()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Plan & save?')
  })

  it('falls back to the copied prompt when the tab is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    clipboard(async () => {})
    expect(await askClaude('hi')).toBe('copied')
  })

  it('says when it can neither open nor copy', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    clipboard(async () => {
      throw new Error('denied')
    })
    expect(await askClaude('hi')).toBe('failed')
  })
})

describe('prompts', () => {
  it('name the app and the week, night or recipe', () => {
    expect(claudeUrl('a b')).toBe('https://claude.ai/new?project=01a180b0-2b71-77dc-89d5-c82d85418fc4&q=a%20b')
    expect(planWeekPrompt('2026-10-26')).toBe(
      "Plan dinners in What's for Dinner for the week of 26 Oct to 1 Nov (starting 2026-10-26), from my recipes and household settings.",
    )
    expect(weekPrompt('2026-10-26')).toBe("About my What's for Dinner plan for the week of 26 Oct to 1 Nov (starting 2026-10-26): ")
    expect(nightPrompt('2026-10-26', 'thu')).toBe("About Thursday 29 Oct in my What's for Dinner plan (week starting 2026-10-26): ")
    expect(recipePrompt('Beef stew', 'r1')).toBe(`About my What's for Dinner recipe "Beef stew" (id r1): `)
    expect(addRecipePrompt()).toBe("Add this recipe to my What's for Dinner recipes:\n")
  })
})
