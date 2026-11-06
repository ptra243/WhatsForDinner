import { Fragment, useEffect, useState } from 'react'
import { fmtQty, num } from '../lib/format'
import { deriveList, itemDetail, itemQty, NO_MARK, readPackForm, rowPacks, rowQty, SECTIONS, shopList, swapPrompt, UNITS, type Mark, type Pack, type ShopRow } from '../lib/list'
import { enqueue, flush, onDropped, pending, withPending, type Change } from '../lib/offlineQueue'
import { useOnline } from '../lib/online'
import { addLeftover, bestBeforeText, defaultBestBefore, defaultLocation, inPantryText, leftover, LOCATION_NAMES } from '../lib/pantry'
import { itemPrices, money, STORE_NAMES, storeTotals, totalText, type ItemStorePrice, type Prices } from '../lib/prices'
import { applyMark, loadList, setPackAndShelf, setSection, subscribeList, type ListData } from '../lib/shop'
import { dayLabel, weekStartOf, ymd } from '../lib/week'
import { showToast } from '../lib/toast'
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
  // The bought item whose left-over amount the list offers to add to the pantry. It stays on
  // the list until answered, even with Hide ticked on.
  const [offerKey, setOfferKey] = useState<string>()
  // Items (week|key) whose rest went to the pantry this visit, so a re-tick doesn't add it twice.
  const [restAdded, setRestAdded] = useState<ReadonlySet<string>>(() => new Set())
  // A pantry save that failed; kept until the next one or dismissed, since reloading the list clears `error`.
  const [pantryError, setPantryError] = useState<string>()
  // Offline the list shows from the service worker and changes wait in the queue; moving a
  // section needs signal. The list reloads when the signal returns.
  const online = useOnline()

  useEffect(() => {
    let live = true
    loadList(householdId, week).then(
      (data) => {
        if (!live) return
        setList({ week, data: withPending(data, pending(householdId), week) })
        setError(undefined)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, week, version, online])

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

  // A change the database refused was shown already; reload to show what it holds.
  useEffect(() => onDropped(() => setVersion((v) => v + 1)), [])

  const reload = () => setVersion((v) => v + 1)
  const data = list?.week === week ? list.data : undefined
  const items = data ? deriveList(data.dishes, data.sections, data.extras, data.packs) : []
  const view = data ? shopList(items, data.marks, hideTicked, offerKey) : undefined
  const today = ymd(new Date())
  const prices: Prices = data?.prices ?? {}
  // Every item counts towards the totals, ticked or hidden, except those marked already have.
  const totals = data ? storeTotals(items.map((i) => ({ ...i, mark: data.marks[i.key] ?? NO_MARK })), prices, data.sections, today) : []
  // Prices are keyed by ingredient, so a hand-added item has them only when it is a known ingredient.
  const pricesOf = (r: ShopRow) => (data && (!r.extra || r.name in data.sections) ? itemPrices(r, prices, today) : null)

  /** Shows a change on screen at once and queues it, sending it now if there is signal. */
  const change = (c: Change, show: (data: ListData) => ListData) => {
    setList((l) => l && { ...l, data: show(l.data) })
    enqueue(householdId, c)
    void flush(householdId)
  }

  const mark = (key: string, m: Partial<Mark>) =>
    change({ kind: 'mark', week, key, change: m }, (d) => ({ ...d, marks: { ...d.marks, [key]: applyMark(d.marks[key], m) } }))

  /** What is left of a ticked item for the pantry; only for a known ingredient, and once. */
  const restOf = (r: ShopRow) =>
    data && r.mark.ticked && r.name in data.sections && !restAdded.has(`${week}|${r.key}`) ? leftover(r) : null

  /** Ticks an item (or unticks it); a tick with something left over offers it to the pantry. */
  const tickItem = (r: ShopRow, m: Partial<Mark>) => {
    mark(r.key, m)
    const after = { ...r, mark: applyMark(r.mark, m) }
    setOfferKey(restOf(after) ? r.key : undefined)
  }

  /** Adds a bought item's left-over amount to the pantry, where it usually goes, with its shelf life. */
  const addRest = async (r: ShopRow) => {
    const rest = restOf(r)
    setOfferKey(undefined)
    if (!rest || !data) return
    const location = defaultLocation(r.section)
    const bestBefore = defaultBestBefore(today, data.shelfDays[r.name])
    try {
      const added = await addLeftover(householdId, r.name, { ...rest, location, bestBefore })
      if (!added) return
      setPantryError(undefined)
      setRestAdded((s) => new Set(s).add(`${week}|${r.key}`))
      showToast(
        `Added ${fmtQty(rest.qty, rest.unit)} ${r.name} to the ${LOCATION_NAMES[location].toLowerCase()}` +
          (bestBefore ? `, best before ${bestBeforeText(bestBefore, today)}.` : '.'),
      )
    } catch (e) {
      setPantryError(errorText(e))
    } finally {
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

  const row = (r: ShopRow) => {
    const rest = offerKey === r.key ? restOf(r) : null
    return (
      <ItemRow
        key={r.key}
        row={r}
        prices={pricesOf(r)}
        pantry={data ? inPantryText(r.name, data.pantry, today) : null}
        rest={rest ? fmtQty(rest.qty, rest.unit) : null}
        onTick={(ticked) => tickItem(r, { ticked, ...(ticked ? { missing: false } : {}) })}
        onHaveIt={() => mark(r.key, { haveIt: true })}
        onAddRest={() => void addRest(r)}
        onNoRest={() => setOfferKey(undefined)}
        onOpen={() => setOpenKey(r.key)}
        swapPrompt={() => swapPrompt(r, data?.dishes ?? [], week)}
      />
    )
  }

  return (
    <>
      <WeekNav week={week} onChange={setWeek} />
      {pantryError && (
        <p className="small warn row" role="alert">
          <span className="grow">Could not add it to the pantry: {pantryError}</span>
          <button className="btn quiet" type="button" onClick={() => setPantryError(undefined)}>
            Dismiss
          </button>
        </p>
      )}
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
          {totals.length > 0 && (
            <section className="totals" aria-label="Store totals">
              {totals.map((t) => (
                <p key={t.store} className="small flat">
                  {totalText(t)}
                  {t.older && <span className="muted"> · includes older prices</span>}
                </p>
              ))}
            </section>
          )}
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
          prices={openRow ? pricesOf(openRow) : null}
          offline={!online}
          // A hand-added item has a pack size only when it is a known ingredient; a planned one always can.
          ingredient={
            openRow && (!openRow.extra || openRow.name in data.sections)
              ? { pack: data.packs[openRow.name] ?? null, shelfDays: data.shelfDays[openRow.name] ?? null }
              : undefined
          }
          onMark={(change) => {
            if (openRow && change.ticked) tickItem(openRow, change)
            else mark(openKey, change)
            setOpenKey(undefined)
          }}
          onSection={(section) => openRow && save(() => setSection(openRow, section))}
          onPack={(values) => {
            if (openRow) void save(() => setPackAndShelf(openRow, values))
            setOpenKey(undefined)
          }}
          onRemove={() => {
            const id = openRow?.extra
            if (id) change({ kind: 'remove', week, id }, (d) => ({ ...d, extras: d.extras.filter((x) => x.id !== id) }))
            setOpenKey(undefined)
          }}
          onClose={() => setOpenKey(undefined)}
        />
      )}
      {adding && (
        <AddSheet
          sections={data?.sections ?? {}}
          onAdd={(extra) => {
            const added = { ...extra, id: crypto.randomUUID() }
            change({ kind: 'add', week, extra: added }, (d) => ({ ...d, extras: [...d.extras, added] }))
            onAddClose()
          }}
          onClose={onAddClose}
        />
      )}
    </>
  )
}

function ItemRow({
  row,
  prices,
  pantry,
  rest,
  onTick,
  onHaveIt,
  onAddRest,
  onNoRest,
  onOpen,
  swapPrompt,
}: {
  row: ShopRow
  prices: ItemStorePrice[] | null
  /** "In pantry: 300 g, best before Fri", when the pantry has some. */
  pantry: string | null
  /** The amount left over once ticked ("200 g"), while the list offers it to the pantry. */
  rest: string | null
  onTick: (ticked: boolean) => void
  onHaveIt: () => void
  onAddRest: () => void
  onNoRest: () => void
  onOpen: () => void
  swapPrompt: () => string
}) {
  const { ticked, missing } = row.mark
  const detail = itemDetail(row)
  const packs = rowPacks(row)
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
            <PriceLine prices={prices} />
            {pantry && <small className="inpantry">{pantry}</small>}
          </span>
        </label>
        <button type="button" className="qty" aria-label={`Change amount for ${row.name}`} onClick={onOpen}>
          {rowQty(row)}
          {packs && <small>{packs}</small>}
        </button>
      </div>
      {pantry && !row.mark.haveIt && !row.mark.ticked && (
        <div className="subrow">
          <button className="btn ghost wide" type="button" onClick={onHaveIt} aria-label={`Already have ${row.name}`}>
            Already have it
          </button>
        </div>
      )}
      {rest && (
        <div className="subrow row" role="group" aria-label={`Left over ${row.name}`}>
          <button className="btn ghost grow" type="button" onClick={onAddRest}>
            Add the rest to the pantry ({rest})
          </button>
          <button className="btn ghost" type="button" onClick={onNoRest}>
            No thanks
          </button>
        </div>
      )}
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

/**
 * Each store's price for a row: "Coles $16 $16.00/kg · Woolies $14 · Aldi –", a special marked
 * and an old price dated. Nothing when no store has a price (or for a staple).
 */
function PriceLine({ prices }: { prices: ItemStorePrice[] | null }) {
  if (!prices?.some((p) => p.found)) return null
  return (
    <small className="prices" aria-label="Prices">
      {prices.map((p, i) => (
        <Fragment key={p.store}>
          {i > 0 && ' · '}
          <span className="pr">
            {STORE_NAMES[p.store]}{' '}
            {p.found ? <PriceText p={p} /> : '–'}
          </span>
        </Fragment>
      ))}
    </small>
  )
}

function PriceText({ p }: { p: Extract<ItemStorePrice, { found: true }> }) {
  return (
    <>
      <b className="amt">{money(p.cost)}</b>
      {p.onePack && ` (${p.onePack})`}
      {p.special && <span className="spec"> special</span>}
      {p.unit && <span className="unit"> {p.unit}</span>}
      {p.stale && <span className="unit"> · {p.stale}</span>}
    </>
  )
}

/** The item sheet's prices: each store's matched product, so a wrong match can be spotted. */
function PriceDetails({ prices }: { prices: ItemStorePrice[] }) {
  return (
    <div className="stack tight">
      <span className="lab">Prices</span>
      <ul className="pricelist">
        {prices.map((p) => (
          <li key={p.store} className="small">
            <b>{STORE_NAMES[p.store]}</b>{' '}
            {p.found ? (
              <>
                <PriceText p={p} />
                {p.packs > 1 && ` for ${p.packs} × ${money(p.row.price!)}`}
                <br />
                <span className="muted">
                  {p.row.product}
                  {` · ${dayLabel(p.row.seenOn)}`}
                </span>
              </>
            ) : (
              <span className="muted">– no match found</span>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted flat">Wrong product? Tell Claude in chat and it will price it again.</p>
    </div>
  )
}

type IngredientInfo = { pack: Pack | null; shelfDays: number | null }

/**
 * One item: the amount bought, its section, couldn't get it, already have it, its ingredient's
 * pack size and shelf life, and removing a hand-added item.
 */
function ItemSheet({
  row,
  prices,
  offline,
  ingredient,
  onMark,
  onSection,
  onPack,
  onRemove,
  onClose,
}: {
  row?: ShopRow
  prices: ItemStorePrice[] | null
  offline: boolean
  /** The shared ingredient's pack size and shelf life; undefined when the item is not an ingredient. */
  ingredient?: IngredientInfo
  onMark: (change: Partial<Mark>) => void
  onSection: (section: string) => void
  onPack: (values: IngredientInfo) => void
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
        <select id="item-section" className="field" value={row.section} disabled={offline} onChange={(e) => onSection(e.target.value)}>
          {SECTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {offline && <p className="small muted flat">Moving an item needs signal; it changes every list.</p>}
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
      {prices?.some((p) => p.found) && <PriceDetails prices={prices} />}
      {ingredient && <PackFields key={row.key} unit={row.unit} ingredient={ingredient} offline={offline} onSave={onPack} />}
      {row.extra && (
        <button className="btn danger wide" type="button" onClick={onRemove}>
          Remove from list
        </button>
      )}
    </Sheet>
  )
}

/** An ingredient's pack size and shelf life, shared by every household like its section. Blank clears. */
function PackFields({
  unit: itemUnit,
  ingredient,
  offline,
  onSave,
}: {
  unit: string
  ingredient: IngredientInfo
  offline: boolean
  onSave: (values: IngredientInfo) => void
}) {
  const [qty, setQty] = useState(ingredient.pack ? String(ingredient.pack.qty) : '')
  const [unit, setUnit] = useState(ingredient.pack?.unit ?? itemUnit)
  const [days, setDays] = useState(ingredient.shelfDays != null ? String(ingredient.shelfDays) : '')
  const read = readPackForm(qty, unit, days)
  const units: readonly string[] = UNITS.includes(unit as never) ? UNITS : [unit, ...UNITS]
  return (
    <form
      className="stack tight"
      onSubmit={(e) => {
        e.preventDefault()
        if (!('error' in read)) onSave(read)
      }}
    >
      <label className="lab" htmlFor="pack-qty">
        Pack size
      </label>
      <div className="row">
        <input
          id="pack-qty"
          className="field grow"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="Not known"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <select className="field" aria-label="Pack unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <label className="lab" htmlFor="shelf-days">
        Keeps for (days once bought)
      </label>
      <input
        id="shelf-days"
        className="field"
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        placeholder="Not known"
        value={days}
        onChange={(e) => setDays(e.target.value)}
      />
      {'error' in read && (qty || days) && <p className="small warn flat">{read.error}</p>}
      <button className="btn ghost wide" type="submit" disabled={offline || 'error' in read}>
        Save pack size and shelf life
      </button>
      <p className="small muted flat">{offline ? 'Needs signal; it changes every list.' : 'Changes every list. Leave blank to clear.'}</p>
    </form>
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
