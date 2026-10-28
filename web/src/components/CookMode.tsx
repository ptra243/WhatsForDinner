import { useEffect, useRef, useState } from 'react'
import {
  clock,
  doneTimer,
  makeChime,
  pauseTimer,
  remaining,
  startTimer,
  stepUses,
  useWakeLock,
  type Timer,
} from '../lib/cook'
import { scaledQty } from '../lib/format'
import { markCooked, updateRecipe, type Recipe } from '../lib/recipes'

type Props = {
  householdId: string
  recipe: Recipe
  servings: number
  onChange: (recipe: Recipe) => void
  onExit: () => void
  onDone: (message: string) => void
}

/**
 * Full-screen cooking, one step at a time, then a finish screen to rate, note and mark as cooked.
 * Step timers keep running when you move to another step; the screen stays awake while it is open.
 */
export function CookMode({ householdId, recipe: r, servings, onChange, onExit, onDone }: Props) {
  const steps = r.steps.length ? r.steps : [{ text: 'No steps saved for this recipe.', timerMins: null }]
  const [step, setStep] = useState(0)
  const [finished, setFinished] = useState(false)
  const [timers, setTimers] = useState<Record<number, Timer>>({})
  const [now, setNow] = useState(() => Date.now())
  const [notes, setNotes] = useState(r.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [chime] = useState(makeChime)
  const endings = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const panel = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const awake = useWakeLock()

  const running = Object.values(timers).some((t) => t.endAt != null)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    const ends = endings.current
    return () => {
      ends.forEach(clearTimeout)
      chime.close()
    }
  }, [chime])

  useEffect(() => {
    back.current?.focus()
    panel.current?.scrollTo?.(0, 0)
  }, [step, finished])

  const stopEnding = (ix: number) => {
    clearTimeout(endings.current.get(ix))
    endings.current.delete(ix)
  }

  const start = (ix: number) => {
    chime.prime()
    const t = startTimer(timers[ix], (steps[ix].timerMins ?? 0) * 60, Date.now())
    stopEnding(ix)
    endings.current.set(
      ix,
      setTimeout(() => {
        endings.current.delete(ix)
        chime.play()
        setTimers((ts) => ({ ...ts, [ix]: doneTimer }))
      }, t.left * 1000),
    )
    setNow(Date.now())
    setTimers({ ...timers, [ix]: t })
  }

  const pause = (ix: number) => {
    stopEnding(ix)
    setTimers({ ...timers, [ix]: pauseTimer(timers[ix], Date.now()) })
  }

  const reset = (ix: number) => {
    stopEnding(ix)
    const next = { ...timers }
    delete next[ix]
    setTimers(next)
  }

  const run = async (work: () => Promise<void>) => {
    setError(undefined)
    setBusy(true)
    try {
      await work()
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e))
    }
    setBusy(false)
  }

  const rate = (n: number) => {
    const rating = r.rating === n ? null : n
    run(async () => {
      await updateRecipe(r.id, { rating })
      onChange({ ...r, rating })
    })
  }

  const finish = () =>
    run(async () => {
      if (notes !== r.notes) {
        await updateRecipe(r.id, { notes })
        onChange({ ...r, notes })
      }
      const ticked = await markCooked(householdId, r.id)
      onDone(ticked ? 'Marked as cooked. Tonight is ticked off.' : 'Marked as cooked.')
    })

  const elsewhere = Object.entries(timers)
    .map(([ix, t]) => ({ ix: Number(ix), t }))
    .filter(({ ix }) => ix !== step)

  if (finished) {
    return (
      <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-label="Finished cooking">
        <div className="wrap">
          <button ref={back} className="back" type="button" onClick={() => setFinished(false)}>
            ‹ Steps
          </button>
          <div className="stack tight">
            <h1>How was it?</h1>
            <span className="muted">{r.name}</span>
          </div>
          <div className="rate">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={(r.rating ?? 0) >= n ? 'on' : undefined}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={r.rating === n}
                onClick={() => rate(n)}
              >
                ★
              </button>
            ))}
          </div>
          <label className="small strong" htmlFor="cook-notes">
            Note for next time
          </label>
          <textarea id="cook-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && (
            <p className="small warn flat" role="alert">
              {error}
            </p>
          )}
          <button className="btn" type="button" disabled={busy} onClick={finish}>
            Mark as cooked
          </button>
        </div>
      </div>
    )
  }

  const st = steps[step]
  const uses = stepUses(st.text, r.ingredients)
  const last = step >= steps.length - 1

  return (
    <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-label={`Cooking ${r.name}`}>
      <div className="wrap">
        <div className="row spread">
          <button ref={back} className="back" type="button" onClick={onExit}>
            ‹ Recipe
          </button>
          <span className="small muted">
            Step {step + 1} of {steps.length}
          </span>
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
        >
          <span style={{ width: `${Math.round(((step + 1) / steps.length) * 100)}%` }} />
        </div>
        <p className="bigstep">{st.text}</p>
        {uses.length > 0 && (
          <section className="stack tight" aria-label="This step uses">
            <span className="label">This step uses</span>
            <div>
              {uses.map((i, ix) => (
                <div key={ix} className="ing">
                  <span>
                    {i.name}
                    {i.note && <small> {i.note}</small>}
                  </span>
                  <span>{scaledQty(i.qty, i.unit, servings, r.serves)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {st.timerMins ? (
          <StepTimer
            timer={timers[step]}
            full={st.timerMins * 60}
            now={now}
            onStart={() => start(step)}
            onPause={() => pause(step)}
            onReset={() => reset(step)}
          />
        ) : null}
        {elsewhere.map(({ ix, t }) => (
          <button key={ix} className="btn quiet other-timer" type="button" onClick={() => setStep(ix)}>
            Step {ix + 1} timer: {t.done ? 'time’s up' : `${clock(remaining(t, now))}${t.endAt == null ? ' paused' : ''}`}
          </button>
        ))}
        {awake && <span className="small muted">Screen stays awake while you cook.</span>}
        <div className="row">
          <button className="btn ghost grow" type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </button>
          <button
            className="btn grow"
            type="button"
            onClick={() => (last ? setFinished(true) : setStep(step + 1))}
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StepTimer({
  timer: t,
  full,
  now,
  onStart,
  onPause,
  onReset,
}: {
  timer: Timer | undefined
  full: number
  now: number
  onStart: () => void
  onPause: () => void
  onReset: () => void
}) {
  const left = t ? remaining(t, now) : full
  return (
    <section className={`timer${t?.done ? ' up' : ''}`} aria-label="Timer">
      <span className="tm" role="timer" aria-live={t?.done ? 'assertive' : 'off'}>
        {t?.done ? 'Time’s up' : clock(left)}
      </span>
      <div className="row">
        {t?.endAt != null ? (
          <button className="btn ghost" type="button" onClick={onPause}>
            Pause
          </button>
        ) : (
          <button className="btn" type="button" onClick={onStart}>
            {t && !t.done ? 'Resume' : 'Start'}
          </button>
        )}
        {t && (
          <button className="btn quiet" type="button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </section>
  )
}
