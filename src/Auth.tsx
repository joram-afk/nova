import { useState } from 'react'
import { supabase } from './lib/supabase'
import { LoadButton } from './Spinner'

const EXISTS = 'This email already has an account. Please sign in instead.'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [signUp, setSignUp] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(''); setInfo('')
    const mail = email.trim().toLowerCase()
    if (signUp && password !== confirm) { setError('Passwords do not match.'); return }
    const { data, error } = signUp
      ? await supabase.auth.signUp({ email: mail, password })
      : await supabase.auth.signInWithPassword({ email: mail, password })
    if (error) { setError(/already|registered/i.test(error.message) ? EXISTS : error.message); return }
    // Supabase hides duplicates by returning a user with no identities.
    if (signUp && data.user && (data.user.identities?.length ?? 0) === 0) { setError(EXISTS); return }
    if (signUp && !data.session) setInfo('Please check your email to confirm your account,.')
  }
  const ready = Boolean(email.trim()) && password.length >= 6 && (!signUp || confirm.length >= 6)
  async function run() {
    if (busy || !ready) return
    setBusy(true)
    try { await submit() } finally { setBusy(false) }
  }
  async function forgot() {
    setError(''); setInfo('')
    const mail = email.trim().toLowerCase()
    if (!mail) { setError('No email input.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: window.location.origin })
    if (error) setError(error.message)
    else setInfo('email sent.')
  }
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void run() }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand-icon">N</div>
        <h2>{signUp ? 'Create account' : 'Nova Copilot'}</h2>
        <input className="field" type="email" placeholder="Email" autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)} onKeyDown={enter} />
        <input className="field" type={show ? 'text' : 'password'} placeholder="Password (6+ characters)"
          autoComplete={signUp ? 'new-password' : 'current-password'}
          value={password} onChange={e => setPassword(e.target.value)} onKeyDown={enter} />
        {signUp && (
          <input className="field" type={show ? 'text' : 'password'} placeholder="Confirm password" autoComplete="new-password"
            value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={enter} />
        )}
        <div className="authrow">
          <label className="showpw"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password</label>
          <LoadButton className="link-btn forgot" onClick={forgot}>Forgot password?</LoadButton>
        </div>
        {error && <div className="error">{error}</div>}
        {info && <div className="ok">{info}</div>}
        <LoadButton className="start-button wide" loading={busy} disabled={!ready} onClick={run}>{signUp ? 'Sign up' : 'Sign in'}</LoadButton>
        <button className="link-btn" onClick={() => { setSignUp(!signUp); setError(''); setInfo(''); setConfirm('') }}>
          {signUp ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  )
}
