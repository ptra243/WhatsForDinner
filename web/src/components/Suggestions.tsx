import { useState } from 'react'
import { useCanAskClaude } from '../lib/askAccess'
import { refineAllPrompt, refineSuggestionPrompt } from '../lib/claude'
import {
  addSuggestion,
  canEdit,
  cleanSuggestion,
  deleteSuggestion,
  openOnes,
  statusWord,
  updateSuggestion,
  useSuggestions,
  type Suggestion,
} from '../lib/suggestions'
import { useCurrentUser, useMemberNames } from '../lib/votes'
import { AskClaudeButton } from './AskClaude'
import { Sheet } from './Sheet'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

/**
 * Suggest a dinner, and the household's suggestions: a row of two buttons on the Week and
 * Recipes tabs. The owner sees how many are left to refine and refines them with Claude; an
 * added one opens its recipe (`onOpenRecipe`), where its votes are. Updates live.
 */
export function Suggestions({ householdId, onOpenRecipe }: { householdId: string; onOpenRecipe: (recipeId: string) => void }) {
  const { suggestions, error, reload } = useSuggestions(householdId)
  const canAskClaude = useCanAskClaude()
  const [listOpen, setListOpen] = useState(false)
  // The suggestion being edited, or 'new' while suggesting one.
  const [editing, setEditing] = useState<Suggestion | 'new'>()
  const open = openOnes(suggestions ?? []).length
  const count = suggestions?.length ?? 0

  return (
    <>
      <div className="row suggest-bar">
        <button type="button" className="btn ghost grow" onClick={() => setEditing('new')}>
          Suggest a dinner
        </button>
        {(count > 0 || error) && (
          <button type="button" className="btn quiet" onClick={() => setListOpen(true)}>
            {canAskClaude && open ? (
              <span className="pill badge">{open} to refine</span>
            ) : (
              `Suggestions${count ? ` (${count})` : ''}`
            )}
          </button>
        )}
      </div>
      {listOpen && (
        <SuggestionList
          suggestions={suggestions ?? []}
          error={error}
          householdId={householdId}
          onSuggest={() => setEditing('new')}
          onEdit={setEditing}
          onDeleted={reload}
          onOpenRecipe={(id) => {
            setListOpen(false)
            onOpenRecipe(id)
          }}
          onClose={() => setListOpen(false)}
        />
      )}
      {editing && (
        <SuggestionForm
          householdId={householdId}
          editing={editing === 'new' ? undefined : editing}
          onSaved={() => {
            setEditing(undefined)
            reload()
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  )
}

function SuggestionList({
  suggestions,
  error,
  householdId,
  onSuggest,
  onEdit,
  onDeleted,
  onOpenRecipe,
  onClose,
}: {
  suggestions: Suggestion[]
  error?: string
  householdId: string
  onSuggest: () => void
  onEdit: (s: Suggestion) => void
  onDeleted: () => void
  onOpenRecipe: (recipeId: string) => void
  onClose: () => void
}) {
  const me = useCurrentUser()
  const names = useMemberNames(householdId)
  const [confirming, setConfirming] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const open = openOnes(suggestions).length
  const who = (s: Suggestion) => (s.createdBy === me ? 'you' : s.createdBy ? (names.get(s.createdBy) ?? 'someone') : 'a past member')

  const remove = async (s: Suggestion) => {
    setConfirming(undefined)
    try {
      await deleteSuggestion(s.id)
      setFailed(undefined)
    } catch (e) {
      setFailed(`Could not delete “${s.name}”: ${errorText(e)}`)
    }
    onDeleted()
  }

  return (
    <Sheet title="Suggestions" onClose={onClose}>
      {error && (
        <p className="small warn flat" role="alert">
          Could not load suggestions: {error}
        </p>
      )}
      {failed && (
        <p className="small warn flat" role="alert">
          {failed}
        </p>
      )}
      {open > 0 && (
        <AskClaudeButton className="btn wide" prompt={refineAllPrompt()}>
          Refine all with Claude ({open} open)
        </AskClaudeButton>
      )}
      <ul className="suggestions">
        {suggestions.map((s) => (
          <li key={s.id} className="card stack tight">
            <div className="row spread">
              <b className="grow">{s.name}</b>
              <span className={`pill${s.status === 'open' ? '' : ' ex'}`}>{statusWord(s.status)}</span>
            </div>
            {s.description && <Description text={s.description} />}
            <span className="small muted">Suggested by {who(s)}</span>
            {s.reply && <span className="small reply">Claude: {s.reply}</span>}
            {confirming === s.id ? (
              <div className="row wrap-row">
                <span className="small">Delete this suggestion?</span>
                <button type="button" className="btn danger" onClick={() => remove(s)}>
                  Delete
                </button>
                <button type="button" className="btn quiet" onClick={() => setConfirming(undefined)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="row wrap-row">
                {s.status === 'added' && s.recipeId && (
                  <button type="button" className="btn ghost" onClick={() => onOpenRecipe(s.recipeId!)}>
                    Open the recipe
                  </button>
                )}
                {s.status === 'open' && (
                  <AskClaudeButton className="btn ghost" prompt={refineSuggestionPrompt(s.name, s.description, s.id)}>
                    Refine this
                  </AskClaudeButton>
                )}
                {canEdit(s, me) && (
                  <>
                    <button type="button" className="btn quiet" onClick={() => onEdit(s)}>
                      Edit
                    </button>
                    <button type="button" className="btn quiet warn" onClick={() => setConfirming(s.id)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!suggestions.length && !error && <p className="muted flat">No suggestions in the last two weeks.</p>}
      <button type="button" className="btn ghost wide" onClick={onSuggest}>
        Suggest a dinner
      </button>
    </Sheet>
  )
}

/** A suggestion's description, with any web link in it tappable. */
function Description({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/)
  return (
    <span className="small desc">
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </span>
  )
}

function SuggestionForm({
  householdId,
  editing,
  onSaved,
  onClose,
}: {
  householdId: string
  editing?: Suggestion
  onSaved: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string>()
  const clean = cleanSuggestion(name, description)

  const save = async () => {
    if (!clean) return
    setSaving(true)
    try {
      if (editing) await updateSuggestion(editing.id, clean.name, clean.description)
      else await addSuggestion(householdId, clean.name, clean.description)
      onSaved()
    } catch (e) {
      setFailed(errorText(e))
      setSaving(false)
    }
  }

  return (
    <Sheet title={editing ? 'Edit suggestion' : 'Suggest a dinner'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label className="lab" htmlFor="suggest-name">
          Dish
        </label>
        <input
          id="suggest-name"
          className="field"
          placeholder="e.g. Beef pho"
          autoComplete="off"
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="lab" htmlFor="suggest-description">
          Description (optional)
        </label>
        <textarea
          id="suggest-description"
          className="field"
          placeholder="What it is, or a link to the recipe"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {failed && (
          <p className="small warn flat" role="alert">
            Could not save: {failed}
          </p>
        )}
        <button className="btn wide" type="submit" disabled={!clean || saving}>
          {editing ? 'Save' : 'Suggest it'}
        </button>
      </form>
    </Sheet>
  )
}
