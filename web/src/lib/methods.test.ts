import { describe, expect, it } from 'vitest'
import { allMethods, hasEquipment, methodChoices, methodOf } from './methods'
import type { Recipe } from './recipes'

const RAGU = {
  id: 'ragu',
  activeMins: 25,
  totalMins: 180,
  steps: [{ text: 'Simmer for hours.', timerMins: 150 }],
  methods: [
    { id: 'pc', name: 'Pressure cooker', equipment: 'pressure cooker', activeMins: 25, totalMins: 80, steps: [{ text: 'Cook on high.', timerMins: 45 }] },
    { id: 'sc', name: 'Slow cooker', equipment: 'Slow Cooker', activeMins: 15, totalMins: 480, steps: [] },
    { id: 'oven', name: 'Oven', equipment: null, activeMins: 25, totalMins: 200, steps: [] },
  ],
} as Recipe

describe('methodOf', () => {
  it('is the recipe’s own times and steps without a method', () => {
    expect(methodOf(RAGU, null)).toMatchObject({ id: null, name: 'Usual way', activeMins: 25, totalMins: 180, steps: RAGU.steps })
    expect(methodOf(RAGU)).toMatchObject({ id: null })
  })

  it('is the chosen method', () => {
    expect(methodOf(RAGU, 'pc')).toMatchObject({ name: 'Pressure cooker', totalMins: 80, steps: [{ text: 'Cook on high.' }] })
  })

  it('falls back to the default when the method is no longer the recipe’s', () => {
    expect(methodOf(RAGU, 'gone').id).toBeNull()
    expect(methodOf({ ...RAGU, methods: undefined }, 'pc').id).toBeNull()
  })
})

describe('methodChoices', () => {
  it('offers the default and the methods the household has the equipment for', () => {
    expect(methodChoices(RAGU, ['pressure cooker']).map((m) => m.id)).toEqual([null, 'pc', 'oven'])
    expect(methodChoices(RAGU, [' slow cooker ']).map((m) => m.id)).toEqual([null, 'sc', 'oven'])
  })

  it('keeps the chosen method even without its equipment', () => {
    expect(methodChoices(RAGU, [], 'sc').map((m) => m.id)).toEqual([null, 'sc', 'oven'])
  })

  it('offers nothing when there is only the default', () => {
    const noOven = { ...RAGU, methods: RAGU.methods!.slice(0, 2) }
    expect(methodChoices(noOven, [])).toEqual([])
    expect(methodChoices({ ...RAGU, methods: [] }, ['pressure cooker'])).toEqual([])
  })

  it('lists every method for the recipe view, the default first', () => {
    expect(allMethods(RAGU).map((m) => m.id)).toEqual([null, 'pc', 'sc', 'oven'])
  })
})

describe('hasEquipment', () => {
  it('compares names without case or spaces around, and needs nothing for no equipment', () => {
    expect(hasEquipment('Pressure Cooker', ['pressure cooker '])).toBe(true)
    expect(hasEquipment('wok', ['pressure cooker'])).toBe(false)
    expect(hasEquipment(null, [])).toBe(true)
  })
})
