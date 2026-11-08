import { describe, expect, it } from 'vitest'
import {
  byName,
  emptyIngredient,
  emptyStep,
  fieldOfError,
  formFromRecipe,
  isNew,
  moveItem,
  parseQty,
  problems,
  toSaveRecipe,
  type RecipeFormState,
} from './recipeForm'
import type { Recipe } from './recipes'

const known = byName([
  { name: 'onion', section: 'fruit and veg', allergens: [] },
  { name: 'red lentil', section: 'pantry', allergens: [] },
])

const dal: Recipe = {
  id: 'dal',
  name: 'Red lentil dal',
  course: 'main',
  serves: 4,
  activeMins: 20,
  totalMins: 50,
  provides: ['protein', 'veg'],
  spice: 1,
  tags: ['vegetarian', 'weeknight'],
  source: 'Grandma',
  rating: 4,
  notes: 'Double the ginger.',
  isExample: true,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [
    { id: 'i1', name: 'red lentil', qty: 300, unit: 'g', note: '' },
    { id: 'i2', name: 'onion', qty: 1, unit: 'each', note: 'diced' },
  ],
  steps: [
    { id: 's1', text: 'Fry the onion.', timerMins: null, uses: ['i2'] },
    { id: 's2', text: 'Simmer.', timerMins: 25, uses: ['i1', 'i2'] },
  ],
}

const filled = (patch: Partial<RecipeFormState> = {}): RecipeFormState => ({ ...formFromRecipe(dal), ...patch })

describe('formFromRecipe', () => {
  it('starts a new recipe with one empty ingredient and step', () => {
    const f = formFromRecipe()
    expect(f).toMatchObject({ name: '', course: 'main', serves: '4', spice: null, tags: '' })
    expect(f.id).toBeUndefined()
    expect(f.ingredients).toHaveLength(1)
    expect(f.steps).toHaveLength(1)
  })

  it('fills every field from a recipe and keeps the row ids', () => {
    const f = formFromRecipe(dal)
    expect(f).toMatchObject({
      id: 'dal',
      name: 'Red lentil dal',
      serves: '4',
      activeMins: '20',
      totalMins: '50',
      provides: ['protein', 'veg'],
      spice: 1,
      tags: 'vegetarian, weeknight',
      source: 'Grandma',
      notes: 'Double the ginger.',
    })
    expect(f.ingredients.map((i) => [i.id, i.name, i.qty, i.unit, i.note])).toEqual([
      ['i1', 'red lentil', '300', 'g', ''],
      ['i2', 'onion', '1', 'each', 'diced'],
    ])
    expect(f.steps.map((s) => [s.id, s.text, s.timer])).toEqual([
      ['s1', 'Fry the onion.', ''],
      ['s2', 'Simmer.', '25'],
    ])
    const [lentil, onion] = f.ingredients
    expect(f.steps.map((s) => s.uses)).toEqual([[onion.key], [lentil.key, onion.key]])
  })
})

describe('parseQty', () => {
  it('reads whole numbers, decimals and fractions', () => {
    expect(parseQty('2')).toBe(2)
    expect(parseQty('1.5')).toBe(1.5)
    expect(parseQty('.5')).toBe(0.5)
    expect(parseQty('1/2')).toBe(0.5)
    expect(parseQty('1 1/2')).toBe(1.5)
  })
  it('treats blank as to taste and anything else as unreadable', () => {
    expect(parseQty('  ')).toBeNull()
    expect(parseQty('a few')).toBeUndefined()
    expect(parseQty('1/0')).toBeUndefined()
    expect(parseQty('-1')).toBeUndefined()
  })
})

describe('problems', () => {
  it('passes a complete recipe', () => {
    expect(problems(filled(), known, [{ id: 'dal', name: 'Red lentil dal' }])).toEqual({})
  })

  it('needs a name, serves above 0 and whole minutes', () => {
    expect(problems(filled({ name: ' ', serves: '0', activeMins: '1.5', totalMins: 'soon' }), known)).toEqual({
      name: 'Give the recipe a name.',
      serves: 'How many it serves, more than 0.',
      activeMins: 'Whole minutes.',
      totalMins: 'Whole minutes.',
    })
  })

  it('refuses a total shorter than hands-on', () => {
    expect(problems(filled({ activeMins: '30', totalMins: '20' }), known).totalMins).toBe('Total can’t be less than hands-on.')
    expect(problems(filled({ activeMins: '30', totalMins: '' }), known)).toEqual({})
  })

  it('refuses another recipe’s name, whatever the case', () => {
    const others = [{ id: 'other', name: 'Red Lentil Dal ' }]
    expect(problems(filled(), known, others).name).toBe('There is already a recipe with this name.')
    expect(problems(filled({ id: undefined }), known, [{ id: 'dal', name: 'red lentil dal' }]).name).toBeDefined()
  })

  it('asks a new ingredient for its section, and checks amounts', () => {
    const f = filled()
    const leek = { ...emptyIngredient(), name: 'Leek', qty: 'two' }
    const nameless = { ...emptyIngredient(), qty: '2' }
    const p = problems({ ...f, ingredients: [...f.ingredients, leek, nameless, emptyIngredient()] }, known)
    expect(p).toEqual({
      [`ing:${leek.key}:qty`]: 'A number, like 2, 1.5 or 1/2.',
      [`ing:${leek.key}:section`]: 'New ingredient: pick its section.',
      [`ing:${nameless.key}:name`]: 'Which ingredient?',
    })
    expect(problems({ ...f, ingredients: [{ ...leek, qty: '1', section: 'fruit and veg' }] }, known)).toEqual({})
  })

  it('checks steps that are not blank', () => {
    const textless = { ...emptyStep(), timer: '5' }
    const badTimer = { ...emptyStep(), text: 'Rest.', timer: '0' }
    expect(problems({ ...filled(), steps: [textless, badTimer, emptyStep()] }, known)).toEqual({
      [`step:${textless.key}:text`]: 'What happens in this step?',
      [`step:${badTimer.key}:timer`]: 'Whole minutes, more than 0.',
    })
  })
})

describe('isNew', () => {
  it('matches the list as the database names ingredients', () => {
    expect(isNew({ ...emptyIngredient(), name: '  Red  Lentil ' }, known)).toBe(false)
    expect(isNew({ ...emptyIngredient(), name: 'leek' }, known)).toBe(true)
    expect(isNew(emptyIngredient(), known)).toBe(false)
  })
})

describe('toSaveRecipe', () => {
  it('sends the edit with row ids, in order, and drops blank rows', () => {
    const f = filled({ tags: ' Vegetarian, weeknight,, vegetarian ', provides: ['veg', 'protein'] })
    const leek = { ...emptyIngredient(), name: ' Leek ', qty: '1/2', unit: 'bunch' as const, section: 'fruit and veg' as const, allergens: [] }
    const moved = moveItem([emptyIngredient(), ...f.ingredients, leek], 2, 0)
    const serve = { ...emptyStep(), text: 'Serve.', uses: [leek.key] }
    expect(toSaveRecipe({ ...f, ingredients: moved, steps: [...f.steps, serve, emptyStep()] }, known)).toEqual({
      id: 'dal',
      name: 'Red lentil dal',
      course: 'main',
      serves: 4,
      active_mins: 20,
      total_mins: 50,
      provides: ['protein', 'veg'],
      spice: 1,
      tags: ['vegetarian', 'weeknight'],
      source: 'Grandma',
      notes: 'Double the ginger.',
      ingredients: [
        { id: 'i2', name: 'onion', qty: 1, unit: 'each', note: 'diced' },
        { id: 'i1', name: 'red lentil', qty: 300, unit: 'g', note: '' },
        { name: 'leek', qty: 0.5, unit: 'bunch', note: '', section: 'fruit and veg', allergens: [] },
      ],
      steps: [
        { id: 's1', text: 'Fry the onion.', timer_mins: null, uses: [0], optional: false, extra_mins: null, why: '' },
        { id: 's2', text: 'Simmer.', timer_mins: 25, uses: [0, 1], optional: false, extra_mins: null, why: '' },
        { text: 'Serve.', timer_mins: null, uses: [2], optional: false, extra_mins: null, why: '' },
      ],
    })
  })

  it('sends the ingredients a step uses by position, leaving out removed and blank rows', () => {
    const f = filled()
    const [lentil, onion] = f.ingredients
    const blank = emptyIngredient()
    const steps = [{ ...f.steps[1], uses: [lentil.key, blank.key, onion.key] }]
    expect(toSaveRecipe({ ...f, ingredients: [blank, onion], steps }, known).steps).toEqual([
      { id: 's2', text: 'Simmer.', timer_mins: 25, uses: [0], optional: false, extra_mins: null, why: '' },
    ])
  })

  it('sends an optional step with its minutes and why, and only once it has minutes', () => {
    const f = filled()
    const step = { ...f.steps[1], optional: true, extra: '', why: ' silkier ' }
    expect(problems({ ...f, steps: [step] }, known)[`step:${step.key}:extra`]).toBe('How many minutes it adds, more than 0.')
    const ready = { ...step, extra: '15' }
    expect(problems({ ...f, steps: [ready] }, known)).toEqual({})
    expect(toSaveRecipe({ ...f, steps: [ready] }, known).steps[0]).toMatchObject({ optional: true, extra_mins: 15, why: 'silkier' })
    // Unticking it keeps nothing of the extra.
    expect(toSaveRecipe({ ...f, steps: [{ ...ready, optional: false }] }, known).steps[0]).toMatchObject({
      optional: false,
      extra_mins: null,
      why: '',
    })
  })

  it('loads an optional step into the form', () => {
    const f = formFromRecipe({
      ...dal,
      steps: [{ id: 's1', text: 'Velvet the beef.', timerMins: null, optional: true, extraMins: 15, why: 'silkier' }],
    })
    expect(f.steps[0]).toMatchObject({ optional: true, extra: '15', why: 'silkier' })
  })

  it('sends a new recipe without an id and blank minutes as null', () => {
    const f = { ...formFromRecipe(), name: 'Toast', serves: '2' }
    expect(toSaveRecipe(f, known)).toMatchObject({ name: 'Toast', serves: 2, active_mins: null, total_mins: null, ingredients: [], steps: [] })
    expect(toSaveRecipe(f, known)).not.toHaveProperty('id')
  })
})

describe('fieldOfError', () => {
  it('puts the database’s refusals next to their field', () => {
    expect(fieldOfError('A recipe called Dal already exists')).toBe('name')
    expect(fieldOfError('Total minutes can’t be less than hands-on minutes')).toBe('totalMins')
    expect(fieldOfError('save rice: "cup" is not a unit')).toBeUndefined()
  })
})

describe('moveItem', () => {
  it('moves up and down within the list', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c'])
  })
})
