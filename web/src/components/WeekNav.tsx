import { addDays, rangeLabel, weekStartOf } from '../lib/week'

/** Previous / next week arrows around the week's dates, tagged this week or next week. */
export function WeekNav({ week, onChange }: { week: string; onChange: (week: string) => void }) {
  const thisWeek = weekStartOf(new Date())
  const tag = week === thisWeek ? 'This week' : week === addDays(thisWeek, 7) ? 'Next week' : ''
  return (
    <div className="weeknav">
      <button className="icon" type="button" aria-label="Previous week" onClick={() => onChange(addDays(week, -7))}>
        ‹
      </button>
      <div className="mid">
        {rangeLabel(week)}
        <small>{tag || ' '}</small>
      </div>
      <button className="icon" type="button" aria-label="Next week" onClick={() => onChange(addDays(week, 7))}>
        ›
      </button>
    </div>
  )
}
