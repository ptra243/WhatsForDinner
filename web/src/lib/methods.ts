// Equipment method variants (#24): a recipe's other ways to cook it, each with its own times and steps.
import type { Recipe, RecipeStep } from './recipes'

/** What the recipe's own times and steps are called next to its other methods. */
export const DEFAULT_METHOD_NAME = 'Usual way'

/** One way to cook a recipe: one of its methods, or its default (`id` null). */
export type CookingMethod = {
  id: string | null
  name: string
  equipment: string | null
  activeMins: number | null
  totalMins: number | null
  steps: RecipeStep[]
}

/** The recipe's default method: its own times and steps. */
export function defaultMethod(r: Recipe): CookingMethod {
  return { id: null, name: DEFAULT_METHOD_NAME, equipment: null, activeMins: r.activeMins, totalMins: r.totalMins, steps: r.steps }
}

/** The method a dish is cooked by; the default when `methodId` is null or no longer one of the recipe's. */
export function methodOf(r: Recipe, methodId?: string | null): CookingMethod {
  return (methodId && r.methods?.find((m) => m.id === methodId)) || defaultMethod(r)
}

/** Every way to cook the recipe, the default first. */
export function allMethods(r: Recipe): CookingMethod[] {
  return [defaultMethod(r), ...(r.methods ?? [])]
}

/** Whether the household has what a method needs (names compared without case or spaces around). */
export function hasEquipment(equipment: string | null, owned: readonly string[]): boolean {
  if (!equipment) return true
  const want = equipment.trim().toLowerCase()
  return owned.some((e) => e.trim().toLowerCase() === want)
}

/**
 * The methods a night can pick for a dish: the default, then those the household has the
 * equipment for, plus the one already chosen. Empty when there is nothing to choose between.
 */
export function methodChoices(r: Recipe, owned: readonly string[], chosen?: string | null): CookingMethod[] {
  const choices = allMethods(r).filter((m) => m.id === null || m.id === chosen || hasEquipment(m.equipment, owned))
  return choices.length > 1 ? choices : []
}
