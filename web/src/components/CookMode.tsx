import { useEffect, useRef, useState } from 'react'
import { caughtUp, clearCookSession, loadCookSession, saveCookSession, type CookSession } from '../lib/cookSession'
import {
  clock,
  doneTimer,
  makeChime,
  pauseTimer,
  prepList,
  remaining,
  startTimer,
  stepIngredients,
  unusedIngredients,
  useWakeLock,
  type Timer,
} from '../lib/cook'
import { cookedSteps, extraDetail, isCooked, skippedIngredients } from '../lib/extras'
import { scaledQty } from '../lib/format'
import { methodOf } from '../lib/methods'
import { markCooked, updateRecipe, type Recipe, type RecipeIngredient, type RecipeStep } from '../lib/recipes'
import { dayOf, weekStartOf } from '../lib/week'

type Props = {
  householdId: string
  recipe: Recipe
  servings: number
  /** The recipe method to cook by; the recipe's own steps when missing or null. */
  methodId?: string | null
  /** The optional steps chosen for the night, by id; the others show as "Could also…". */
  extras?: string[]
  /** The saved session to pick up, when the app reopens cook mode after a reload. */
  resume?: CookSession
  onChange: (recipe: Recipe) => void
  onExit: () => void
  onDone: (message: string) => void
}

/**
 * Full-screen cooking: what to get ready, then one step at a time with the ingredients it uses,
 * then a finish screen to rate, note and mark as cooked. The chosen extras are steps like any
 * other; the optional steps not chosen show greyed out as "Could also…" after the step before them,
 * and the ingredients only they use are left out. The last step names any ingredient no
 * step used. Step timers keep running when you move to another step; the screen stays awake while it is open.
 *
 * The dish, step and timers are saved on this device as you go (`lib/cookSession`), so cooking
 * picks up where it was when the phone reloads the tab or the same dish is opened again that
 * night. Marking as cooked or going back to the recipe forgets them.
 */
export function CookMode({ householdId, recipe: r, servings, methodId, extras = [], resume, onChange, onExit, onDone }: Props) {
  const method = methodOf(r, methodId)
  const cooked = cookedSteps(method.steps, extras)
  const skipped = skippedIngredients(method.steps, r.ingredients, extras)
  const ingredients = r.ingredients.filter((i) => !skipped.includes(i))
  const steps = cooked.length ? cooked : [{ text: 'No steps saved for this recipe.', timerMins: null }]
  const uses = stepIngredients(cooked, ingredients)
  const prep = cooked.length ? prepList(cooked, ingredients) : []
  const unused = unusedIngredients(cooked, ingredients)
  // Each optional step not chosen, under the cooked step before it (the first, for any before it).
  const could = new Map<number, RecipeStep[]>()
  let at = 0
  for (const s of method.steps) {
    if (isCooked(s, extras)) at = cooked.indexOf(s)
    else could.set(at, [...(could.get(at) ?? []), s])
  }
  const firstStep = prep.length ? -1 : 0
  // The night being cooked and where its saved session left off, worked out once on opening.
  const [opened] = useState(() => {
    const today = new Date()
    const night = {
      householdId,
      week: resume?.week ?? weekStartOf(today),
      day: resume?.day ?? dayOf(today),
      recipeId: r.id,
    }
    const saved = resume ?? loadCookSession(night)
    // A session for other steps (another method or extras, or the recipe was edited) starts again.
    const fits =
      saved &&
      saved.methodId === method.id &&
      saved.extras.join() === extras.join() &&
      saved.step >= firstStep &&
      saved.step < steps.length
    const timers = fits
      ? Object.fromEntries(Object.entries(caughtUp(saved.timers, today.getTime())).filter(([ix]) => steps[Number(ix)]?.timerMins))
      : {}
    return { night, step: fits ? saved.step : firstStep, finished: fits ? saved.finished : false, timers }
  })
  // -1 is the prep list before step 1.
  const [step, setStep] = useState(opened.step)
  const [finished, setFinished] = useState(opened.finished)
  const [timers, setTimers] = useState<Record<number, Timer>>(opened.timers)
  const [now, setNow] = useState(() => Date.now())
  const [notes, setNotes] = useState(r.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [chime] = useState(makeChime)
  const panel = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const awake = useWakeLock()

  const running = Object.values(timers).some((t) => t.endAt != null)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => () => chime.close(), [chime])

  // Each running timer rings when its end time comes, including one picked up from a saved session.
  useEffect(() => {
    const ids = Object.entries(timers)
      .filter(([, t]) => t.endAt != null)
      .map(([ix, t]) =>
        setTimeout(
          () => {
            chime.play()
            setTimers((ts) => (ts[Number(ix)]?.endAt === t.endAt ? { ...ts, [ix]: doneTimer } : ts))
          },
          Math.max(0, t.endAt! - Date.now()),
        ),
      )
    return () => ids.forEach(clearTimeout)
  }, [timers, chime])

  // A page can only play sound after a tap, so after a reload the first tap readies the timer sound.
  useEffect(() => {
    if (!Object.values(opened.timers).some((t) => t.endAt != null)) return
    const prime = () => chime.prime()
    document.addEventListener('pointerdown', prime, { once: true })
    return () => document.removeEventListener('pointerdown', prime)
  }, [opened, chime])

  const methodKey = method.id
  const extrasKey = extras.join()
  useEffect(() => {
    saveCookSession({
      ...opened.night,
      methodId: methodKey,
      extras: extrasKey ? extrasKey.split(',') : [],
      servings,
      step,
      finished,
      timers,
      savedAt: Date.now(),
    })
  }, [opened, methodKey, extrasKey, servings, step, finished, timers])

  /** Closing on purpose: the session is not picked up again. */
  const exit = () => {
    clearCookSession(opened.night)
    onExit()
  }

  useEffect(() => {
    back.current?.focus()
    panel.current?.scrollTo?.(0, 0)
  }, [step, finished])

  const start = (ix: number) => {
    chime.prime()
    setNow(Date.now())
    setTimers({ ...timers, [ix]: startTimer(timers[ix], (steps[ix].timerMins ?? 0) * 60, Date.now()) })
  }

  const pause = (ix: number) =>
    setTimers({ ...timers, [ix]: pauseTimer(timers[ix], Date.now()) })

  const reset = (ix: number) => {
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
      clearCookSession(opened.night)
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

  const amount = (i: RecipeIngredient) => scaledQty(i.qty, i.unit, servings, r.serves)

  if (step < 0) {
    return (
      <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-label={`Cooking ${r.name}`}>
        <div className="wrap">
          <div className="row spread">
            <button ref={back} className="back" type="button" onClick={exit}>
              ‹ Recipe
            </button>
            {method.id && <span className="small muted">{method.name}</span>}
          </div>
          <h1>Get these ready</h1>
          {prep.map((g) => {
            const label = g.step == null ? 'Also' : `For step ${g.step + 1}`
            return (
              <section key={label} className="stack tight" aria-label={label}>
                <span className="label">{label}</span>
                <Ingredients items={g.ingredients} amount={amount} />
              </section>
            )
          })}
          {awake && <span className="small muted">Screen stays awake while you cook.</span>}
          <button className="btn" type="button" onClick={() => setStep(0)}>
            Start step 1
          </button>
        </div>
      </div>
    )
  }

  const st = steps[step]
  const needs = uses[step] ?? []
  const last = step >= steps.length - 1

  return (
    <div ref={panel} className="panel" role="dialog" aria-modal="true" aria-label={`Cooking ${r.name}`}>
      <div className="wrap">
        <div className="row spread">
          <button ref={back} className="back" type="button" onClick={exit}>
            ‹ Recipe
          </button>
          <span className="small muted">
            {method.id && `${method.name} · `}
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
        {needs.length > 0 && (
          <section className="stack tight" aria-label="This step uses">
            <span className="label">This step uses</span>
            <Ingredients items={needs} amount={amount} />
          </section>
        )}
        <p className="bigstep">{st.text}</p>
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
        {(could.get(step) ?? []).length > 0 && (
          <section className="stack tight could" aria-label="Could also">
            <span className="label">Could also…</span>
            {could.get(step)!.map((s, ix) => (
              <p key={s.id ?? ix} className="small flat">
                {s.text}
                {extraDetail(s) && <small>{extraDetail(s)}</small>}
              </p>
            ))}
          </section>
        )}
        {elsewhere.map(({ ix, t }) => (
          <button key={ix} className="btn quiet other-timer" type="button" onClick={() => setStep(ix)}>
            Step {ix + 1} timer: {t.done ? 'time’s up' : `${clock(remaining(t, now))}${t.endAt == null ? ' paused' : ''}`}
          </button>
        ))}
        {last && unused.length > 0 && (
          <p className="small warn flat" role="note">
            Didn’t use: {unused.map((i) => i.name).join(', ')}
          </p>
        )}
        {awake && <span className="small muted">Screen stays awake while you cook.</span>}
        <div className="row">
          <button
            className="btn ghost grow"
            type="button"
            disabled={step === 0 && !prep.length}
            onClick={() => setStep(step - 1)}
          >
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

/** Ingredient rows with their amounts for the servings being cooked. */
function Ingredients({ items, amount }: { items: RecipeIngredient[]; amount: (i: RecipeIngredient) => string }) {
  return (
    <div>
      {items.map((i, ix) => (
        <div key={ix} className="ing">
          <span>
            {i.name}
            {i.note && <small> {i.note}</small>}
          </span>
          <span>{amount(i)}</span>
        </div>
      ))}
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
