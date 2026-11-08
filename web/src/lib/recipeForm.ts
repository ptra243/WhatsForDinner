// The hand-entry recipe form (#21): its state, the problems shown next to fields, and the
// payload for `save_recipe`. Pure code; the component loads and saves.
import { toAllergens, type Allergen } from './allergens'
import { UNITS, type Section } from './list'
import type { Course, KnownIngredient, Recipe } from './recipes'

export type Unit = (typeof UNITS)[number]
export const PROVIDES = ['protein', 'veg', 'carb'] as const

/** An ingredient row. `section` and `allergens` are only used when the name is a new ingredient. */
export type IngredientRow = {
  key: string
  id?: string
  name: string
  qty: string
  unit: Unit
  note: string
  section: Section | ''
  allergens: Allergen[]
}
/**
 * A step row. `uses` holds the keys of the ingredient rows it uses. An `optional` step is an extra
 * a night can choose, with the minutes it adds (`extra`) and why it's worth it (`why`).
 */
export type StepRow = {
  key: string
  id?: string
  text: string
  timer: string
  uses: string[]
  optional: boolean
  extra: string
  why: string
}

/** What the form holds, as typed. `id` is the recipe being edited. */
export type RecipeFormState = {
  id?: string
  name: string
  course: Course
  serves: string
  activeMins: string
  totalMins: string
  provides: string[]
  spice: number | null
  tags: string
  source: string
  notes: string
  ingredients: IngredientRow[]
  steps: StepRow[]
}

/** The argument `save_recipe` takes (supabase/migrations/20261103120000_save_recipe.sql). */
export type SaveRecipe = {
  id?: string
  name: string
  course: Course
  serves: number
  active_mins: number | null
  total_mins: number | null
  provides: string[]
  spice: number | null
  tags: string[]
  source: string
  notes: string
  ingredients: { id?: string; name: string; qty: number | null; unit: string; note: string; section?: string; allergens?: string[] }[]
  /** `uses`: positions in `ingredients` of the ingredients the step uses. `extra_mins` and `why` only for an optional step. */
  steps: {
    id?: string
    text: string
    timer_mins: number | null
    uses: number[]
    optional: boolean
    extra_mins: number | null
    why: string
  }[]
}

/** Problems keyed by field: `name`, `serves`, `activeMins`, `totalMins`, `ing:<key>:<field>`, `step:<key>:<field>`. */
export type Problems = Record<string, string>

let lastKey = 0
const newKey = () => `row-${++lastKey}`

const asUnit = (u: string): Unit => ((UNITS as readonly string[]).includes(u) ? (u as Unit) : 'each')
const text = (n: number | null | undefined) => (n == null ? '' : String(n))

export const emptyIngredient = (): IngredientRow => ({
  key: newKey(),
  name: '',
  qty: '',
  unit: 'g',
  note: '',
  section: '',
  allergens: [],
})
export const emptyStep = (): StepRow => ({ key: newKey(), text: '', timer: '', uses: [], optional: false, extra: '', why: '' })

/** The form for a recipe, or a blank one with a row each to start on. */
export function formFromRecipe(r?: Recipe): RecipeFormState {
  if (!r) {
    return {
      name: '',
      course: 'main',
      serves: '4',
      activeMins: '',
      totalMins: '',
      provides: [],
      spice: null,
      tags: '',
      source: '',
      notes: '',
      ingredients: [emptyIngredient()],
      steps: [emptyStep()],
    }
  }
  const ingredients: IngredientRow[] = r.ingredients.map((i) => ({
    key: newKey(),
    id: i.id,
    name: i.name,
    qty: text(i.qty),
    unit: asUnit(i.unit),
    note: i.note,
    section: '',
    allergens: toAllergens(i.allergens),
  }))
  const keyOf = new Map(ingredients.map((row) => [row.id, row.key]))
  return {
    id: r.id,
    name: r.name,
    course: r.course,
    serves: text(r.serves),
    activeMins: text(r.activeMins),
    totalMins: text(r.totalMins),
    provides: r.provides,
    spice: r.spice ?? null,
    tags: r.tags.join(', '),
    source: r.source,
    notes: r.notes,
    ingredients,
    steps: r.steps.map((s) => ({
      key: newKey(),
      id: s.id,
      text: s.text,
      timer: text(s.timerMins),
      uses: (s.uses ?? []).flatMap((id) => keyOf.get(id) ?? []),
      optional: !!s.optional,
      extra: text(s.extraMins),
      why: s.why ?? '',
    })),
  }
}

/** Ingredient names as the database keeps them: lowercase, trimmed, single spaces. */
export const ingredientName = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')

/** The shared ingredient list by name. */
export const byName = (known: readonly KnownIngredient[]) => new Map(known.map((k) => [k.name, k]))

/** Whether a row names an ingredient that isn't on the shared list yet. */
export const isNew = (row: IngredientRow, known: ReadonlyMap<string, KnownIngredient>) =>
  ingredientName(row.name) !== '' && !known.has(ingredientName(row.name))

const blankIngredient = (r: IngredientRow) => !r.name.trim() && !r.qty.trim() && !r.note.trim()
const blankStep = (s: StepRow) => !s.text.trim() && !s.timer.trim() && !s.optional

/** A quantity as typed: "2", "1.5", "1/2" or "1 1/2"; blank is null ("to taste"); undefined when unreadable. */
export function parseQty(s: string): number | null | undefined {
  const t = s.trim()
  if (!t) return null
  const m = t.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/)
  if (m) {
    const [, whole, top, bottom] = m
    return +bottom ? (whole ? +whole : 0) + +top / +bottom : undefined
  }
  return /^\d*\.?\d+$/.test(t) || /^\d+\.$/.test(t) ? Number(t) : undefined
}

/** Whole minutes as typed; blank is null; undefined when not a whole number. */
function parseMins(s: string): number | null | undefined {
  const t = s.trim()
  if (!t) return null
  return /^\d+$/.test(t) ? Number(t) : undefined
}

/**
 * What stops the form saving, by field. `others` are the household's recipes, so a name
 * already used is caught before saving (the database checks again).
 */
export function problems(
  form: RecipeFormState,
  known: ReadonlyMap<string, KnownIngredient>,
  others: readonly { id: string; name: string }[] = [],
): Problems {
  const p: Problems = {}
  const name = form.name.trim()
  if (!name) p.name = 'Give the recipe a name.'
  else if (others.some((o) => o.id !== form.id && o.name.trim().toLowerCase() === name.toLowerCase()))
    p.name = 'There is already a recipe with this name.'

  const serves = Number(form.serves)
  if (!form.serves.trim() || !(serves > 0)) p.serves = 'How many it serves, more than 0.'

  const active = parseMins(form.activeMins)
  const total = parseMins(form.totalMins)
  if (active === undefined) p.activeMins = 'Whole minutes.'
  if (total === undefined) p.totalMins = 'Whole minutes.'
  else if (total != null && active != null && total < active) p.totalMins = 'Total can’t be less than hands-on.'

  for (const row of form.ingredients) {
    if (blankIngredient(row)) continue
    if (!row.name.trim()) p[`ing:${row.key}:name`] = 'Which ingredient?'
    if (parseQty(row.qty) === undefined) p[`ing:${row.key}:qty`] = 'A number, like 2, 1.5 or 1/2.'
    if (isNew(row, known) && !row.section) p[`ing:${row.key}:section`] = 'New ingredient: pick its section.'
  }
  for (const step of form.steps) {
    if (blankStep(step)) continue
    if (!step.text.trim()) p[`step:${step.key}:text`] = 'What happens in this step?'
    const timer = parseMins(step.timer)
    if (timer === undefined || timer === 0) p[`step:${step.key}:timer`] = 'Whole minutes, more than 0.'
    if (step.optional && !(Number(parseMins(step.extra)) > 0)) p[`step:${step.key}:extra`] = 'How many minutes it adds, more than 0.'
  }
  return p
}

/** The form as `save_recipe` takes it; blank rows are left out. Call only when `problems` is empty. */
export function toSaveRecipe(form: RecipeFormState, known: ReadonlyMap<string, KnownIngredient>): SaveRecipe {
  const tags = [...new Set(form.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
  const ingredients = form.ingredients.filter((r) => !blankIngredient(r))
  const position = new Map(ingredients.map((r, ix) => [r.key, ix]))
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    course: form.course,
    serves: Number(form.serves),
    active_mins: parseMins(form.activeMins) ?? null,
    total_mins: parseMins(form.totalMins) ?? null,
    provides: PROVIDES.filter((x) => form.provides.includes(x)),
    spice: form.spice,
    tags,
    source: form.source.trim(),
    notes: form.notes.trim(),
    ingredients: ingredients.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: ingredientName(r.name),
      qty: parseQty(r.qty) ?? null,
      unit: r.unit,
      note: r.note.trim(),
      ...(isNew(r, known) ? { section: r.section, allergens: r.allergens } : {}),
    })),
    steps: form.steps
      .filter((s) => !blankStep(s))
      .map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        text: s.text.trim(),
        timer_mins: parseMins(s.timer) ?? null,
        // In recipe order; a removed or blank ingredient row drops out.
        uses: s.uses.flatMap((k) => position.get(k) ?? []).sort((a, b) => a - b),
        optional: s.optional,
        extra_mins: s.optional ? (parseMins(s.extra) ?? null) : null,
        why: s.optional ? s.why.trim() : '',
      })),
  }
}

/** The field a refusal from `save_recipe` belongs next to, if any. */
export function fieldOfError(message: string): string | undefined {
  if (message.startsWith('A recipe called')) return 'name'
  if (message.startsWith('Total minutes')) return 'totalMins'
  return undefined
}

/** The list with the item at `from` moved to `to` (clamped to the list). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const target = Math.max(0, Math.min(list.length - 1, to))
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

