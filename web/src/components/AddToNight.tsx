import { useEffect, useState } from 'react'
import { addToNight, loadWeekMains, type Recipe } from '../lib/recipes'
import { DAY_NAMES, DAYS, dateOf, parseYmd, weekStartOf, type Day } from '../lib/week'
import { Sheet } from './Sheet'
import { WeekNav } from './WeekNav'

/** Sheet to plan a recipe on one night of a week; starts on this week. */
export function AddToNight({
  householdId,
  recipe,
  onAdded,
  onClose,
}: {
  householdId: string
  recipe: Recipe
  onAdded: (nightLabel: string) => void
  onClose: () => void
}) {
  const [week, setWeek] = useState(() => weekStartOf(new Date()))
  const [mains, setMains] = useState<{ week: string; byDay: Partial<Record<Day, string>> }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    loadWeekMains(householdId, week).then(
      (byDay) => live && setMains({ week, byDay }),
      (e: { message?: string }) => live && setError(e.message ?? String(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, week])

  const byDay = mains?.week === week ? mains.byDay : undefined

  const pick = async (day: Day) => {
    setBusy(true)
    setError(undefined)
    try {
      await addToNight(householdId, recipe, week, day)
      onAdded(`${DAY_NAMES[day]} ${parseYmd(dateOf(week, day)).getDate()}`)
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e))
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Add ${recipe.name} to a night`} onClose={onClose}>
      <WeekNav week={week} onChange={setWeek} />
      {error && (
        <p className="small warn flat" role="alert">
          {error}
        </p>
      )}
      <div className="pick">
        {DAYS.map((d) => (
          <button key={d} type="button" disabled={busy} onClick={() => pick(d)}>
            <span>
              <b>
                {DAY_NAMES[d]} {parseYmd(dateOf(week, d)).getDate()}
              </b>{' '}
              <span className="muted small">{byDay ? (byDay[d] ?? 'Nothing planned') : '…'}</span>
            </span>
            <span className="small muted">as {recipe.course}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
