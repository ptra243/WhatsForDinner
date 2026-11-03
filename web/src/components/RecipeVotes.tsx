import { useState } from 'react'
import { comingWeek, useCurrentUser, useMemberNames, useVotes, voteSummary, weekWords, type VoteValue } from '../lib/votes'
import { weekStartOf } from '../lib/week'

/**
 * 👍 / 👎 on a recipe for the coming week, with a switch to this week. Tapping the same vote
 * again clears it. Shows who voted what, and other members' votes as they change.
 */
export function RecipeVotes({ householdId, recipeId }: { householdId: string; recipeId: string }) {
  const me = useCurrentUser()
  const [week, setWeek] = useState(() => comingWeek())
  const { votes, error, vote } = useVotes(householdId, week)
  const names = useMemberNames(householdId)
  const mine = votes?.find((v) => v.recipeId === recipeId && v.userId === me)?.vote
  const summary = votes ? voteSummary(votes, recipeId, me, names) : ''
  const weeks: [string, string][] = [
    [comingWeek(), 'Next week'],
    [weekStartOf(new Date()), 'This week'],
  ]

  const button = (value: VoteValue, face: string, label: string) => (
    <button
      type="button"
      className="chip vote"
      aria-label={`${label} ${weekWords(week)}`}
      aria-pressed={mine === value}
      disabled={!votes}
      onClick={() => vote(recipeId, value)}
    >
      {face}
    </button>
  )

  return (
    <section className="card stack tight" aria-label="Votes">
      <div className="row spread">
        <span className="label">Want it {weekWords(week)}?</span>
        <span className="row" role="group" aria-label="Week to vote for">
          {weeks.map(([w, label]) => (
            <button key={w} type="button" className="chip small" aria-pressed={week === w} onClick={() => setWeek(w)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      <div className="row">
        {button(1, '👍', 'Like it')}
        {button(-1, '👎', 'Not')}
        <span className="small muted" aria-live="polite">
          {summary || (votes ? 'No votes yet' : '')}
        </span>
      </div>
      {error && (
        <p className="small warn flat" role="alert">
          Could not save the vote: {error}
        </p>
      )}
    </section>
  )
}
