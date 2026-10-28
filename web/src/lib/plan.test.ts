import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, nightInfo, startBy, suggestSides, toSettings, type Night } from './plan'
import type { Recipe } from './recipes'

const recipe = (r: Partial<Recipe> & Pick<Recipe, 'id' | 'name'>): Recipe => ({
  course: 'main',
  serves: 4,
  activeMins: null,
  totalMins: null,
  provides: [],
  tags: [],
  source: '',
  rating: null,
  notes: '',
  isExample: false,
  createdAt: '2026-10-01T00:00:00Z',
  ingredients: [],
  steps: [],
  ...r,
})

const CURRY = recipe({ id: 'curry', name: 'Chicken curry', activeMins: 30, totalMins: 60, provides: ['protein', 'veg'] })
const RICE = recipe({ id: 'rice', name: 'Rice', course: 'side', activeMins: 5, totalMins: 25, provides: ['carb'], rating: 3 })
const SALAD = recipe({ id: 'salad', name: 'Salad', course: 'side', activeMins: 10, provides: ['veg'], rating: 5 })
const BREAD = recipe({ id: 'bread', name: 'Naan', course: 'side', provides: ['carb'], rating: 4 })
const RECIPES = new Map([CURRY, RICE, SALAD, BREAD].map((r) => [r.id, r]))

const night = (ids: [string, 'main' | 'side'][], extra: Partial<Night> = {}): Night => ({
  dishes: ids.map(([recipeId, role], position) => ({ id: `d${position}`, recipeId, role, servings: 4, position })),
  cooked: false,
  skipCheck: false,
  ...extra,
})

describe('a night', () => {
  it('adds up hands-on minutes and takes the longest total', () => {
    const i = nightInfo(night([['curry', 'main'], ['rice', 'side']]), 'mon', RECIPES, DEFAULT_SETTINGS)
    expect(i.main?.recipe?.name).toBe('Chicken curry')
    expect(i.sides.map((d) => d.recipe?.name)).toEqual(['Rice'])
    expect(i.active).toBe(35)
    expect(i.total).toBe(60)
    expect(i.gaps).toEqual([])
    expect(i.budget).toBe(45)
    expect(i.over).toBe(false)
  })

  it('flags hands-on minutes over the night’s budget', () => {
    const settings = { ...DEFAULT_SETTINGS, minutes: { ...DEFAULT_SETTINGS.minutes, tue: 30 } }
    const i = nightInfo(night([['curry', 'main'], ['rice', 'side']]), 'tue', RECIPES, settings)
    expect(i.over).toBe(true)
  })

  it('flags veg and carb gaps per the meal rule', () => {
    const curry = night([['curry', 'main']])
    expect(nightInfo(curry, 'mon', RECIPES, DEFAULT_SETTINGS).gaps).toEqual(['carb'])
    expect(nightInfo(night([['rice', 'main']]), 'mon', RECIPES, DEFAULT_SETTINGS).gaps).toEqual(['veg'])
    expect(nightInfo(curry, 'mon', RECIPES, { ...DEFAULT_SETTINGS, mealRule: 'veg' }).gaps).toEqual([])
    expect(nightInfo(night([['rice', 'main']]), 'mon', RECIPES, { ...DEFAULT_SETTINGS, mealRule: 'off' }).gaps).toEqual([])
    expect(nightInfo(night([['curry', 'main']], { skipCheck: true }), 'mon', RECIPES, DEFAULT_SETTINGS).gaps).toEqual([])
    expect(nightInfo(night([]), 'mon', RECIPES, DEFAULT_SETTINGS).gaps).toEqual([])
  })

  it('treats the first dish as the main when none is marked', () => {
    const i = nightInfo(night([['rice', 'side'], ['gone', 'side']]), 'mon', RECIPES, DEFAULT_SETTINGS)
    expect(i.main?.recipeId).toBe('rice')
    expect(i.sides[0].recipe).toBeUndefined()
  })
})

describe('start by', () => {
  it('counts back from dinner time', () => {
    expect(startBy(45, '18:30')).toBe('5:45 pm')
    expect(startBy(30, '12:15')).toBe('11:45 am')
    expect(startBy(90, '00:30')).toBe('11:00 pm')
    expect(startBy(0, '12:00')).toBe('12:00 pm')
  })
})

describe('side suggestions', () => {
  it('suggests sides that fill a gap, best rated first, not already on the night', () => {
    const recipes = [...RECIPES.values()]
    expect(suggestSides(recipes, ['carb'], []).map((r) => r.name)).toEqual(['Naan', 'Rice'])
    expect(suggestSides(recipes, ['veg', 'carb'], night([['salad', 'side']]).dishes).map((r) => r.name)).toEqual(['Naan', 'Rice'])
    expect(suggestSides(recipes, ['veg'], []).map((r) => r.name)).toEqual(['Salad'])
  })
})

describe('settings', () => {
  it('fills in the defaults', () => {
    expect(toSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(toSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = toSettings({ dinnerTime: '19:00', minutes: { mon: 20 }, mealRule: 'veg' })
    expect(s.dinnerTime).toBe('19:00')
    expect(s.minutes.mon).toBe(20)
    expect(s.minutes.sat).toBe(120)
    expect(s.mealRule).toBe('veg')
    expect(toSettings({ dinnerTime: 'soon', mealRule: 'lots' })).toEqual(DEFAULT_SETTINGS)
  })
})
