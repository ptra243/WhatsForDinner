import { describe, expect, it } from 'vitest'
import { allergenWarnings, containsText, toAllergens } from './allergens'
import type { RecipeIngredient } from './recipes'

const ing = (name: string, allergens: string[] = []): RecipeIngredient => ({ name, qty: 1, unit: 'each', note: '', allergens })

const SOUP = [
  ing('egg noodle', ['egg', 'wheat', 'gluten']),
  ing('wonton wrapper', ['egg', 'wheat', 'gluten']),
  ing('prawn', ['crustacean']),
  ing('bok choy'),
]

describe('allergenWarnings', () => {
  it('names each avoided allergen with the ingredients that bring it', () => {
    expect(allergenWarnings(SOUP, ['egg', 'crustacean'])).toEqual([
      { allergen: 'egg', ingredients: ['egg noodle', 'wonton wrapper'] },
      { allergen: 'crustacean', ingredients: ['prawn'] },
    ])
  })

  it('warns about nothing when nothing is avoided or nothing matches', () => {
    expect(allergenWarnings(SOUP, [])).toEqual([])
    expect(allergenWarnings(SOUP, ['peanut'])).toEqual([])
    expect(allergenWarnings([{ name: 'egg', qty: 2, unit: 'each', note: '' }], ['egg'])).toEqual([])
  })

  it('clears an allergen once every ingredient that brings it is swapped for one without it', () => {
    const one = [{ from: 'egg noodle', to: 'rice noodle', qty: null, unit: null, allergens: [] }]
    expect(allergenWarnings(SOUP, ['egg'], one)).toEqual([{ allergen: 'egg', ingredients: ['wonton wrapper'] }])
    const both = [...one, { from: 'Wonton Wrapper', to: 'egg-free wonton wrapper', qty: null, unit: null, allergens: ['wheat', 'gluten'] }]
    expect(allergenWarnings(SOUP, ['egg'], both)).toEqual([])
    expect(allergenWarnings(SOUP, ['egg', 'gluten'], both)).toEqual([
      { allergen: 'gluten', ingredients: ['egg-free wonton wrapper'] },
    ])
  })

  it('warns about a swap that brings in an avoided allergen', () => {
    const swaps = [{ from: 'bok choy', to: 'sesame seed', qty: null, unit: null, allergens: ['sesame'] }]
    expect(allergenWarnings(SOUP, ['sesame'], swaps)).toEqual([{ allergen: 'sesame', ingredients: ['sesame seed'] }])
  })
})

describe('toAllergens', () => {
  it('keeps listed allergens in list order and drops the rest', () => {
    expect(toAllergens(['sesame', 'nuts', 'egg', 3])).toEqual(['egg', 'sesame'])
    expect(toAllergens('egg')).toEqual([])
  })
})

describe('containsText', () => {
  it('lists the allergens', () => {
    expect(containsText(['egg'])).toBe('Contains egg')
    expect(containsText(['egg', 'milk'])).toBe('Contains egg and milk')
    expect(containsText(['egg', 'milk', 'sesame'])).toBe('Contains egg, milk and sesame')
  })
})
