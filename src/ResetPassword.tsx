import { useState } from 'react'
import { supabase } from './lib/supabase'
import { LoadButton } from './Spinner'

export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (pw.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (pw !== confirm) { setError('Passwords do not match.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setError(error.message); else onDone()
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand-icon">N</div>
        <h2>Set a new password</h2>
        <p>Choose a new password for your account.</p>
        <input className="field" type="password" autoComplete="new-password" placeholder="New password"
          value={pw} onChange={e => setPw(e.target.value)} />
        <input className="field" type="password" autoComplete="new-password" placeholder="Confirm new password"
          value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save() }} />
        {error && <div className="error">{error}</div>}
        <LoadButton className="start-button wide" disabled={!pw || !confirm} onClick={save}>Save password</LoadButton>
      </div>
    </div>
  )
}
