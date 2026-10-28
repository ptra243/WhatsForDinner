// Cook mode helpers: which ingredients a step uses, step timers, the screen wake lock and the timer sound.
import { useEffect, useState } from 'react'
import type { RecipeIngredient } from './recipes'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The ingredients a step mentions, matched on the last word of the name as a whole word,
 * singular or plural ("red lentil" in "Simmer the lentils", but not "oil" in "boil").
 */
export function stepUses(text: string, ingredients: RecipeIngredient[]): RecipeIngredient[] {
  return ingredients.filter((i) => {
    const word = i.name.trim().toLowerCase().split(/\s+/).pop()
    return !!word && new RegExp(`\\b${escape(word)}(e?s)?\\b`, 'i').test(text)
  })
}

/** Seconds as "4:05". */
export const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

/** A step timer that has been started: running while `endAt` is set, otherwise paused (or done) with `left` seconds. */
export type Timer = { endAt: number | null; left: number; done: boolean }

export const remaining = (t: Timer, now: number) =>
  t.endAt == null ? t.left : Math.max(0, Math.ceil((t.endAt - now) / 1000))

export const startTimer = (t: Timer | undefined, fullSecs: number, now: number): Timer => {
  const left = t && !t.done ? t.left : fullSecs
  return { endAt: now + left * 1000, left, done: false }
}

export const pauseTimer = (t: Timer, now: number): Timer => ({ endAt: null, left: remaining(t, now), done: false })

export const doneTimer: Timer = { endAt: null, left: 0, done: true }

/** Keeps the screen awake while mounted, where the browser allows; asks again when the page is shown again. */
export function useWakeLock(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let live = true
    let lock: WakeLockSentinel | null = null
    let asking = false
    const request = async () => {
      if (lock || asking || document.visibilityState !== 'visible') return
      asking = true
      try {
        const l = await navigator.wakeLock.request('screen')
        if (!live) {
          void l.release()
          return
        }
        lock = l
        setHeld(true)
        l.addEventListener('release', () => {
          if (lock !== l) return
          lock = null
          if (live) setHeld(false)
        })
      } catch {
        // Refused (battery saver, not allowed): cook without it.
      } finally {
        asking = false
      }
    }
    const onVisible = () => void request()
    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
      lock = null
    }
  }, [])
  return held
}

/**
 * The timer sound. Phones only let a page play sound after a tap, so `prime` runs on the
 * Start button and `play` later rings three beeps (and buzzes where the phone can).
 */
export function makeChime() {
  let ctx: AudioContext | undefined
  return {
    prime() {
      try {
        ctx ??= new AudioContext()
        if (ctx.state === 'suspended') void ctx.resume()
      } catch {
        // No Web Audio.
      }
    },
    play() {
      try {
        navigator.vibrate?.([300, 150, 300, 150, 300])
      } catch {
        // No vibration.
      }
      if (!ctx) return
      for (const at of [0, 0.4, 0.8]) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.value = 880
        g.gain.value = 0.2
        o.connect(g)
        g.connect(ctx.destination)
        o.start(ctx.currentTime + at)
        o.stop(ctx.currentTime + at + 0.25)
      }
    },
    close() {
      void ctx?.close()
      ctx = undefined
    },
  }
}
