import { describe, expect, it } from 'vitest'
import { GRAMS_PER_TBSP, roundGrams, scaledAmount, spoonGrams } from './spoons'

describe('spoonGrams', () => {
  it('converts tablespoons of an ingredient in the table', () => {
    expect(spoonGrams('butter', 2, 'tbsp')).toBe(40)
    expect(spoonGrams('honey', 1, 'tbsp')).toBe(30)
    expect(spoonGrams('tomato paste', 2, 'tbsp')).toBe(45)
  })

  it('counts a teaspoon as a quarter of the 20 ml tablespoon', () => {
    expect(spoonGrams('butter', 4, 'tsp')).toBe(spoonGrams('butter', 1, 'tbsp'))
    expect(spoonGrams('butter', 1, 'tsp')).toBe(5)
    expect(spoonGrams('honey', 1, 'tsp')).toBe(7)
  })

  it('finds the ingredient by its slug', () => {
    expect(spoonGrams('Peanut Butter', 1, 'tbsp')).toBe(20)
    expect(spoonGrams('self-raising flour', 2, 'tbsp')).toBe(25)
  })

  it('covers the ingredients the issue names', () => {
    for (const slug of [
      'butter',
      'ghee',
      'plain-flour',
      'self-raising-flour',
      'cornflour',
      'white-sugar',
      'brown-sugar',
      'caster-sugar',
      'honey',
      'peanut-butter',
      'tomato-paste',
    ])
      expect(GRAMS_PER_TBSP[slug], slug).toBeGreaterThan(0)
  })

  it('gives nothing for an ingredient not in the table', () => {
    expect(spoonGrams('soy sauce', 2, 'tbsp')).toBeNull()
    expect(spoonGrams('salt', 1, 'tsp')).toBeNull()
  })

  it('gives nothing for other units, no amount, or too little to weigh', () => {
    expect(spoonGrams('butter', 50, 'g')).toBeNull()
    expect(spoonGrams('butter', 1, 'each')).toBeNull()
    expect(spoonGrams('butter', null, 'tbsp')).toBeNull()
    expect(spoonGrams('cornflour', 0.125, 'tsp')).toBeNull()
  })
})

describe('roundGrams', () => {
  it('rounds to the nearest 5 from 10 up', () => {
    expect(roundGrams(12)).toBe(10)
    expect(roundGrams(13)).toBe(15)
    expect(roundGrams(36)).toBe(35)
    expect(roundGrams(38)).toBe(40)
    expect(roundGrams(10)).toBe(10)
  })

  it('rounds to the nearest 1 under 10', () => {
    expect(roundGrams(7)).toBe(7)
    expect(roundGrams(4.5)).toBe(5)
    expect(roundGrams(2.4)).toBe(2)
    expect(roundGrams(9.6)).toBe(10)
  })
})

describe('scaledAmount', () => {
  const ing = (name: string, qty: number | null, unit: string) => ({ name, qty, unit })

  it('shows grams beside a spoon measure of something you would weigh', () => {
    expect(scaledAmount(ing('butter', 2, 'tbsp'), 4, 4)).toBe('2 tbsp ≈ 40 g')
    expect(scaledAmount(ing('cornflour', 1, 'tsp'), 4, 4)).toBe('1 tsp ≈ 3 g')
  })

  it('works the grams out after scaling to the servings', () => {
    expect(scaledAmount(ing('butter', 2, 'tbsp'), 6, 4)).toBe('3 tbsp ≈ 60 g')
    expect(scaledAmount(ing('butter', 2, 'tbsp'), 2, 4)).toBe('1 tbsp ≈ 20 g')
    expect(scaledAmount(ing('ghee', 1, 'tbsp'), 3, 4)).toBe('0.75 tbsp ≈ 15 g')
  })

  it('leaves other ingredients and units as they were', () => {
    expect(scaledAmount(ing('soy sauce', 2, 'tbsp'), 4, 4)).toBe('2 tbsp')
    expect(scaledAmount(ing('butter', 50, 'g'), 8, 4)).toBe('100 g')
    expect(scaledAmount(ing('butter', null, 'tbsp'), 4, 4)).toBe('as needed')
  })
})
