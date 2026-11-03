import { useEffect, useState } from 'react'
import {
  cancelInvite,
  createInvite,
  loadMembers,
  loadOpenInvites,
  removeMember,
  shareInvite,
  type Member,
  type OpenInvite,
} from '../lib/invites'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * The settings sheet's Household section: who is in it, and for the owner, inviting someone,
 * open invites (to cancel) and removing members. A member can leave; `onLeft` runs after.
 */
export function HouseholdMembers({
  householdId,
  userId,
  isOwner,
  onLeft,
}: {
  householdId: string
  userId: string
  isOwner: boolean
  onLeft: () => void
}) {
  const [members, setMembers] = useState<Member[]>()
  const [invites, setInvites] = useState<OpenInvite[]>([])
  const [link, setLink] = useState<string>()
  const [confirm, setConfirm] = useState<Member>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all([loadMembers(householdId), isOwner ? loadOpenInvites(householdId) : []]).then(
      ([m, i]) => {
        if (!live) return
        setMembers(m)
        setInvites(i)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, isOwner, version])

  /** Runs `action`, then reloads the list; shows the error if it failed. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await action()
      setVersion((v) => v + 1)
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }

  const invite = () =>
    run(async () => {
      const url = await createInvite(householdId)
      setLink(url)
      await share(url)
    })

  const share = async (url: string) => {
    const result = await shareInvite(url)
    setNotice(
      result === 'shared'
        ? 'Invite sent. It works once, for 7 days.'
        : result === 'copied'
          ? 'Invite link copied. Send it to them; it works once, for 7 days.'
          : 'Copy this link and send it to them; it works once, for 7 days.',
    )
  }

  const remove = (m: Member) =>
    run(async () => {
      await removeMember(householdId, m.userId)
      setConfirm(undefined)
      if (m.userId === userId) onLeft()
    })

  const me = members?.find((m) => m.userId === userId)

  return (
    <>
      <h3 className="label flat">Household</h3>
      {error && (
        <p className="warn small flat" role="alert">
          {error}
        </p>
      )}
      {!members ? (
        !error && (
          <p className="small muted flat" role="status">
            Loading members…
          </p>
        )
      ) : (
        <ul className="members" aria-label="Members">
          {members.map((m) => (
            <li key={m.userId} className="row">
              <span className="grow">
                <b>{m.email}</b>
                {m.userId === userId && ' (you)'}
                <small className="muted"> {m.role}</small>
              </span>
              {isOwner && m.role === 'member' && (
                <button className="btn quiet warn" type="button" disabled={busy} onClick={() => setConfirm(m)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <div className="card stack confirm">
          <b>{confirm.userId === userId ? 'Leave this household?' : `Remove ${confirm.email}?`}</b>
          <span className="small">
            {confirm.userId === userId
              ? 'You’ll stop seeing its week, list and recipes, and start a household of your own.'
              : 'They’ll stop seeing the week, list and recipes. You can invite them again.'}
          </span>
          <div className="row">
            <button className="btn danger grow" type="button" disabled={busy} onClick={() => remove(confirm)}>
              {confirm.userId === userId ? 'Leave' : 'Remove'}
            </button>
            <button className="btn ghost grow" type="button" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {isOwner && invites.length > 0 && (
        <ul className="members" aria-label="Open invites">
          {invites.map((i) => (
            <li key={i.id} className="row">
              <span className="grow small">Open invite, until {day(i.expiresAt)}</span>
              <button className="btn quiet warn" type="button" disabled={busy} onClick={() => run(() => cancelInvite(i.id))}>
                Cancel invite
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="small muted flat" role="status">
          {notice}
        </p>
      )}
      {link && (
        <div className="row">
          <input className="field grow" readOnly aria-label="Invite link" value={link} onFocus={(e) => e.target.select()} />
          <button className="btn ghost" type="button" onClick={() => share(link)}>
            Share
          </button>
        </div>
      )}
      {isOwner ? (
        <button className="btn ghost wide" type="button" disabled={busy || !members} onClick={invite}>
          Invite someone
        </button>
      ) : (
        me &&
        !confirm && (
          <button className="btn quiet warn" type="button" disabled={busy} onClick={() => setConfirm(me)}>
            Leave household
          </button>
        )
      )}
    </>
  )
}
