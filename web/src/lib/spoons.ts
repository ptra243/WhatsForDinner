// Grams beside spoon measures of things you'd weigh (#96): "2 tbsp ≈ 40 g".
import { scaledQty, slugOf } from './format'

/** Millilitres in a spoon: the Australian 20 ml tablespoon and the 5 ml teaspoon. */
export const SPOON_ML: Record<string, number> = { tsp: 5, tbsp: 20 }

/**
 * Grams in one level 20 ml tablespoon, by ingredient slug. Only the common ingredients a cook
 * would rather weigh; anything else shows its spoons alone.
 */
export const GRAMS_PER_TBSP: Record<string, number> = {
  butter: 20,
  ghee: 18,
  flour: 12,
  'plain-flour': 12,
  'self-raising-flour': 12,
  cornflour: 10,
  sugar: 18,
  'white-sugar': 18,
  'caster-sugar': 18,
  'brown-sugar': 16,
  honey: 28,
  'peanut-butter': 21,
  'tomato-paste': 22,
}

/** Grams for reading: to the nearest 5, or the nearest 1 under 10. */
export function roundGrams(g: number): number {
  return g < 10 ? Math.round(g) : Math.round(g / 5) * 5
}

/**
 * The grams in a `tsp` or `tbsp` amount of an ingredient in the table, rounded for reading.
 * Null for other units, other ingredients, no amount, or too little to weigh.
 */
export function spoonGrams(name: string, qty: number | null, unit: string): number | null {
  const perTbsp = GRAMS_PER_TBSP[slugOf(name)]
  const ml = SPOON_ML[unit]
  if (perTbsp == null || ml == null || qty == null || isNaN(qty)) return null
  return roundGrams((qty * ml * perTbsp) / SPOON_ML.tbsp) || null
}

/**
 * One recipe ingredient's amount for `servings`, as cook mode and the recipe view show it:
 * the scaled amount, with grams beside a spoon measure of something you'd weigh.
 */
export function scaledAmount(
  i: { name: string; qty: number | null; unit: string },
  servings: number,
  serves: number,
): string {
  const text = scaledQty(i.qty, i.unit, servings, serves)
  const grams = spoonGrams(i.name, i.qty == null ? null : (i.qty * servings) / (serves || 4), i.unit)
  return grams == null ? text : `${text} ≈ ${grams} g`
}
