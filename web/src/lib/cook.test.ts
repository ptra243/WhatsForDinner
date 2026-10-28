import { describe, expect, it } from 'vitest'
import { clock, doneTimer, pauseTimer, remaining, startTimer, stepUses } from './cook'

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
