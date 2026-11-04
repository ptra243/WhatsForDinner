import { describe, expect, it } from 'vitest'
import {
  clock,
  doneTimer,
  pauseTimer,
  prepList,
  remaining,
  startTimer,
  stepIngredients,
  stepUses,
  unusedIngredients,
} from './cook'

const ing = (name: string) => ({ name, qty: 1, unit: 'each', note: '' })

describe('stepUses', () => {
  const ings = [ing('red lentil'), ing('onion'), ing('olive oil'), ing('crushed tomato'), ing('salt')]
  const uses = (text: string) => stepUses(text, ings).map((i) => i.name)

  it('matches the last word of the name, singular or plural', () => {
    expect(uses('Simmer the lentils with the onion.')).toEqual(['red lentil', 'onion'])
    expect(uses('Add the TOMATOES and season with salt.')).toEqual(['crushed tomato', 'salt'])
  })

  it('matches whole words only', () => {
    expect(uses('Bring the water to the boil.')).toEqual([])
    expect(uses('Warm the oil, then add the onions.')).toEqual(['onion', 'olive oil'])
  })
})

describe('linked steps', () => {
  const butter = { id: 'b', name: 'butter', qty: 20, unit: 'g', note: '' }
  const carrot = { id: 'c', name: 'carrot', qty: 2, unit: 'each', note: '' }
  const celery = { id: 'y', name: 'celery', qty: 2, unit: 'each', note: '' }
  const stock = { id: 's', name: 'chicken stock', qty: 500, unit: 'ml', note: '' }
  const ings = [butter, carrot, celery, stock]
  const step = (text: string, uses?: string[]) => ({ text, timerMins: null, uses })

  it('uses each step’s saved ingredients, in recipe order, over what its text says', () => {
    const steps = [step('Soften the veg.', ['y', 'c']), step('Add the stock and butter.', []), step('Simmer.', ['s'])]
    expect(stepIngredients(steps, ings)).toEqual([[carrot, celery], [], [stock]])
  })

  it('guesses from the text when no step has saved ingredients', () => {
    const steps = [step('Melt the butter.'), step('Add the stock.', [])]
    expect(stepIngredients(steps, ings)).toEqual([[butter], [stock]])
  })

  it('flags ingredients no step used, only when the steps are linked', () => {
    const linked = [step('Soften the veg.', ['c', 'y']), step('Simmer.', ['s'])]
    expect(unusedIngredients(linked, ings)).toEqual([butter])
    expect(unusedIngredients([step('Soften the veg.'), step('Simmer.')], ings)).toEqual([])
    expect(unusedIngredients([...linked, step('Finish with butter.', ['b'])], ings)).toEqual([])
  })

  it('groups the prep list by the step that first needs each ingredient, the rest last', () => {
    const steps = [step('Soften the veg.', ['c', 'y']), step('Season.', []), step('Add the stock and veg.', ['s', 'c'])]
    expect(prepList(steps, ings)).toEqual([
      { step: 0, ingredients: [carrot, celery] },
      { step: 2, ingredients: [stock] },
      { step: null, ingredients: [butter] },
    ])
    expect(prepList([step('Melt the butter.'), step('Pour in the stock.')], [butter, stock])).toEqual([
      { step: 0, ingredients: [butter] },
      { step: 1, ingredients: [stock] },
    ])
  })
})

describe('timers', () => {
  it('shows minutes and seconds', () => {
    expect(clock(25 * 60)).toBe('25:00')
    expect(clock(65)).toBe('1:05')
    expect(clock(0)).toBe('0:00')
  })

  it('starts, counts down, pauses and resumes', () => {
    const t = startTimer(undefined, 300, 0)
    expect(remaining(t, 0)).toBe(300)
    expect(remaining(t, 60_500)).toBe(240)
    const p = pauseTimer(t, 61_000)
    expect(p).toEqual({ endAt: null, left: 239, done: false })
    expect(remaining(p, 999_999)).toBe(239)
    const r = startTimer(p, 300, 100_000)
    expect(r).toEqual({ endAt: 339_000, left: 239, done: false })
    expect(remaining(r, 400_000)).toBe(0)
  })

  it('starts a finished timer from the full time again', () => {
    expect(startTimer(doneTimer, 300, 0)).toEqual({ endAt: 300_000, left: 300, done: false })
  })
})
