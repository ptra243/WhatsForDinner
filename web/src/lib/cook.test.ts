import { describe, expect, it } from 'vitest'
import {
  canRescale,
  catchUp,
  clock,
  cookAmount,
  doneTimer,
  isRescaled,
  pauseTimer,
  prepList,
  remaining,
  rescaleFactor,
  rescaleLabel,
  startTimer,
  type Rescale,
  stepIngredients,
  stepUses,
  tipText,
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

describe('tipText', () => {
  it('leads a tip in with "If it looks wrong:" unless it is already written as "If …"', () => {
    expect(tipText('Soaking up the oil is normal; keep going.')).toBe('If it looks wrong: Soaking up the oil is normal; keep going.')
    expect(tipText(' If they are still crunchy, give them 5 more minutes. ')).toBe('If they are still crunchy, give them 5 more minutes.')
    expect(tipText('Iffy colour is fine.')).toBe('If it looks wrong: Iffy colour is fine.')
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

describe('rescaling mid-cook', () => {
  const butter = { id: 'b', name: 'butter', qty: 2, unit: 'tbsp', note: '' }
  const chicken = { id: 'k', name: 'chicken thigh', qty: 500, unit: 'g', note: '' }
  const pasta = { id: 'p', name: 'pasta', qty: 350, unit: 'g', note: '' }
  const cream = { id: 'c', name: 'cream', qty: 200, unit: 'ml', note: '' }
  const salt = { id: 's', name: 'salt', qty: 0.1, unit: 'tsp', note: '' }
  const parmesan = { id: 'm', name: 'parmesan', qty: null, unit: 'g', note: '' }
  const ings = [butter, chicken, pasta, cream, salt, parmesan]
  const step = (text: string, uses?: string[]) => ({ text, timerMins: null, uses })
  const steps = [
    step('Brown the chicken in the butter.', ['k', 'b', 's']),
    step('Boil the pasta.', ['p']),
    step('Stir the cream through the chicken.', ['c', 'k']),
    step('Serve with parmesan.', ['m']),
  ]
  const unlinked = steps.map((s) => step(s.text))
  /** "I cooked the whole 525 g of pasta", said on step 2. */
  const more: Rescale = { ingredientId: 'p', used: 525, step: 1 }
  const less: Rescale = { ingredientId: 'p', used: 175, step: 1 }

  it('offers it for ingredients with a quantity, only when the steps have ingredient links', () => {
    expect(canRescale(steps, pasta)).toBe(true)
    expect(canRescale(steps, parmesan)).toBe(false)
    expect(canRescale(steps, { ...pasta, id: undefined })).toBe(false)
    expect(canRescale(unlinked, pasta)).toBe(false)
  })

  it('works out the factor as used ÷ planned for the servings being cooked', () => {
    expect(rescaleFactor(more, steps, ings, 4, 4)).toBe(1.5)
    expect(rescaleFactor(less, steps, ings, 4, 4)).toBe(0.5)
    // Cooking for 8, the recipe plans 700 g.
    expect(rescaleFactor(more, steps, ings, 8, 4)).toBe(0.75)
    expect(rescaleFactor({ ...more, used: 500 }, steps, ings, 4, 4)).toBeCloseTo(500 / 350)
  })

  it('is 1 with no rescale, a method with no links, or an ingredient that is gone', () => {
    expect(rescaleFactor(null, steps, ings, 4, 4)).toBe(1)
    expect(rescaleFactor(more, unlinked, ings, 4, 4)).toBe(1)
    expect(rescaleFactor({ ...more, ingredientId: 'gone' }, steps, ings, 4, 4)).toBe(1)
    expect(rescaleFactor({ ...more, ingredientId: 'm' }, steps, ings, 4, 4)).toBe(1)
    expect(rescaleFactor({ ...more, used: 0 }, steps, ings, 4, 4)).toBe(1)
  })

  it('shows amounts multiplied by the factor, with what they were', () => {
    expect(cookAmount(cream, 4, 4, 1.5)).toEqual({ text: '300 ml', was: '200 ml' })
    expect(cookAmount(cream, 4, 4, 500 / 350)).toEqual({ text: '286 ml', was: '200 ml' })
    expect(cookAmount(pasta, 4, 4, 1.5)).toEqual({ text: '525 g', was: '350 g' })
    expect(cookAmount(chicken, 8, 4, 1.5)).toEqual({ text: '1.5 kg', was: '1 kg' })
    expect(cookAmount(cream, 4, 4)).toEqual({ text: '200 ml' })
    expect(cookAmount(parmesan, 4, 4, 1.5)).toEqual({ text: 'as needed' })
    // Too small a change to read differently.
    expect(cookAmount(cream, 4, 4, 1.001)).toEqual({ text: '200 ml' })
  })

  it('keeps the grams beside a spoon measure in step with the rescaled amount', () => {
    expect(cookAmount(butter, 4, 4, 1.5)).toEqual({ text: '3 tbsp ≈ 60 g', was: '2 tbsp ≈ 40 g' })
  })

  it('rescales the step it was said on and the steps still to come, not the ones before', () => {
    expect([0, 1, 2, 3].map((s) => isRescaled(more, s))).toEqual([false, true, true, true])
    expect(isRescaled(more, null)).toBe(true)
    expect(isRescaled({ ...more, step: -1 }, 0)).toBe(true)
    expect(isRescaled(null, 2)).toBe(false)
  })

  it('names what the cook is scaled to', () => {
    expect(rescaleLabel(more, ings)).toBe('525 g pasta')
    expect(rescaleLabel({ ingredientId: 'k', used: 1.5, step: 0 }, [{ ...chicken, qty: 1, unit: 'kg' }])).toBe('1.5 kg chicken thigh')
    expect(rescaleLabel({ ...more, ingredientId: 'gone' }, ings)).toBeUndefined()
  })

  it('lists what earlier steps already used, once, with the extra each needs', () => {
    // Chicken is used again later but listed once; the salt's extra is too small to show.
    expect(catchUp(steps, ings, more, 4, 4)).toEqual([
      { ingredient: butter, amount: '1 tbsp ≈ 20 g' },
      { ingredient: chicken, amount: '250 g' },
    ])
    expect(catchUp(steps, ings, { ...more, step: 3 }, 4, 4).map((c) => `${c.ingredient.name} ${c.amount}`)).toEqual([
      'butter 1 tbsp ≈ 20 g',
      'chicken thigh 250 g',
      'cream 100 ml',
    ])
  })

  it('has no catch-up list when scaling down, on the first step, the prep list, or with no rescale', () => {
    expect(catchUp(steps, ings, less, 4, 4)).toEqual([])
    expect(catchUp(steps, ings, { ...more, step: 0 }, 4, 4)).toEqual([])
    expect(catchUp(steps, ings, { ...more, step: -1 }, 4, 4)).toEqual([])
    expect(catchUp(steps, ings, null, 4, 4)).toEqual([])
    expect(catchUp(unlinked, ings, more, 4, 4)).toEqual([])
  })
})
