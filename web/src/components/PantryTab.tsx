import { useEffect, useId, useState } from 'react'
import { pantryPlanPrompt } from '../lib/claude'
import { SECTIONS, UNITS } from '../lib/list'
import {
  addPantryItem,
  bestBeforeText,
  defaultBestBefore,
  freshness,
  loadPantry,
  LOCATION_NAMES,
  LOCATIONS,
  pantryGroups,
  pantryQty,
  readPantryForm,
  removePantryItem,
  subscribePantry,
  updatePantryItem,
  type PantryForm,
  type PantryIngredient,
  type PantryItem,
} from '../lib/pantry'
import { weekStartOf, ymd } from '../lib/week'
import { AskClaudeButton } from './AskClaude'
import { Sheet } from './Sheet'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

type Pantry = { items: PantryItem[]; ingredients: Record<string, PantryIngredient> }

/**
 * The Pantry tab: what the household has at home, by where it is kept, soonest best-before
 * first, with those past or near it flagged. Changes reach the other member as they happen.
 */
export function PantryTab({ householdId, adding, onAddClose }: { householdId: string; adding: boolean; onAddClose: () => void }) {
  const [pantry, setPantry] = useState<Pantry>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<PantryItem>()
  const today = ymd(new Date())

  useEffect(() => {
    let live = true
    loadPantry(householdId).then(
      (p) => {
        if (!live) return
        setPantry(p)
        setError(undefined)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, version])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribePantry(householdId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => setVersion((v) => v + 1), 250)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [householdId])

  /** Runs a save, shows any error, and reloads after it. */
  const save = async (write: () => Promise<void>) => {
    try {
      await write()
      setError(undefined)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setVersion((v) => v + 1)
    }
  }

  const items = pantry?.items ?? []
  const groups = pantryGroups(items)
  const flagged = items.filter((i) => freshness(i.bestBefore, today)).length

  return (
    <>
      {error && (
        <p className="small warn" role="alert">
          Could not {pantry ? 'save that change' : 'load the pantry'}: {error}
        </p>
      )}
      {!pantry ? (
        !error && (
          <p className="muted" role="status">
            Loading the pantry…
          </p>
        )
      ) : !items.length ? (
        <div className="empty-state">
          <h2>Nothing in the pantry yet</h2>
          <p className="muted small">
            Add what’s at home, and where. The shopping list will say what you already have, and Claude can plan the week around what needs
            using first.
          </p>
        </div>
      ) : (
        <>
          {flagged > 0 && (
            <p className="small warn flat" role="status">
              {flagged === 1 ? '1 item' : `${flagged} items`} past or near best-before
            </p>
          )}
          <AskClaudeButton className="btn ghost wide" prompt={() => pantryPlanPrompt(weekStartOf(new Date()))}>
            Plan around my pantry
          </AskClaudeButton>
          {groups.map((g) => (
            <section key={g.location} aria-label={LOCATION_NAMES[g.location]}>
              <h3 className="label aisle">{LOCATION_NAMES[g.location]}</h3>
              <div className="items">
                {g.items.map((i) => (
                  <PantryRow key={i.id} item={i} today={today} onOpen={() => setEditing(i)} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {(adding || editing) && pantry && (
        <ItemSheet
          key={editing?.id ?? 'new'}
          item={editing}
          ingredients={pantry.ingredients}
          today={today}
          onSave={(read) => {
            const { values, newIngredient } = read
            const id = editing?.id
            void save(() => (id ? updatePantryItem(id, values, newIngredient) : addPantryItem(householdId, values, newIngredient)))
            setEditing(undefined)
            onAddClose()
          }}
          onUsedUp={() => {
            const id = editing?.id
            if (id) void save(() => removePantryItem(id))
            setEditing(undefined)
          }}
          onClose={() => {
            setEditing(undefined)
            onAddClose()
          }}
        />
      )}
    </>
  )
}

function PantryRow({ item, today, onOpen }: { item: PantryItem; today: string; onOpen: () => void }) {
  const fresh = freshness(item.bestBefore, today)
  const detail = [pantryQty(item), item.note].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`pitem${fresh ? ` ${fresh}` : ''}`} aria-label={`${item.name}, ${detail}`} onClick={onOpen}>
      <span className="nm">
        <b>{item.name}</b>
        <small>{detail}</small>
      </span>
      {item.bestBefore && (
        <span className="when">
          {fresh === 'past' ? 'Past best before' : fresh === 'soon' ? 'Use soon' : 'Best before'}
          <br />
          {bestBeforeText(item.bestBefore, today)}
        </span>
      )}
    </button>
  )
}

type Read = Exclude<ReturnType<typeof readPantryForm>, { error: string }>

/**
 * Adds an item, or edits one (`item`) with Used up to take it off. The best-before follows the
 * ingredient's shelf life until it is changed by hand; a new ingredient needs its section.
 */
function ItemSheet({
  item,
  ingredients,
  today,
  onSave,
  onUsedUp,
  onClose,
}: {
  item?: PantryItem
  ingredients: Record<string, PantryIngredient>
  today: string
  onSave: (read: Read) => void
  onUsedUp: () => void
  onClose: () => void
}) {
  const listId = useId()
  const [form, setForm] = useState<Omit<PantryForm, 'bestBefore'>>({
    name: item?.name ?? '',
    qty: item?.qty != null ? String(item.qty) : '',
    unit: item?.unit ?? 'each',
    location: item?.location ?? 'fridge',
    note: item?.note ?? '',
    section: '',
  })
  // Null until the date is changed by hand; until then it follows the ingredient's shelf life.
  const [picked, setPicked] = useState<string | null>(item ? (item.bestBefore ?? '') : null)
  const set = (patch: Partial<PantryForm>) => setForm((f) => ({ ...f, ...patch }))
  const name = form.name.toLowerCase().trim()
  const known = ingredients[name]
  const bestBefore = picked ?? defaultBestBefore(today, known?.shelfDays) ?? ''
  const read = readPantryForm({ ...form, bestBefore }, ingredients)
  const names = Object.keys(ingredients).sort()

  return (
    <Sheet title={item ? item.name : 'Add to the pantry'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (!('error' in read)) onSave(read)
        }}
      >
        <label className="lab" htmlFor="pantry-name">
          Item
        </label>
        <input
          id="pantry-name"
          className="field"
          placeholder="e.g. chicken thigh"
          autoComplete="off"
          list={listId}
          autoFocus={!item}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {name && !known && (
          <>
            <label className="lab" htmlFor="pantry-section">
              Section (a new ingredient)
            </label>
            <select id="pantry-section" className="field" value={form.section} onChange={(e) => set({ section: e.target.value })}>
              <option value="">Pick a section</option>
              {SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        <div className="row">
          <div className="stack tight grow">
            <label className="lab" htmlFor="pantry-qty">
              Amount
            </label>
            <input
              id="pantry-qty"
              className="field"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Some"
              value={form.qty}
              onChange={(e) => set({ qty: e.target.value })}
            />
          </div>
          <div className="stack tight">
            <label className="lab" htmlFor="pantry-unit">
              Unit
            </label>
            <select id="pantry-unit" className="field" value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="lab" htmlFor="pantry-location">
          Where
        </label>
        <select id="pantry-location" className="field" value={form.location} onChange={(e) => set({ location: e.target.value })}>
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {LOCATION_NAMES[l]}
            </option>
          ))}
        </select>
        <label className="lab" htmlFor="pantry-best-before">
          Best before
        </label>
        <input
          id="pantry-best-before"
          className="field"
          type="date"
          value={bestBefore}
          onChange={(e) => setPicked(e.target.value)}
        />
        {known?.shelfDays != null && picked == null && (
          <p className="small muted flat">Keeps about {known.shelfDays === 1 ? '1 day' : `${known.shelfDays} days`} once bought.</p>
        )}
        <label className="lab" htmlFor="pantry-note">
          Note
        </label>
        <input
          id="pantry-note"
          className="field"
          placeholder="e.g. on special, opened"
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
        />
        {'error' in read && name && <p className="small warn flat">{read.error}</p>}
        <button className="btn wide" type="submit" disabled={'error' in read}>
          {item ? 'Save' : 'Add to the pantry'}
        </button>
        {item && (
          <button className="btn danger wide" type="button" onClick={onUsedUp}>
            Used up
          </button>
        )}
      </form>
    </Sheet>
  )
}
