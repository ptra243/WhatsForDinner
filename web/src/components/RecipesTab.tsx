import { useEffect, useState } from 'react'
import { useCanAskClaude } from '../lib/askAccess'
import { addRecipePrompt } from '../lib/claude'
import type { Allergen } from '../lib/allergens'
import { mins } from '../lib/format'
import { loadSettings } from '../lib/plan'
import { loadRecipes, matches, type Course, type Recipe } from '../lib/recipes'
import { comingWeek, likedIds, useCurrentUser, useMemberNames, useVotes, voteSummary, weekWords } from '../lib/votes'
import { AskClaudeButton } from './AskClaude'
import { RecipeView } from './RecipeView'

const COURSES: [Course | 'all', string][] = [
  ['all', 'All'],
  ['main', 'Mains'],
  ['side', 'Sides'],
]

/**
 * The Recipes tab: a ruled sheet of the household's recipes with search, a course filter and a
 * filter to the recipes someone gave 👍 for a week (`likedWeek` turns it on for that week).
 */
export function RecipesTab({ householdId, likedWeek }: { householdId: string; likedWeek?: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>()
  const canAskClaude = useCanAskClaude()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [course, setCourse] = useState<Course | 'all'>('all')
  const [openId, setOpenId] = useState<string>()
  const [avoid, setAvoid] = useState<Allergen[]>([])
  const voteWeek = likedWeek ?? comingWeek()
  const [likedOnly, setLikedOnly] = useState(likedWeek !== undefined)
  const { votes } = useVotes(householdId, voteWeek)
  const names = useMemberNames(householdId)
  const me = useCurrentUser()

  useEffect(() => {
    let live = true
    loadRecipes(householdId).then(
      (rs) => live && setRecipes(rs),
      (e: { message?: string }) => live && setError(e.message ?? String(e)),
    )
    // Only for the allergen warning in the recipe view, so the list shows without it.
    loadSettings(householdId).then(
      (s) => live && setAvoid(s.avoid),
      () => {},
    )
    return () => {
      live = false
    }
  }, [householdId])

  if (error) {
    return (
      <p className="small warn" role="alert">
        Could not load recipes: {error}
      </p>
    )
  }
  if (!recipes) {
    return (
      <p className="muted" role="status">
        Loading recipes…
      </p>
    )
  }
  if (!recipes.length) {
    return (
      <div className="empty-state">
        <h2>No recipes yet</h2>
        <p className="muted">
          Your household’s recipes will show here.{' '}
          {canAskClaude ? 'Paste one or send a photo to Claude to add it.' : 'The household’s owner adds them with Claude.'}
        </p>
        <AskClaudeButton className="btn" prompt={addRecipePrompt()}>
          Add a recipe with Claude
        </AskClaudeButton>
      </div>
    )
  }

  const liked = likedIds(votes ?? [])
  const shown = recipes.filter((r) => matches(r, query, course) && (!likedOnly || liked.has(r.id)))
  const open = recipes.find((r) => r.id === openId)

  return (
    <>
      <input
        className="search"
        type="search"
        aria-label="Search recipes"
        placeholder={`Search ${recipes.length} recipes`}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chips">
        {COURSES.map(([c, label]) => (
          <button key={c} type="button" className="chip" aria-pressed={course === c} onClick={() => setCourse(c)}>
            {label}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={likedOnly} onClick={() => setLikedOnly(!likedOnly)}>
          👍 {weekWords(voteWeek)}
        </button>
      </div>
      <div className="paper reclist">
        {shown.length ? (
          shown.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              votes={likedOnly && votes ? voteSummary(votes, r.id, me, names) : ''}
              onOpen={() => setOpenId(r.id)}
            />
          ))
        ) : (
          <p className="muted">{likedOnly && !liked.size ? `No 👍 ${weekWords(voteWeek)} yet.` : 'No recipes match.'}</p>
        )}
      </div>
      {open && (
        <RecipeView
          key={open.id}
          householdId={householdId}
          recipe={open}
          avoid={avoid}
          onChange={(next) => setRecipes(recipes.map((r) => (r.id === next.id ? next : r)))}
          onDeleted={() => {
            setOpenId(undefined)
            setRecipes(recipes.filter((r) => r.id !== open.id))
          }}
          onClose={() => setOpenId(undefined)}
        />
      )}
    </>
  )
}

/** A recipe on the sheet; `votes` is who voted what, shown when filtering by votes. */
function RecipeRow({ recipe: r, votes, onOpen }: { recipe: Recipe; votes?: string; onOpen: () => void }) {
  const meta = [
    r.activeMins ? `${r.activeMins} min hands-on` : '',
    r.totalMins ? `${mins(r.totalMins)} total` : '',
  ].filter(Boolean)
  return (
    <button type="button" className="rec" onClick={onOpen}>
      <span className="t">
        <span>{r.name}</span>
        <span className="row">
          {r.course === 'side' && <span className="pill">Side</span>}
          {r.isExample && <span className="pill ex">Example</span>}
        </span>
      </span>
      <span className="m">
        {meta.join(' · ')}
        {r.rating ? (
          <>
            {meta.length ? ' · ' : ''}
            <span className="stars" aria-label={`${r.rating} stars`}>
              {'★'.repeat(r.rating)}
            </span>
          </>
        ) : null}
      </span>
      {votes && <span className="m">{votes}</span>}
    </button>
  )
}
