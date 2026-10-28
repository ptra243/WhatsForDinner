import { useState, type FormEvent } from 'react'
import { appUrl } from '../config'
import { supabase } from '../lib/supabase'

/** Sign-in screen: emails a magic link that returns to this app. */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string>()

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setError(undefined)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: appUrl() },
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
