import { useEffect, useState } from 'react'
import { clearCookSession, latestCookSession } from '../lib/cookSession'
import { loadRecipes, type Recipe } from '../lib/recipes'
import { showToast } from '../lib/toast'
import { CookMode } from './CookMode'

/**
 * Reopens cook mode when the app loads with an unfinished cook saved on this device (the phone
 * reloaded the tab while it was in the background). Rendered once, by the app shell, over
 * whichever tab is showing.
 */
export function ResumeCook({ householdId }: { householdId: string }) {
  const [session, setSession] = useState(() => latestCookSession(householdId))
  const [recipe, setRecipe] = useState<Recipe>()

  useEffect(() => {
    if (!session) return
    let live = true
    // The same read the tabs make, so with no signal it is answered from the service worker's copy.
    loadRecipes(householdId).then(
      (rs) => {
        if (!live) return
        const r = rs.find((x) => x.id === session.recipeId)
        if (r) return setRecipe(r)
        // The recipe was deleted: nothing to cook.
        clearCookSession(session)
        setSession(undefined)
      },
      // Not loaded: the session stays for the next load, until it is too old.
      () => {},
    )
    return () => {
      live = false
    }
  }, [householdId, session])

  if (!session || !recipe) return null
  return (
    <CookMode
      householdId={householdId}
      recipe={recipe}
      servings={session.servings}
      methodId={session.methodId}
      extras={session.extras}
      resume={session}
      onChange={setRecipe}
      onExit={() => setSession(undefined)}
      onDone={(message) => {
        setSession(undefined)
        showToast(message)
      }}
    />
  )
}
