// Votes on candidate dinners (#17): each member's 👍 / 👎 on a recipe for a week. Members see
// everyone's votes and write only their own (docs/data-model.md). Claude reads them when planning.
import { createContext, useContext, useEffect, useState } from 'react'
import { loadMembers } from './invites'
import { supabase } from './supabase'
import { addDays, dayLabel, weekStartOf } from './week'

export type VoteValue = 1 | -1
export type Vote = { recipeId: string; userId: string; vote: VoteValue }

/** The signed-in user's id, for telling their own votes from the others'. */
export const CurrentUser = createContext('')
export const useCurrentUser = () => useContext(CurrentUser)

/** The week votes are for unless switched: the coming one, next Monday's. */
export const comingWeek = (now = new Date()) => addDays(weekStartOf(now), 7)

/** "this week", "next week" or "for 16 Nov". */
export function weekWords(week: string, now = new Date()): string {
  const thisWeek = weekStartOf(now)
  if (week === thisWeek) return 'this week'
  if (week === addDays(thisWeek, 7)) return 'next week'
  return `for ${dayLabel(week)}`
}

/** The vote after tapping 👍 or 👎: the same vote again clears it. */
export const nextVote = (current: VoteValue | undefined, tapped: VoteValue): VoteValue | null =>
  current === tapped ? null : tapped

/** A member's short name: what comes before the @ in their email, capitalised ("sam@…" → "Sam"). */
export function memberName(email: string): string {
  const name = email.split('@')[0].split(/[._+-]/)[0] || email
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Who voted what on a recipe, the caller first: "👍 you · 👎 Sam". Empty with no votes. */
export function voteSummary(votes: Vote[], recipeId: string, me: string, names: Map<string, string>): string {
  return votes
    .filter((v) => v.recipeId === recipeId)
    .sort((a, b) => Number(b.userId === me) - Number(a.userId === me))
    .map((v) => `${v.vote === 1 ? '👍' : '👎'} ${v.userId === me ? 'you' : (names.get(v.userId) ?? 'someone')}`)
    .join(' · ')
}

/** Recipes with a 👍 from anyone. */
export const likedIds = (votes: Vote[]) => new Set(votes.filter((v) => v.vote === 1).map((v) => v.recipeId))

/** How many recipes got a 👍 and how many a 👎 (a recipe with both counts in each). */
export function tally(votes: Vote[]): { liked: number; not: number } {
  return { liked: likedIds(votes).size, not: new Set(votes.filter((v) => v.vote === -1).map((v) => v.recipeId)).size }
}

/** "4 liked, 1 not next week"; empty with no votes. */
export function tallyText(votes: Vote[], week: string, now = new Date()): string {
  const t = tally(votes)
  if (!t.liked && !t.not) return ''
  const parts = [t.liked ? `${t.liked} liked` : '', t.not ? `${t.not} not` : ''].filter(Boolean)
  return `${parts.join(', ')} ${weekWords(week, now)}`
}

export async function loadVotes(householdId: string, week: string): Promise<Vote[]> {
  const { data, error } = await supabase
    .from('recipe_votes')
    .select('recipe_id, user_id, vote')
    .eq('household_id', householdId)
    .eq('week_start', week)
    .order('created_at')
  if (error) throw error
  return data.map((v) => ({ recipeId: v.recipe_id, userId: v.user_id, vote: v.vote === 1 ? 1 : -1 }))
}

/** Sets the caller's vote on a recipe for the week, or clears it with null. */
export async function saveVote(householdId: string, week: string, recipeId: string, userId: string, vote: VoteValue | null) {
  const key = { household_id: householdId, week_start: week, recipe_id: recipeId, user_id: userId }
  const { error } =
    vote === null
      ? await supabase.from('recipe_votes').delete().match(key)
      : await supabase.from('recipe_votes').upsert({ ...key, vote })
  if (error) throw error
}

let channels = 0

/** Calls `onChange` whenever a vote changes, from any member. Returns the unsubscribe. */
export function subscribeVotes(householdId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`votes-${householdId}-${++channels}`)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_votes' }, onChange)
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * The household's votes for a week, kept live, and a setter that shows the change straight
 * away. `loadError` says why the last load failed; `saveError` why the last save did, and stays
 * up through the reload that puts the vote back, until the next save works.
 */
export function useVotes(householdId: string, week: string) {
  const me = useCurrentUser()
  const [state, setState] = useState<{ week: string; votes: Vote[] }>()
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    loadVotes(householdId, week).then(
      (votes) => {
        if (!live) return
        setState({ week, votes })
        setLoadError(undefined)
      },
      (e: { message?: string }) => live && setLoadError(e.message ?? String(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, week, version])

  useEffect(() => subscribeVotes(householdId, () => setVersion((v) => v + 1)), [householdId])

  const votes = state?.week === week ? state.votes : undefined

  const vote = async (recipeId: string, tapped: VoteValue) => {
    const current = votes?.find((v) => v.recipeId === recipeId && v.userId === me)?.vote
    const next = nextVote(current, tapped)
    const others = (votes ?? []).filter((v) => !(v.recipeId === recipeId && v.userId === me))
    setState({ week, votes: next === null ? others : [...others, { recipeId, userId: me, vote: next }] })
    try {
      await saveVote(householdId, week, recipeId, me, next)
      setSaveError(undefined)
    } catch (e) {
      setSaveError((e as { message?: string }).message ?? String(e))
      setVersion((v) => v + 1)
    }
  }

  return { votes, loadError, saveError, vote }
}

/** Members' short names by user id, for "👎 Sam". */
export function useMemberNames(householdId: string): Map<string, string> {
  const [names, setNames] = useState(new Map<string, string>())
  useEffect(() => {
    let live = true
    loadMembers(householdId).then(
      (ms) => live && setNames(new Map(ms.map((m) => [m.userId, memberName(m.email)]))),
      () => {},
    )
    return () => {
      live = false
    }
  }, [householdId])
  return names
}
