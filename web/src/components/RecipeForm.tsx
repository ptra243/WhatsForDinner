import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ALLERGENS } from '../lib/allergens'
import { addRecipePrompt } from '../lib/claude'
import { SECTIONS, UNITS } from '../lib/list'
import {
  byName,
  emptyIngredient,
  emptyStep,
  fieldOfError,
  formFromRecipe,
  ingredientName,
  isNew,
  moveItem,
  problems as findProblems,
  PROVIDES,
  toSaveRecipe,
  type IngredientRow,
  type Problems,
  type RecipeFormState,
  type StepRow,
  type Unit,
} from '../lib/recipeForm'
import { loadIngredients, loadRecipe, loadRecipeNames, saveRecipe, type KnownIngredient, type Recipe } from '../lib/recipes'
import { AskClaudeButton } from './AskClaude'

const SPICE: [number, string][] = [
  [0, 'None'],
  [1, '🌶'],
  [2, '🌶🌶'],
  [3, '🌶🌶🌶'],
]

type Props = {
  householdId: string
  /** The recipe to edit; a new recipe when left out. */
  recipe?: Recipe
  onSaved: (recipe: Recipe) => void
  onClose: () => void
}

/** Full-screen form to add a recipe or edit every field of one, saved in one call. */
export function RecipeForm({ householdId, recipe, onSaved, onClose }: Props) {
  const [form, setForm] = useState<RecipeFormState>(() => formFromRecipe(recipe))
  const [known, setKnown] = useState<KnownIngredient[]>()
  const [others, setOthers] = useState<{ id: string; name: string }[]>([])
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [serverProblems, setServerProblems] = useState<Problems>({})
  const back = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    back.current?.focus()
    let live = true
    // Saving waits for the ingredient list, which says which names are new; if it fails to
    // load, the database still asks for a new ingredient's section.
    loadIngredients().then(
      (k) => live && setKnown(k),
      () => live && setKnown([]),
    )
    loadRecipeNames(householdId).then(
      (n) => live && setOthers(n),
      () => {},
    )
    return () => {
      live = false
    }
  }, [householdId])

  // The recipe's own ingredients are on the list already, loaded or not.
  const knownByName = useMemo(
    () =>
      byName([
        ...(recipe?.ingredients ?? []).map((i) => ({ name: i.name, section: '', allergens: i.allergens ?? [] })),
        ...(known ?? []),
      ]),
    [recipe, known],
  )
  const found = findProblems(form, knownByName, others)
  // The ingredient rows a step can say it uses: those with a name so far.
  const named = form.ingredients.filter((row) => row.name.trim())
  const shown: Problems = tried ? { ...serverProblems, ...found } : serverProblems

  const set = (patch: Partial<RecipeFormState>) => {
    setServerProblems({})
    setForm((f) => ({ ...f, ...patch }))
  }
  const setIngredient = (key: string, patch: Partial<IngredientRow>) =>
    setForm((f) => ({ ...f, ingredients: f.ingredients.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const setStep = (key: string, patch: Partial<StepRow>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))

  const save = async () => {
    setTried(true)
    setError(undefined)
    setServerProblems({})
    if (Object.keys(found).length) {
      setError('Fix the marked fields first.')
      return
    }
    setSaving(true)
    try {
      const id = await saveRecipe(householdId, toSaveRecipe(form, knownByName))
      onSaved(await loadRecipe(id))
    } catch (e) {
      const message = (e as { message?: string }).message ?? String(e)
      const field = fieldOfError(message)
      if (field) setServerProblems({ [field]: message })
      else setError(message)
      setSaving(false)
    }
  }

  const title = recipe ? `Edit ${recipe.name}` : 'Add a recipe'

  return (
    <div className="panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wrap">
        <button ref={back} className="back" type="button" onClick={onClose}>
          ‹ Cancel
        </button>
        <h1>{title}</h1>
        {!recipe && (
          <AskClaudeButton className="btn quiet" prompt={addRecipePrompt()}>
            Got it as text or a photo? Add it with Claude
          </AskClaudeButton>
        )}
        {recipe?.isExample && (
          <p className="small muted flat">Saving makes it your own, so Clear examples keeps it.</p>
        )}

        <section className="card stack" aria-label="Recipe">
          <Field label="Name" problem={shown.name}>
            {(id, described) => (
              <input
                id={id}
                className="field"
                value={form.name}
                aria-invalid={!!shown.name}
                aria-describedby={described}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <div className="stack tight">
            <span className="small strong">Course</span>
            <div className="row">
              {(['main', 'side'] as const).map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={form.course === c} onClick={() => set({ course: c })}>
                  {c === 'main' ? 'Main' : 'Side'}
                </button>
              ))}
            </div>
          </div>
          <div className="formgrid">
            <Field label="Serves" problem={shown.serves}>
              {(id, described) => (
                <input
                  id={id}
                  className="field"
                  inputMode="decimal"
                  value={form.serves}
                  aria-invalid={!!shown.serves}
                  aria-describedby={described}
                  onChange={(e) => set({ serves: e.target.value })}
                />
              )}
            </Field>
            <Field label="Hands-on min" problem={shown.activeMins}>
              {(id, described) => (
                <input
                  id={id}
                  className="field"
                  inputMode="numeric"
                  value={form.activeMins}
                  aria-invalid={!!shown.activeMins}
                  aria-describedby={described}
                  onChange={(e) => set({ activeMins: e.target.value })}
                />
              )}
            </Field>
            <Field label="Total min" problem={shown.totalMins}>
              {(id, described) => (
                <input
                  id={id}
                  className="field"
                  inputMode="numeric"
                  value={form.totalMins}
                  aria-invalid={!!shown.totalMins}
                  aria-describedby={described}
                  onChange={(e) => set({ totalMins: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="stack tight">
            <span className="small strong">Provides</span>
            <div className="row wrap-row">
              {PROVIDES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chip"
                  aria-pressed={form.provides.includes(p)}
                  onClick={() =>
                    set({ provides: form.provides.includes(p) ? form.provides.filter((x) => x !== p) : [...form.provides, p] })
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="stack tight">
            <span className="small strong">Spice</span>
            <div className="row wrap-row">
              {SPICE.map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  className="chip"
                  aria-label={`Spice ${n}`}
                  aria-pressed={form.spice === n}
                  onClick={() => set({ spice: form.spice === n ? null : n })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Tags" hint="Separated by commas">
            {(id, described) => (
              <input
                id={id}
                className="field"
                value={form.tags}
                aria-describedby={described}
                onChange={(e) => set({ tags: e.target.value })}
              />
            )}
          </Field>
          <Field label="Source" hint="A link, book or person">
            {(id, described) => (
              <input
                id={id}
                className="field"
                value={form.source}
                aria-describedby={described}
                onChange={(e) => set({ source: e.target.value })}
              />
            )}
          </Field>
        </section>

        <section className="card stack" aria-label="Ingredients">
          <span className="label">Ingredients</span>
          <datalist id={listId}>
            {(known ?? []).map((k) => (
              <option key={k.name} value={k.name} />
            ))}
          </datalist>
          {form.ingredients.map((row, ix) => (
            <IngredientEditor
              key={row.key}
              row={row}
              index={ix}
              count={form.ingredients.length}
              listId={listId}
              isNew={isNew(row, knownByName)}
              problems={shown}
              onChange={(patch) => setIngredient(row.key, patch)}
              onMove={(to) => set({ ingredients: moveItem(form.ingredients, ix, to) })}
              onRemove={() => set({ ingredients: form.ingredients.filter((r) => r.key !== row.key) })}
            />
          ))}
          <button
            className="btn ghost"
            type="button"
            onClick={() => set({ ingredients: [...form.ingredients, emptyIngredient()] })}
          >
            Add ingredient
          </button>
        </section>

        <section className="card stack" aria-label="Method">
          <span className="label">Method</span>
          {form.steps.map((step, ix) => (
            <StepEditor
              key={step.key}
              step={step}
              index={ix}
              count={form.steps.length}
              ingredients={named}
              problems={shown}
              onChange={(patch) => setStep(step.key, patch)}
              onMove={(to) => set({ steps: moveItem(form.steps, ix, to) })}
              onRemove={() => set({ steps: form.steps.filter((s) => s.key !== step.key) })}
            />
          ))}
          <button className="btn ghost" type="button" onClick={() => set({ steps: [...form.steps, emptyStep()] })}>
            Add step
          </button>
        </section>

        <section className="card stack" aria-label="Notes">
          <label className="small strong" htmlFor="recipe-form-notes">
            Notes
          </label>
          <textarea id="recipe-form-notes" className="field" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </section>

        {error && (
          <p className="small warn flat" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="btn grow" type="button" disabled={saving || !known} onClick={save}>
            {saving ? 'Saving…' : 'Save recipe'}
          </button>
          <button className="btn ghost grow" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/** A labelled field with its problem (or hint) under it. */
function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string
  hint?: string
  problem?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const note = problem ?? hint
  return (
    <div className="stack tight">
      <label className="small strong" htmlFor={id}>
        {label}
      </label>
      {children(id, note ? `${id}-note` : undefined)}
      {note && (
        <span id={`${id}-note`} className={problem ? 'small warn' : 'small muted'}>
          {note}
        </span>
      )}
    </div>
  )
}

/** Move up, move down and remove buttons for a row. */
function RowControls({
  what,
  index,
  count,
  onMove,
  onRemove,
}: {
  what: string
  index: number
  count: number
  onMove: (to: number) => void
  onRemove: () => void
}) {
  return (
    <span className="row rowctl">
      <button type="button" className="xbtn" aria-label={`Move ${what} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        ↑
      </button>
      <button
        type="button"
        className="xbtn"
        aria-label={`Move ${what} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </button>
      <button type="button" className="xbtn" aria-label={`Remove ${what}`} onClick={onRemove}>
        ✕
      </button>
    </span>
  )
}

function IngredientEditor({
  row,
  index,
  count,
  listId,
  isNew,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  row: IngredientRow
  index: number
  count: number
  listId: string
  isNew: boolean
  problems: Problems
  onChange: (patch: Partial<IngredientRow>) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const what = `ingredient ${index + 1}`
  const p = (field: string) => problems[`ing:${row.key}:${field}`]
  return (
    <fieldset className="plain editrow" aria-label={what}>
      <div className="row">
        <input
          className="field grow"
          list={listId}
          aria-label={`Ingredient ${index + 1} name`}
          placeholder="Ingredient"
          autoComplete="off"
          value={row.name}
          aria-invalid={!!p('name')}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <RowControls what={what} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="row">
        <input
          className="field qtyfield"
          inputMode="decimal"
          aria-label={`Ingredient ${index + 1} amount`}
          placeholder="Qty"
          value={row.qty}
          aria-invalid={!!p('qty')}
          onChange={(e) => onChange({ qty: e.target.value })}
        />
        <select
          className="field"
          aria-label={`Ingredient ${index + 1} unit`}
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value as Unit })}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input
          className="field grow"
          aria-label={`Ingredient ${index + 1} note`}
          placeholder="Note"
          value={row.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
      {p('name') && <span className="small warn">{p('name')}</span>}
      {p('qty') && <span className="small warn">{p('qty')}</span>}
      {isNew && (
        <div className="stack tight newing">
          <span className="small strong">New ingredient: where is it in the shop, and what does it contain?</span>
          <select
            className="field"
            aria-label={`Ingredient ${index + 1} section`}
            value={row.section}
            aria-invalid={!!p('section')}
            onChange={(e) => onChange({ section: e.target.value as IngredientRow['section'] })}
          >
            <option value="">Pick a section</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {p('section') && <span className="small warn">{p('section')}</span>}
          <div className="row wrap-row" role="group" aria-label={`Ingredient ${index + 1} allergens`}>
            {ALLERGENS.map((a) => (
              <button
                key={a}
                type="button"
                className="chip small"
                aria-pressed={row.allergens.includes(a)}
                onClick={() =>
                  onChange({
                    allergens: row.allergens.includes(a)
                      ? row.allergens.filter((x) => x !== a)
                      : ALLERGENS.filter((x) => x === a || row.allergens.includes(x)),
                  })
                }
              >
                {a}
              </button>
            ))}
          </div>
          <span className="small muted">Leave the allergens off if it has none.</span>
        </div>
      )}
    </fieldset>
  )
}

function StepEditor({
  step,
  index,
  count,
  ingredients,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  step: StepRow
  index: number
  count: number
  ingredients: IngredientRow[]
  problems: Problems
  onChange: (patch: Partial<StepRow>) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const what = `step ${index + 1}`
  const p = (field: string) => problems[`step:${step.key}:${field}`]
  return (
    <fieldset className="plain editrow" aria-label={what}>
      <div className="row spread">
        <span className="small strong">Step {index + 1}</span>
        <RowControls what={what} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <textarea
        className="field"
        aria-label={`Step ${index + 1}`}
        value={step.text}
        aria-invalid={!!p('text')}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      {p('text') && <span className="small warn">{p('text')}</span>}
      {ingredients.length > 0 && (
        <div className="stack tight">
          <span className="small strong">Uses</span>
          <div className="row wrap-row" role="group" aria-label={`Step ${index + 1} uses`}>
            {ingredients.map((row) => (
              <button
                key={row.key}
                type="button"
                className="chip small"
                aria-pressed={step.uses.includes(row.key)}
                onClick={() =>
                  onChange({
                    uses: step.uses.includes(row.key) ? step.uses.filter((k) => k !== row.key) : [...step.uses, row.key],
                  })
                }
              >
                {ingredientName(row.name)}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="row small">
        Timer
        <input
          className="field qtyfield"
          inputMode="numeric"
          aria-label={`Step ${index + 1} timer minutes`}
          placeholder="min"
          value={step.timer}
          aria-invalid={!!p('timer')}
          onChange={(e) => onChange({ timer: e.target.value })}
        />
        <span className="muted">minutes, if it needs one</span>
      </label>
      {p('timer') && <span className="small warn">{p('timer')}</span>}
    </fieldset>
  )
}
