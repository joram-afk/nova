import { useMemo, useState } from 'react'
import { LoadButton } from './Spinner'

export interface Row { id: string; title: string; mode: 'Meeting' | 'Interview'; created_at: string }

interface Props {
  sessions: Row[]
  onOpen: (s: Row) => void
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
}

export default function SessionList({ sessions, onOpen, onDelete, onRename }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'All' | 'Meeting' | 'Interview'>('All')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const shown = useMemo(
    () => sessions.filter(s => (filter === 'All' || s.mode === filter) && s.title.toLowerCase().includes(q.trim().toLowerCase())),
    [sessions, q, filter]
  )
  return (
    <>
      <div className="toolbar">
        <input className="field" placeholder="Search sessions…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg">
          {(['All', 'Meeting', 'Interview'] as const).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="list">
        {sessions.length === 0 && <div className="empty">No sessions yet.<br />Start one from the Dashboard.</div>}
        {sessions.length > 0 && shown.length === 0 && <div className="empty">No sessions match your search.</div>}
        {shown.map(s => (
          <div className="row" key={s.id}>
            {editing === s.id ? (
              <input className="field" autoFocus value={draft} onChange={e => setDraft(e.target.value)} />
            ) : (
              <button className="row-main" onClick={() => onOpen(s)}>
                <strong>{s.title}</strong>
                <small><span className="badge">{s.mode.toUpperCase()}</span> {new Date(s.created_at).toLocaleString()}</small>
              </button>
            )}
            <div className="row-actions">
              {editing === s.id ? (
                <>
                  <LoadButton className="start-button small" disabled={!draft.trim()} onClick={async () => { await onRename(s.id, draft.trim()); setEditing(null) }}>Save</LoadButton>
                  <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="ghost" title="Rename" onClick={() => { setEditing(s.id); setDraft(s.title) }}>✎</button>
                  <LoadButton className="ghost" title="Delete" onClick={() => onDelete(s.id)}>Delete</LoadButton>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
