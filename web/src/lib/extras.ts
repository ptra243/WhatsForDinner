// Optional steps and extras (#56): a step can be an extra that makes the dish better but takes
// longer. Each planned dish chooses its extras (`meal_plan_dishes.extras`); the recipe is unchanged.
// Pure code, shared by the night's times, the shopping list and cook mode.
import type { RecipeIngredient, RecipeStep } from './recipes'

/** Whether a method's steps have their ingredients saved: then each step's own links are what it uses. */
export const isLinked = (steps: readonly RecipeStep[]) => steps.some((s) => (s.uses?.length ?? 0) > 0)

/** A method's optional steps, the extras a night can choose. */
export const optionalSteps = (steps: readonly RecipeStep[]) => steps.filter((s) => s.optional && s.id)

/** Whether the step is cooked tonight: every required step, and the optional ones chosen. */
export const isCooked = (s: RecipeStep, extras: readonly string[] = []) =>
  !s.optional || (!!s.id && extras.includes(s.id))

/** The steps cooked tonight, in order: the required ones and the chosen extras. */
export const cookedSteps = (steps: readonly RecipeStep[], extras: readonly string[] = []) =>
  steps.filter((s) => isCooked(s, extras))

/** The minutes the chosen extras add, by their own minutes. */
export const extraMinutes = (steps: readonly RecipeStep[], extras: readonly string[] = []) =>
  steps.reduce((n, s) => n + (s.optional && isCooked(s, extras) ? (s.extraMins ?? 0) : 0), 0)

/**
 * The ingredients only skipped steps use: left off the shopping list and out of cook mode. Only
 * for linked steps; an ingredient no step uses is still bought. With no extras chosen these are
 * the recipe's optional ingredients.
 */
export function skippedIngredients(
  steps: readonly RecipeStep[],
  ingredients: readonly RecipeIngredient[],
  extras: readonly string[] = [],
): RecipeIngredient[] {
  if (!isLinked(steps)) return []
  const uses = (s: RecipeStep, i: RecipeIngredient) => i.id != null && !!s.uses?.includes(i.id)
  return ingredients.filter((i) => steps.some((s) => uses(s, i)) && !steps.some((s) => isCooked(s, extras) && uses(s, i)))
}

/** What an extra adds, after its text: "silkier, more tender · +15 min". */
export const extraDetail = (s: RecipeStep) =>
  [s.why?.trim(), s.extraMins ? `+${s.extraMins} min` : ''].filter(Boolean).join(' · ')
