import { useEffect, useState } from 'react'
import {
  clearExamples,
  countExamples,
  DEFAULT_HOUSEHOLD_SETTINGS,
  downloadJson,
  exportHousehold,
  loadHouseholdSettings,
  parseEquipment,
  saveHouseholdSettings,
} from '../lib/household'
import type { MealRule } from '../lib/plan'
import { supabase } from '../lib/supabase'
import { DAY_NAMES, DAYS, ymd, type Day } from '../lib/week'
import { Sheet } from './Sheet'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

/**
 * Household settings (what Claude plans with and what the week checks), the JSON export,
 * clearing the example recipes, and signing out. `onChanged` runs after a save or a clear.
 */
export function SettingsSheet({
  householdId,
  email,
  onChanged,
  onClose,
}: {
  householdId: string
  email: string
  onChanged: () => void
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [notes, setNotes] = useState('')
  const [equipment, setEquipment] = useState('')
  const [dinnerTime, setDinnerTime] = useState(DEFAULT_HOUSEHOLD_SETTINGS.dinnerTime)
  const [minutes, setMinutes] = useState<Record<Day, string>>(
    () => Object.fromEntries(DAYS.map((d) => [d, String(DEFAULT_HOUSEHOLD_SETTINGS.minutes[d])])) as Record<Day, string>,
  )
  const [mealRule, setMealRule] = useState<MealRule>(DEFAULT_HOUSEHOLD_SETTINGS.mealRule)
  const [examples, setExamples] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState<'save' | 'export' | 'clear'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let live = true
    Promise.all([loadHouseholdSettings(householdId), countExamples(householdId)]).then(
      ([s, n]) => {
        if (!live) return
        setNotes(s.notes)
        setEquipment(s.equipment.join(', '))
        setDinnerTime(s.dinnerTime)
        setMinutes(Object.fromEntries(DAYS.map((d) => [d, String(s.minutes[d])])) as Record<Day, string>)
        setMealRule(s.mealRule)
        setExamples(n)
        setLoaded(true)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId])

  const save = async () => {
    setBusy('save')
    setError(undefined)
    try {
      await saveHouseholdSettings(householdId, {
        notes: notes.trim(),
        equipment: parseEquipment(equipment),
        dinnerTime: /^\d\d:\d\d$/.test(dinnerTime) ? dinnerTime : DEFAULT_HOUSEHOLD_SETTINGS.dinnerTime,
        minutes: Object.fromEntries(
          DAYS.map((d) => {
            const v = Number(minutes[d])
            return [d, minutes[d].trim() !== '' && v >= 0 ? Math.round(v) : DEFAULT_HOUSEHOLD_SETTINGS.minutes[d]]
          }),
        ) as Record<Day, number>,
        mealRule,
      })
      onChanged()
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(undefined)
    }
  }

  const exportData = async () => {
    setBusy('export')
    setError(undefined)
    setNotice(undefined)
    try {
      downloadJson(`whats-for-dinner-${ymd(new Date())}.json`, await exportHousehold(householdId))
      setNotice('Export downloaded')
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(undefined)
  }

  const clear = async () => {
    setBusy('clear')
    setError(undefined)
    setNotice(undefined)
    try {
      const n = await clearExamples(householdId)
      setExamples(0)
      setConfirmClear(false)
      setNotice(`Removed ${n} example ${n === 1 ? 'recipe' : 'recipes'}`)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(undefined)
  }

  return (
    <Sheet title="Household settings" onClose={onClose}>
      <p className="small muted flat">Claude uses these when planning.</p>
      {error && (
        <p className="warn small flat" role="alert">
          {error}
        </p>
      )}
      <div className="stack tight">
        <label className="lab" htmlFor="hs-notes">
          Preferences
        </label>
        <textarea
          id="hs-notes"
          className="field"
          placeholder="e.g. keep curries mild, no mushrooms"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="stack tight">
        <label className="lab" htmlFor="hs-equipment">
          Equipment
        </label>
        <input
          id="hs-equipment"
          className="field"
          placeholder="e.g. pressure cooker, slow cooker"
          autoComplete="off"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
        />
      </div>
      <div className="stack tight">
        <label className="lab" htmlFor="hs-time">
          Dinner time
        </label>
        <input id="hs-time" className="field" type="time" value={dinnerTime} onChange={(e) => setDinnerTime(e.target.value)} />
      </div>
      <fieldset className="stack tight plain">
        <legend className="lab">Hands-on minutes per night</legend>
        <div className="minutes">
          {DAYS.map((d) => (
            <div className="stack tight" key={d}>
              <label className="small" htmlFor={`hs-m-${d}`}>
                {DAY_NAMES[d]}
              </label>
              <input
                id={`hs-m-${d}`}
                className="field"
                type="number"
                inputMode="numeric"
                min="0"
                step="5"
                value={minutes[d]}
                onChange={(e) => setMinutes((m) => ({ ...m, [d]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="stack tight">
        <label className="lab" htmlFor="hs-rule">
          Every night needs
        </label>
        <select id="hs-rule" className="field" value={mealRule} onChange={(e) => setMealRule(e.target.value as MealRule)}>
          <option value="veg+carb">A vegetable and a carb</option>
          <option value="veg">A vegetable (carb optional)</option>
          <option value="off">No check</option>
        </select>
      </div>
      <button className="btn wide" type="button" disabled={!loaded || !!busy} onClick={save}>
        {busy === 'save' ? 'Saving…' : 'Save settings'}
      </button>

      <h3 className="label flat">Your data</h3>
      {notice && (
        <p className="small muted flat" role="status">
          {notice}
        </p>
      )}
      <p className="small muted flat">There are no automatic backups, so export now and then to keep a copy.</p>
      <button className="btn ghost wide" type="button" disabled={!!busy} onClick={exportData}>
        {busy === 'export' ? 'Exporting…' : 'Export all data'}
      </button>
      {examples > 0 &&
        (confirmClear ? (
          <div className="card stack confirm">
            <b>
              Delete {examples} example {examples === 1 ? 'recipe' : 'recipes'}?
            </b>
            <span className="small">They also come off any nights they are planned on. Your own recipes stay.</span>
            <div className="row">
              <button className="btn danger grow" type="button" disabled={!!busy} onClick={clear}>
                Delete examples
              </button>
              <button className="btn ghost grow" type="button" onClick={() => setConfirmClear(false)}>
                Keep them
              </button>
            </div>
          </div>
        ) : (
          <button className="btn quiet warn" type="button" onClick={() => setConfirmClear(true)}>
            Clear example recipes
          </button>
        ))}

      <p className="small muted flat">Signed in as {email}</p>
      <button className="btn ghost wide" type="button" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </Sheet>
  )
}
