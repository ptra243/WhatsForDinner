import { describe, expect, it } from 'vitest'
import { cookedSteps, extraDetail, extraMinutes, optionalSteps, skippedIngredients } from './extras'
import type { RecipeIngredient, RecipeStep } from './recipes'

const ing = (id: string): RecipeIngredient => ({ id, name: id, qty: 1, unit: 'each', note: '' })
const [beef, corn, garlic, oil] = ['beef', 'cornflour', 'garlic', 'oil'].map(ing)
const steps: RecipeStep[] = [
  { id: 'velvet', text: 'Velvet the beef.', timerMins: null, optional: true, extraMins: 15, why: 'silkier, more tender', uses: ['beef', 'cornflour'] },
  { id: 'fry', text: 'Stir-fry the beef.', timerMins: 5, uses: ['beef', 'oil'] },
  { id: 'chips', text: 'Fry garlic chips.', timerMins: null, optional: true, extraMins: 5, why: '', uses: ['garlic', 'oil'] },
]

describe('extras', () => {
  it('finds the optional steps and the ones cooked tonight, in order', () => {
    expect(optionalSteps(steps).map((s) => s.id)).toEqual(['velvet', 'chips'])
    expect(cookedSteps(steps).map((s) => s.id)).toEqual(['fry'])
    expect(cookedSteps(steps, ['chips', 'velvet']).map((s) => s.id)).toEqual(['velvet', 'fry', 'chips'])
  })

  it('adds up the chosen extras’ minutes', () => {
    expect(extraMinutes(steps)).toBe(0)
    expect(extraMinutes(steps, ['velvet'])).toBe(15)
    expect(extraMinutes(steps, ['velvet', 'chips', 'fry'])).toBe(20)
  })

  it('skips the ingredients only skipped steps use', () => {
    const ingredients = [beef, corn, garlic, oil]
    expect(skippedIngredients(steps, ingredients)).toEqual([corn, garlic])
    expect(skippedIngredients(steps, ingredients, ['velvet'])).toEqual([garlic])
    expect(skippedIngredients(steps, ingredients, ['velvet', 'chips'])).toEqual([])
    expect(skippedIngredients(steps.map((s) => ({ ...s, uses: [] })), ingredients)).toEqual([])
  })

  it('says what an extra adds', () => {
    expect(extraDetail(steps[0])).toBe('silkier, more tender · +15 min')
    expect(extraDetail(steps[2])).toBe('+5 min')
  })
})
