import { useEffect, useState } from 'react'
import { num } from '../lib/format'
import { deriveList, itemDetail, itemQty, rowQty, SECTIONS, shopList, swapPrompt, UNITS, type Mark, type ShopRow } from '../lib/list'
import { addExtra, applyMark, loadList, removeExtra, setMark, setSection, subscribeList, type ListData } from '../lib/shop'
import { weekStartOf } from '../lib/week'
import { AskClaudeButton } from './AskClaude'
import { Sheet } from './Sheet'
import { WeekNav } from './WeekNav'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

const HIDE_KEY = 'wfd.hideTicked'
const loadHide = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The Shopping list tab: the week's list worked out from the plan, by section in walking
 * order. Ticks and other marks show straight away and reach everyone else as they happen.
 */
export function ListTab({ householdId, adding, onAddClose }: { householdId: string; adding: boolean; onAddClose: () => void }) {
  const [week, setWeek] = useState(() => weekStartOf(new Date()))
  const [list, setList] = useState<{ week: string; data: ListData }>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)
  const [hideTicked, setHideTicked] = useState(loadHide)
  const [openKey, setOpenKey] = useState<string>()

  useEffect(() => {
    let live = true
    loadList(householdId, week).then(
      (data) => {
        if (!live) return
        setList({ week, data })
        setError(undefined)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, week, version])

  // A plan saved by Claude is many row changes; reload once they settle.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeList(householdId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => setVersion((v) => v + 1), 250)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [householdId])

  const reload = () => setVersion((v) => v + 1)
  const data = list?.week === week ? list.data : undefined
  const items = data ? deriveList(data.dishes, data.sections, data.extras) : []
  const view = data ? shopList(items, data.marks, hideTicked) : undefined

  /** Changes a mark on screen at once, then saves it; reloads if the save fails. */
  const mark = async (key: string, change: Partial<Mark>) => {
    setList((l) => l && { ...l, data: { ...l.data, marks: { ...l.data.marks, [key]: applyMark(l.data.marks[key], change) } } })
    try {
      await setMark(householdId, week, key, change)
    } catch (e) {
      setError(errorText(e))
      reload()
    }
  }

  /** Runs a save, shows any error, and reloads after it. */
  const save = async (write: () => Promise<void>) => {
    try {
      await write()
      setError(undefined)
    } catch (e) {
      setError(errorText(e))
    } finally {
      reload()
    }
  }

  const toggleHide = (hide: boolean) => {
    setHideTicked(hide)
    try {
      localStorage.setItem(HIDE_KEY, hide ? '1' : '0')
    } catch {
      // Only a convenience; the toggle still works for this visit.
    }
  }

  // The open item, found even when Hide ticked hides it.
  const all = openKey && data ? shopList(items, data.marks) : undefined
  const openRow = all && [...all.sections.flatMap((s) => s.rows), ...all.have].find((r) => r.key === openKey)

  const row = (r: ShopRow) => (
    <ItemRow key={r.key} row={r} onTick={(ticked) => mark(r.key, { ticked, ...(ticked ? { missing: false } : {}) })} onOpen={() => setOpenKey(r.key)} swapPrompt={() => swapPrompt(r, data?.dishes ?? [], week)} />
  )

  return (
    <>
      <WeekNav week={week} onChange={setWeek} />
      {error && (
        <p className="small warn" role="alert">
          Could not {data ? 'save that change' : 'load the list'}: {error}
        </p>
      )}
      {!view ? (
        !error && (
          <p className="muted" role="status">
            Loading the list…
          </p>
        )
      ) : !items.length ? (
        <div className="empty-state">
          <h2>No shopping list yet</h2>
          <p className="muted small">The list builds itself from the dinners planned for this week. Plan some nights, or add an item by hand.</p>
        </div>
      ) : (
        <>
          <div className="listbar">
            <span className="small">
              <b>{view.ticked}</b> of {view.total} ticked
            </span>
            <label className="toggle small">
              <input type="checkbox" checked={hideTicked} onChange={(e) => toggleHide(e.target.checked)} />
              Hide ticked
            </label>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Ticked"
            aria-valuemin={0}
            aria-valuemax={view.total}
            aria-valuenow={view.ticked}
          >
            <span style={{ width: `${view.total ? Math.round((view.ticked / view.total) * 100) : 0}%` }} />
          </div>
          {view.sections.map((s) => (
            <section key={s.section} aria-label={s.section}>
              <h3 className="label aisle">{s.section}</h3>
              <div className="items">{s.rows.map(row)}</div>
            </section>
          ))}
          {view.total > 0 && view.ticked === view.total && hideTicked && <p className="muted small">Everything is ticked.</p>}
          {view.have.length > 0 && (
            <section aria-label="Already have">
              <h3 className="label aisle">Already have</h3>
              <div className="items">{view.have.map(row)}</div>
            </section>
          )}
        </>
      )}
      {openKey && data && (
        <ItemSheet
          key={openKey}
          row={openRow}
          onMark={(change) => {
            mark(openKey, change)
            setOpenKey(undefined)
          }}
          onSection={(section) => openRow && save(() => setSection(openRow, section))}
          onRemove={() => {
            const id = openRow?.extra
            if (id) save(() => removeExtra(id))
            setOpenKey(undefined)
          }}
          onClose={() => setOpenKey(undefined)}
        />
      )}
      {adding && (
        <AddSheet
          sections={data?.sections ?? {}}
          onAdd={(extra) => {
            save(() => addExtra(householdId, week, extra))
            onAddClose()
          }}
          onClose={onAddClose}
        />
      )}
    </>
  )
}

function ItemRow({ row, onTick, onOpen, swapPrompt }: { row: ShopRow; onTick: (ticked: boolean) => void; onOpen: () => void; swapPrompt: () => string }) {
  const { ticked, missing } = row.mark
  const detail = itemDetail(row)
  const id = `tick-${row.key}`
  return (
    <>
      <div className={`item${ticked ? ' done' : ''}${missing ? ' miss' : ''}`}>
        <label htmlFor={id}>
          <input id={id} type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} />
          <span className="nm">
            <b>{row.name}</b>
            {missing && <span className="tag">Couldn’t get it</span>}
            {detail && <small>{detail}</small>}
          </span>
        </label>
        <button type="button" className="qty" aria-label={`Change amount for ${row.name}`} onClick={onOpen}>
          {rowQty(row)}
        </button>
      </div>
      {missing && (
        <div className="swaprow">
          <AskClaudeButton className="btn ghost wide" prompt={swapPrompt}>
            Ask Claude for a swap
          </AskClaudeButton>
        </div>
      )}
    </>
  )
}

/** One item: the amount bought, its section, couldn't get it, already have it, and removing a hand-added item. */
function ItemSheet({
  row,
  onMark,
  onSection,
  onRemove,
  onClose,
}: {
  row?: ShopRow
  onMark: (change: Partial<Mark>) => void
  onSection: (section: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [qty, setQty] = useState(() =>
    row?.mark.boughtQty != null ? String(row.mark.boughtQty) : row?.qty != null ? num(row.qty) : '',
  )
  const [unit, setUnit] = useState(row?.mark.boughtUnit || row?.unit || 'each')

  if (!row) {
    return (
      <Sheet title="Change amount" onClose={onClose}>
        <p className="flat">This item is no longer on the list.</p>
        <button className="btn wide" type="button" onClick={onClose}>
          Done
        </button>
      </Sheet>
    )
  }

  const detail = row.nights.length ? itemDetail({ ...row, notes: [] }) : ''
  const units: readonly string[] = UNITS.includes(unit as never) ? UNITS : [unit, ...UNITS]
  return (
    <Sheet title={row.name} onClose={onClose}>
      <p className="small muted flat">
        Needed {itemQty(row)}
        {detail && ` · ${detail}`}
      </p>
      <div className="stack tight">
        <label className="lab" htmlFor="bought-qty">
          Bought
        </label>
        <div className="row">
          <input
            id="bought-qty"
            className="field grow"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <select className="field" aria-label="Bought unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="stack tight">
        <label className="lab" htmlFor="item-section">
          Section
        </label>
        <select id="item-section" className="field" value={row.section} onChange={(e) => onSection(e.target.value)}>
          {SECTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <button
        className="btn wide"
        type="button"
        onClick={() => {
          const n = qty.trim() === '' ? null : Number(qty)
          onMark({ ticked: true, boughtQty: n != null && !isNaN(n) && n >= 0 ? n : null, boughtUnit: unit, missing: false })
        }}
      >
        Save and tick
      </button>
      <div className="row wrap-row">
        <button className="btn ghost grow" type="button" onClick={() => onMark({ missing: !row.mark.missing, ticked: false })}>
          {row.mark.missing ? 'Found it after all' : 'Couldn’t get it'}
        </button>
        <button className="btn ghost grow" type="button" onClick={() => onMark({ haveIt: !row.mark.haveIt })}>
          {row.mark.haveIt ? 'Need to buy it' : 'Already have it'}
        </button>
      </div>
      {row.extra && (
        <button className="btn danger wide" type="button" onClick={onRemove}>
          Remove from list
        </button>
      )}
    </Sheet>
  )
}

/** Adds an item by hand. The section follows a known ingredient until it is picked. */
function AddSheet({
  sections,
  onAdd,
  onClose,
}: {
  sections: Record<string, string>
  onAdd: (extra: { name: string; qty: number | null; unit: string; section: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('each')
  const [picked, setPicked] = useState<string>()
  const clean = name.toLowerCase().trim()
  const section = picked ?? (SECTIONS as readonly string[]).find((s) => s === sections[clean]) ?? 'other'

  return (
    <Sheet title="Add an item" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (!clean) return
          const n = qty.trim() === '' ? null : Number(qty)
          onAdd({ name: clean, qty: n != null && !isNaN(n) && n >= 0 ? n : null, unit, section })
        }}
      >
        <label className="lab" htmlFor="add-name">
          Item
        </label>
        <input id="add-name" className="field" placeholder="e.g. milk" autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <div className="stack tight grow">
            <label className="lab" htmlFor="add-qty">
              Amount
            </label>
            <input id="add-qty" className="field" type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="stack tight">
            <label className="lab" htmlFor="add-unit">
              Unit
            </label>
            <select id="add-unit" className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="lab" htmlFor="add-section">
          Section
        </label>
        <select id="add-section" className="field" value={section} onChange={(e) => setPicked(e.target.value)}>
          {SECTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn wide" type="submit" disabled={!clean}>
          Add to list
        </button>
      </form>
    </Sheet>
  )
}
