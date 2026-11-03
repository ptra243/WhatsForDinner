// Dinner suggestions (#18): any member suggests a dinner by name; the owner refines open ones
// into recipes through Claude, which sets the status, a one-line reply and the recipe
// (docs/data-model.md). Members edit or delete only their own open ones.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type SuggestionStatus = 'open' | 'added' | 'declined'
export type Suggestion = {
  id: string
  createdBy: string | null
  name: string
  description: string
  status: SuggestionStatus
  reply: string
  recipeId: string | null
  createdAt: string
}

/** How long a handled (added or declined) suggestion stays on the list. */
export const HANDLED_DAYS = 14

const STATUSES: readonly string[] = ['open', 'added', 'declined']

/** The earliest handled_at still shown: two weeks back. */
export const shownSince = (now = new Date()) => new Date(now.getTime() - HANDLED_DAYS * 86_400_000).toISOString()

/** Open suggestions, the oldest first: what the owner has left to refine. */
export const openOnes = (list: Suggestion[]) => list.filter((s) => s.status === 'open')

/** Whether the caller can edit or delete this one: their own, still open. */
export const canEdit = (s: Suggestion, me: string) => s.status === 'open' && s.createdBy === me

/** "Open", "Added" or "Declined". */
export const statusWord = (s: SuggestionStatus) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The household's suggestions: every open one, and handled ones from the last two weeks (older
 * ones are kept in the database, just not shown). Open ones first, then newest first.
 */
export async function loadSuggestions(householdId: string, now = new Date()): Promise<Suggestion[]> {
  const { data, error } = await supabase
    .from('suggestions')
    .select('id, created_by, name, description, status, reply, recipe_id, created_at')
    .eq('household_id', householdId)
    .or(`status.eq.open,handled_at.gte.${shownSince(now)}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  const list = data.map((s) => ({
    id: s.id,
    createdBy: s.created_by,
    name: s.name,
    description: s.description,
    status: (STATUSES.includes(s.status) ? s.status : 'open') as SuggestionStatus,
    reply: s.reply,
    recipeId: s.recipe_id,
    createdAt: s.created_at,
  }))
  return [...openOnes(list), ...list.filter((s) => s.status !== 'open')]
}

/** A suggestion's name and description, trimmed; null when the name is empty. */
export function cleanSuggestion(name: string, description: string): { name: string; description: string } | null {
  const n = name.trim()
  return n ? { name: n, description: description.trim() } : null
}

export async function addSuggestion(householdId: string, name: string, description: string) {
  const { error } = await supabase.from('suggestions').insert({ household_id: householdId, name, description })
  if (error) throw error
}

/** Changes the name and description of the caller's own open suggestion. */
export async function updateSuggestion(id: string, name: string, description: string) {
  const { data, error } = await supabase.from('suggestions').update({ name, description }).eq('id', id).select('id')
  if (error) throw error
  if (!data.length) throw new Error('It has already been refined, so it can’t be changed')
}

/** Deletes the caller's own open suggestion. */
export async function deleteSuggestion(id: string) {
  const { data, error } = await supabase.from('suggestions').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data.length) throw new Error('It has already been refined, so it can’t be deleted')
}

let channels = 0

/** Calls `onChange` whenever a suggestion changes, from a member or Claude. Returns the unsubscribe. */
export function subscribeSuggestions(householdId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`suggestions-${householdId}-${++channels}`)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'suggestions' }, onChange)
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

/** The household's shown suggestions, kept live; `reload` loads them again after a save. */
export function useSuggestions(householdId: string) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    loadSuggestions(householdId).then(
      (list) => {
        if (!live) return
        setSuggestions(list)
        setError(undefined)
      },
      (e: { message?: string }) => live && setError(e.message ?? String(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, version])

  useEffect(() => subscribeSuggestions(householdId, () => setVersion((v) => v + 1)), [householdId])

  return { suggestions, error, reload: () => setVersion((v) => v + 1) }
}
