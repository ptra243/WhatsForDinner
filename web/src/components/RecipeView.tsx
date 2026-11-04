import { useEffect, useRef, useState } from 'react'
import { allergenWarnings, containsText, type TaggedSwap } from '../lib/allergens'
import { recipePrompt } from '../lib/claude'
import { stepIngredients } from '../lib/cook'
import { mins, scaledQty } from '../lib/format'
import { allMethods, methodOf } from '../lib/methods'
import { deleteRecipe, updateRecipe, type Recipe } from '../lib/recipes'
import { AddToNight } from './AddToNight'
import { AskClaudeButton } from './AskClaude'
import { CookMode } from './CookMode'
import { RecipeForm } from './RecipeForm'
import { RecipeVotes } from './RecipeVotes'

type Props = {
  householdId: string
  recipe: Recipe
  /** Servings the ingredients start at; the recipe's own when left out. */
  servings?: number
  /** Allergens the household avoids; the view warns about any the recipe still contains after `swaps`. */
  avoid?: readonly string[]
  /** The planned dish's swaps, when opened from a night. */
  swaps?: TaggedSwap[]
  /** The method shown first (the planned dish's, when opened from a night); the recipe's own when left out. */
  methodId?: string | null
  onChange: (recipe: Recipe) => void
  onDeleted: () => void
  onClose: () => void
}

/**
 * Full-screen recipe: meta, votes for the coming week, ingredients scaled to the chosen servings,
 * method (with a switcher when the recipe has other methods), rating and notes.
 */
export function RecipeView({
  householdId,
  recipe: r,
  servings: startServings,
  avoid = [],
  swaps,
  methodId: startMethod,
  onChange,
  onDeleted,
  onClose,
}: Props) {
  const [servings, setServings] = useState(startServings ?? r.serves)
  const [methodId, setMethodId] = useState(startMethod ?? null)
  const [notes, setNotes] = useState(r.notes)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<string>()
  const [error, setError] = useState<string>()
  const back = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    back.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const run = async (work: () => Promise<void>, done?: string) => {
    setError(undefined)
    setStatus(undefined)
    try {
      await work()
      if (done) setStatus(done)
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e))
    }
  }

  const rate = (n: number) => {
    const rating = r.rating === n ? null : n
    run(async () => {
      await updateRecipe(r.id, { rating })
      onChange({ ...r, rating })
    })
  }

  const saveNotes = () =>
    run(async () => {
      await updateRecipe(r.id, { notes })
      onChange({ ...r, notes })
    }, 'Note saved.')

  const remove = () =>
    run(async () => {
      await deleteRecipe(r.id)
      onDeleted()
    })

  const warnings = allergenWarnings(r.ingredients, avoid, swaps)
  const methods = allMethods(r)
  const method = methodOf(r, methodId)
  const stepUse = stepIngredients(method.steps, r.ingredients)

  const meta = [
    r.course === 'side' ? 'Side' : 'Main',
    method.activeMins ? `${method.activeMins} min hands-on` : '',
    method.totalMins ? `${mins(method.totalMins)} total` : '',
  ].filter(Boolean)

  return (
    <div className="panel" role="dialog" aria-modal="true" aria-label={r.name}>
      <div className="wrap">
        <div className="row spread">
          <button ref={back} className="back" type="button" onClick={onClose}>
            ‹ Back
          </button>
          <button className="btn quiet" type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <div className="stack tight">
          <h1>{r.name}</h1>
          <span className="small muted">{meta.join(' · ')}</span>
          <div className="row wrap-row">
            {r.provides.map((p) => (
              <span key={`p-${p}`} className="pill">
                {p}
              </span>
            ))}
            {r.tags.map((t) => (
              <span key={`t-${t}`} className="pill ex">
                {t}
              </span>
            ))}
            {r.isExample && <span className="pill ex">Example recipe</span>}
          </div>
          {r.source && <span className="small muted">From {r.source}</span>}
        </div>
        {methods.length > 1 && (
          <div className="row wrap-row" role="group" aria-label="Ways to cook it">
            {methods.map((m) => (
              <button
                key={m.id ?? 'default'}
                type="button"
                className="chip"
                aria-pressed={m.id === method.id}
                onClick={() => setMethodId(m.id)}
              >
                {m.name}
                {m.totalMins ? ` · ${mins(m.totalMins)}` : ''}
              </button>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="card gapcard" role="note" aria-label="Allergens">
            {warnings.map((w) => (
              <b key={w.allergen} className="small warn">
                {containsText([w.allergen])}
                {w.ingredients.join() !== w.allergen && ` (${w.ingredients.join(', ')})`}
              </b>
            ))}
            <span className="small">
              {new Set(warnings.flatMap((w) => w.ingredients)).size > 1 ? 'Swap them or check the labels.' : 'Swap it or check the label.'}
            </span>
          </div>
        )}

        <div className="row">
          <button className="btn grow" type="button" onClick={() => setCooking(true)}>
            Start cooking
          </button>
          <button className="btn ghost grow" type="button" onClick={() => setAdding(true)}>
            Add to a night
          </button>
        </div>
        <RecipeVotes householdId={householdId} recipeId={r.id} />
        <AskClaudeButton prompt={recipePrompt(r.name, r.id)}>Ask Claude about this recipe</AskClaudeButton>
        {status && (
          <p className="small muted flat" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="small warn flat" role="alert">
            {error}
          </p>
        )}

        <section className="card stack" aria-label="Ingredients">
          <div className="row spread">
            <span className="label">Ingredients</span>
            <span className="stepper">
              <button type="button" aria-label="Fewer servings" onClick={() => setServings(Math.max(1, servings - 1))}>
                −
              </button>
              <span aria-live="polite">{servings} serves</span>
              <button type="button" aria-label="More servings" onClick={() => setServings(servings + 1)}>
                +
              </button>
            </span>
          </div>
          <div>
            {r.ingredients.map((i, ix) => (
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

        <section className="card stack" aria-label="Method">
          <span className="label">{method.id ? `Method: ${method.name}` : 'Method'}</span>
          <ol className="steps">
            {method.steps.map((s, ix) => (
              <li key={ix}>
                {stepUse[ix].length > 0 && (
                  <span className="small muted uses">{stepUse[ix].map((i) => i.name).join(', ')}</span>
                )}
                {s.text}
                {s.timerMins ? <span className="tm"> {s.timerMins} min timer</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="card stack" aria-label="Your rating">
          <span className="label">Your rating</span>
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
          <label className="small strong" htmlFor="recipe-notes">
            Notes for next time
          </label>
          <textarea id="recipe-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn ghost" type="button" disabled={notes === r.notes} onClick={saveNotes}>
            Save note
          </button>
        </section>

        {confirmDelete ? (
          <div className="card stack confirm">
            <b>Delete {r.name}?</b>
            <span className="small">It also comes off any nights it is planned on.</span>
            <div className="row">
              <button className="btn danger grow" type="button" onClick={remove}>
                Delete
              </button>
              <button className="btn ghost grow" type="button" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button className="btn quiet warn" type="button" onClick={() => setConfirmDelete(true)}>
            Delete recipe
          </button>
        )}
      </div>
      {cooking && (
        <CookMode
          householdId={householdId}
          recipe={r}
          servings={servings}
          methodId={method.id}
          onChange={(next) => {
            if (next.notes !== r.notes) setNotes(next.notes)
            onChange(next)
          }}
          onExit={() => {
            setCooking(false)
            back.current?.focus()
          }}
          onDone={(message) => {
            setCooking(false)
            setError(undefined)
            setStatus(message)
            back.current?.focus()
          }}
        />
      )}
      {editing && (
        <RecipeForm
          householdId={householdId}
          recipe={r}
          onSaved={(next) => {
            setEditing(false)
            setNotes(next.notes)
            setError(undefined)
            setStatus('Recipe saved.')
            onChange(next)
            back.current?.focus()
          }}
          onClose={() => {
            setEditing(false)
            back.current?.focus()
          }}
        />
      )}
      {adding && (
        <AddToNight
          householdId={householdId}
          recipe={r}
          onAdded={(label) => {
            setAdding(false)
            setError(undefined)
            setStatus(`Added to ${label}.`)
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
