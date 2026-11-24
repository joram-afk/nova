import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LoadButton } from './Spinner'
import './dock.css'

interface Props {
  mode: 'Meeting' | 'Interview'
  listening: boolean
  auto: boolean
  capturing: boolean
  sharing: boolean
  watching: boolean
  readBusy: boolean
  aiBusy: boolean
  hasNotes: boolean
  canListen: boolean
  canShare: boolean
  pin: ReactNode
  noteText: string
  onNoteChange: (v: string) => void
  onToggleListen: () => void
  onToggleAuto: () => void
  onSummarize: () => unknown
  onToggleShare: () => unknown
  onToggleCapture: () => unknown
  onReadNow: () => unknown
  onToggleWatch: () => void
  onFile: (f: File) => void
  onSend: () => unknown
}

// Plain one-colour icons (they take the text colour of the button they sit in).
const svgProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const PlusIcon = () => <svg {...svgProps}><path d="M12 5v14M5 12h14" /></svg>
const MicIcon = () => <svg {...svgProps}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
const StopIcon = () => <svg {...svgProps}><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
const ArrowUpIcon = () => <svg {...svgProps}><path d="M12 19V5M5 12l7-7 7 7" /></svg>

// Layout, top to bottom: pinned suggestion, status strips, then one rounded input box like a messaging app:
// text on top; below it + (screenshot, share screen, meeting audio), Auto, and the mic and send buttons on the right.
export default function Dock(p: Props) {
  const [plusOpen, setPlusOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The text box grows with what you type (up to about five lines) and shrinks back after sending.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [p.noteText])

  const showStatus = p.listening || p.capturing || p.sharing
  const suggestLabel = p.aiBusy ? 'Thinking…' : p.mode === 'Meeting' ? '✧ Summarize' : '✧ Suggest'

  return (
    <div className="dock">
      {p.listening && p.pin && (
        <div className="pin"><div className="meta">✧ LATEST SUGGESTION</div>{p.pin}</div>
      )}

      {showStatus && (
        <div className="status">
          {p.listening && <div className="strip warn">● Mic is on · tell everyone being recorded</div>}
          {p.capturing && (
            <div className="strip rec">
              <span><i className="pulse" />Capturing meeting audio · use headphones</span>
              <button className="mini" onClick={p.onToggleCapture}>Stop</button>
            </div>
          )}
          {p.sharing && (
            <div className="strip">
              <span>◫ Sharing screen · only read text is saved</span>
              <div className="strip-actions">
                <LoadButton className="mini" loading={p.readBusy} onClick={p.onReadNow}>Read now</LoadButton>
                <button className={`mini ${p.watching ? 'on' : ''}`} onClick={p.onToggleWatch}>Watch {p.watching ? 'on' : 'off'}</button>
                <button className="mini" onClick={p.onToggleShare}>Stop</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="chatbox">
        <textarea
          ref={inputRef}
          className="chatbox-input"
          rows={1}
          enterKeyHint="send"
          placeholder={p.mode === 'Meeting' ? 'Add a note, or send to summarize…' : 'Type a question or note…'}
          value={p.noteText}
          onChange={e => p.onNoteChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void p.onSend() } }}
        />
        <div className="chatbox-row">
          <div className="plus-wrap">
            <button className="chat-btn" onClick={() => setPlusOpen(o => !o)} aria-label="Add" aria-expanded={plusOpen}><PlusIcon /></button>
            {plusOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setPlusOpen(false)} />
                <div className="plus-menu" role="menu">
                  <label className="plus-item" role="menuitem">
                    <span className="ico">▣</span>Screenshot
                    <input type="file" hidden accept="image/*" onChange={e => { const f = e.target.files?.[0]; setPlusOpen(false); if (f) p.onFile(f); e.target.value = '' }} />
                  </label>
                  {p.canShare && (
                    <button className="plus-item" role="menuitem" onClick={() => { setPlusOpen(false); void p.onToggleShare() }}>
                      <span className="ico">◫</span>{p.sharing ? 'Stop sharing screen' : 'Share screen'}
                    </button>
                  )}
                  {p.canShare && (
                    <button className="plus-item" role="menuitem" onClick={() => { setPlusOpen(false); void p.onToggleCapture() }}>
                      <span className="ico">◉</span>{p.capturing ? 'Stop meeting audio' : 'Meeting audio'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="dock-row sub">
            <button className={`toggle ${p.auto ? 'on' : ''}`} role="switch" aria-checked={p.auto} onClick={p.onToggleAuto}>
              <span className="knob" />Auto
            </button>
            {!p.auto && (
              <LoadButton className="ghost" loading={p.aiBusy} disabled={!p.hasNotes} onClick={p.onSummarize}>{suggestLabel}</LoadButton>
            )}
          </div>
          <span className="chatbox-spacer" />
          {p.canListen ? (
            <button className={`chat-btn ${p.listening ? 'on' : ''}`} onClick={p.onToggleListen} aria-label={p.listening ? 'Stop listening' : 'Start listening'}>
              {p.listening ? <StopIcon /> : <MicIcon />}
            </button>
          ) : <small className="muted">Voice needs Chrome or Edge</small>}
          <LoadButton className="chat-send" title="Send and get NOVA's answer" loading={p.aiBusy} disabled={!p.noteText.trim() && !p.hasNotes} onClick={p.onSend}>
            {p.aiBusy ? null : <ArrowUpIcon />}
          </LoadButton>
        </div>
      </div>
    </div>
  )
}
