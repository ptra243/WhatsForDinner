import { describe, expect, it } from 'vitest'
import { fmtQty, mins, scaledQty, toBase } from './format'

describe('mins', () => {
  it('shows minutes, hours and none', () => {
    expect(mins(null)).toBe('')
    expect(mins(0)).toBe('')
    expect(mins(45)).toBe('45 min')
    expect(mins(60)).toBe('1 h')
    expect(mins(90)).toBe('1 h 30')
  })
})

describe('quantities', () => {
  it('normalises kg and l', () => {
    expect(toBase(1.5, 'kg')).toEqual({ qty: 1500, unit: 'g' })
    expect(toBase(0.5, 'l')).toEqual({ qty: 500, unit: 'ml' })
    expect(toBase(2, 'tin')).toEqual({ qty: 2, unit: 'tin' })
    expect(toBase(null, 'g')).toEqual({ qty: null, unit: 'g' })
  })

  it('rounds to quarters below 20 and whole numbers above', () => {
    expect(fmtQty(1.3, 'tbsp')).toBe('1.25 tbsp')
    expect(fmtQty(0.33, 'tsp')).toBe('0.25 tsp')
    expect(fmtQty(266.67, 'g')).toBe('267 g')
  })

  it('shows 1000 g and up in kg, 1000 ml and up in l', () => {
    expect(fmtQty(1000, 'g')).toBe('1 kg')
    expect(fmtQty(1250, 'ml')).toBe('1.25 l')
    expect(fmtQty(null, 'g')).toBe('as needed')
  })

  it('scales by servings over serves', () => {
    expect(scaledQty(400, 'g', 6, 4)).toBe('600 g')
    expect(scaledQty(0.5, 'kg', 8, 4)).toBe('1 kg')
    expect(scaledQty(1, 'each', 2, 4)).toBe('0.5 each')
    expect(scaledQty(null, 'tsp', 2, 4)).toBe('as needed')
  })
})
