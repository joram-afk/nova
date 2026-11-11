import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoadButton } from './Spinner'

interface Props { user: User; sessionCount: number; onDeleteAll: () => unknown; onSignOut: () => unknown }

export default function Profile({ user, sessionCount, onDeleteAll, onSignOut }: Props) {
  const [name, setName] = useState<string>(user.user_metadata?.display_name ?? '')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const initial = (name || user.email || 'N')[0].toUpperCase()

  function done(error: { message: string } | null, ok: string) {
    setBad(Boolean(error)); setMsg(error ? error.message : ok)
  }
  async function saveName() {
    const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() } })
    done(error, 'Name saved.')
  }
  async function changePw() {
    if (pw.length < 6) { done({ message: 'Password must be at least 6 characters.' }, ''); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (!error) setPw('')
    done(error, 'Password updated.')
  }

  return (
    <section className="page">
      <h2>Profile</h2>
      <div className="card">
        <div className="id-row">
          <div className="avatar-lg">{initial}</div>
          <div><strong>{name || 'Your name'}</strong><small>{user.email}</small></div>
        </div>
        <div className="stats">
          <div className="stat"><b>{sessionCount}</b><span>Sessions</span></div>
          <div className="stat"><b>{new Date(user.created_at).toLocaleDateString()}</b><span>Member since</span></div>
        </div>
      </div>

      <div className="card">
        <h3>Display name</h3>
        <input className="field" placeholder="What should NOVA call you?" value={name} onChange={e => setName(e.target.value)} />
        <LoadButton className="start-button" onClick={saveName}>Save name</LoadButton>
      </div>

      <div className="card">
        <h3>Change password</h3>
        <input className="field" type="password" autoComplete="new-password" placeholder="New password (6+ characters)"
          value={pw} onChange={e => setPw(e.target.value)} />
        <LoadButton className="start-button" disabled={!pw} onClick={changePw}>Update password</LoadButton>
      </div>

      {msg && <div className={bad ? 'error' : 'ok'}>{msg}</div>}

      <div className="card">
        <h3>Account</h3>
        <LoadButton className="ghost" onClick={onSignOut}>Sign out</LoadButton>
        <LoadButton className="danger" onClick={onDeleteAll}>Delete all my sessions</LoadButton>
        <p>Deleting removes every session and note from your account. This cannot be undone.</p>
      </div>
    </section>
  )
}
