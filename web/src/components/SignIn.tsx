import { useEffect, useState, type FormEvent } from 'react'
import { appUrl } from '../config'
import { clearPendingInvite, INVITE_PROBLEM, inviteInfo, inviteUrl, pendingInvite, type InviteStatus } from '../lib/invites'
import { supabase } from '../lib/supabase'

/**
 * Sign-in screen: emails a magic link that returns to this app. Opened from an invite link, it
 * says which household it is for, and the magic link keeps the invite so signing in joins it.
 */
export function SignIn() {
  const [invite] = useState(pendingInvite)
  const [inviteState, setInviteState] = useState<{ householdName?: string; status: InviteStatus }>()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!invite) return
    let live = true
    inviteInfo(invite).then(
      (info) => {
        if (!live) return
        setInviteState(info)
        // A link that cannot be used is dropped, so signing in carries on as usual.
        if (info.status !== 'open') clearPendingInvite()
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [invite])

  const joining = invite && inviteState?.status === 'open' ? invite : undefined

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setError(undefined)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: joining ? inviteUrl(joining) : appUrl() },
    })
    if (error) {
      setError(error.message)
      setStatus('idle')
    } else {
      setStatus('sent')
    }
  }

  return (
    <main>
      <div className="wrap sign-in">
        <h1>What’s for Dinner</h1>
        {inviteState &&
          (inviteState.status === 'open' ? (
            <p className="card" role="status">
              You’ve been invited to <strong>{inviteState.householdName}</strong>. Sign in with your email to join.
            </p>
          ) : (
            <p className="card warn" role="alert">
              {INVITE_PROBLEM[inviteState.status]} Ask for a new one, or sign in as usual.
            </p>
          ))}
        {status === 'sent' ? (
          <div className="card stack">
            <h2>Check your email</h2>
            <p className="muted">
              We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to sign in.
            </p>
            <button className="btn quiet" type="button" onClick={() => setStatus('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="card stack" onSubmit={send}>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="field"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && (
              <p className="small warn" role="alert">
                {error}
              </p>
            )}
            <button className="btn wide" type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
