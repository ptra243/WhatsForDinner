// Allergens a household avoids (`household_settings.settings.avoid`) and the ones a dish still
// contains. Ingredient tags are generic, so the app warns but never promises a dish is safe.
import type { Swap } from './list'
import type { RecipeIngredient } from './recipes'

/** Australia's mandatory allergens, in the order the app lists them. Keep in step with `private.allergens()`. */
export const ALLERGENS = [
  'egg',
  'milk',
  'peanut',
  'tree nut',
  'sesame',
  'soy',
  'wheat',
  'gluten',
  'fish',
  'crustacean',
  'mollusc',
  'lupin',
] as const

export type Allergen = (typeof ALLERGENS)[number]

/** The allergens in `raw` that are on the list, in list order; anything else is dropped. */
export function toAllergens(raw: unknown): Allergen[] {
  const given = Array.isArray(raw) ? raw : []
  return ALLERGENS.filter((a) => given.includes(a))
}

/** An avoided allergen a dish still contains, with the ingredients that bring it. */
export type AllergenWarning = { allergen: Allergen; ingredients: string[] }

const key = (name: string) => name.toLowerCase().trim()

/** A dish's swap with the allergens of the ingredient it swaps to (none when that ingredient isn't on the list). */
export type TaggedSwap = Swap & { allergens?: readonly string[] }

/** The avoided allergens left in a dish once its swaps are applied: a swapped ingredient counts as what it was swapped to. */
export function allergenWarnings(
  ingredients: RecipeIngredient[],
  avoid: readonly string[],
  swaps: TaggedSwap[] = [],
): AllergenWarning[] {
  if (!avoid.length) return []
  const found = new Map<Allergen, string[]>()
  for (const i of ingredients) {
    const swap = swaps.find((s) => key(s.from) === key(i.name))
    const name = swap ? key(swap.to) : i.name
    const tags = (swap ? swap.allergens : i.allergens) ?? []
    for (const a of ALLERGENS) {
      if (!avoid.includes(a) || !tags.includes(a)) continue
      const names = found.get(a) ?? []
      if (!names.includes(name)) names.push(name)
      found.set(a, names)
    }
  }
  return ALLERGENS.filter((a) => found.has(a)).map((a) => ({ allergen: a, ingredients: found.get(a)! }))
}

/** "Contains egg" or "Contains egg and sesame". */
export function containsText(allergens: readonly string[]): string {
  const list = allergens.length > 1 ? `${allergens.slice(0, -1).join(', ')} and ${allergens.at(-1)}` : allergens[0]
  return `Contains ${list}`
}
