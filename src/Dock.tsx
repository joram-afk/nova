import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LoadButton, Spinner } from './Spinner'
import type { Layout } from './lib/layout'
import './dock.css'

interface Props {
  mode: 'Meeting' | 'Interview'
  layout?: Layout
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

// Layout, top to bottom: pinned suggestion (chat only), status strips, main controls, tool tiles, composer.
// The main controls change with the chosen layout:
//   chat  - one rounded box like a messaging app: text on top; below it + (screenshot, share screen, meeting audio),
//           Auto, then the mic and send buttons on the right
//   focus - three big buttons: Ask, Listen, Screenshot
//   tabs  - the original Listen + Auto row
export default function Dock(p: Props) {
  const layout: Layout = p.layout ?? 'chat'
  const [plusOpen, setPlusOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The chat text box grows with what you type (up to about five lines) and shrinks back after sending.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [p.noteText, layout])
  const showStatus = p.listening || p.capturing || p.sharing
  const suggestLabel = p.aiBusy ? 'Thinking…' : p.mode === 'Meeting' ? '✧ Summarize' : '✧ Suggest'

  const fileInput = (
    <input type="file" hidden accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) p.onFile(f); e.target.value = '' }} />
  )
  const autoToggle = (
    <button className={`toggle ${p.auto ? 'on' : ''}`} role="switch" aria-checked={p.auto} onClick={p.onToggleAuto}>
      <span className="knob" />Auto
    </button>
  )
  const suggestButton = !p.auto && (
    <LoadButton className="ghost" loading={p.aiBusy} disabled={!p.hasNotes} onClick={p.onSummarize}>{suggestLabel}</LoadButton>
  )
  const composer = (
    <div className="composer">
      <input className="composer-input" placeholder={p.mode === 'Meeting' ? 'Add a note, tap ↑ to summarize…' : 'Type a question or note…'} value={p.noteText}
        onChange={e => p.onNoteChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void p.onSend() }} />
      <LoadButton className="send-up" title="Send and get NOVA's answer" loading={p.aiBusy} disabled={!p.noteText.trim() && !p.hasNotes} onClick={p.onSend}>{p.aiBusy ? null : '↑'}</LoadButton>
    </div>
  )
  const voiceNote = <small className="muted">Voice needs Chrome or Edge</small>

  return (
    <div className="dock">
      {layout === 'chat' && p.listening && p.pin && (
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

      {layout === 'chat' && (
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
            <div className="dock-row sub">{autoToggle}{suggestButton}</div>
            <span className="chatbox-spacer" />
            {p.canListen ? (
              <button className={`chat-btn ${p.listening ? 'on' : ''}`} onClick={p.onToggleListen} aria-label={p.listening ? 'Stop listening' : 'Start listening'}>
                {p.listening ? <StopIcon /> : <MicIcon />}
              </button>
            ) : voiceNote}
            <LoadButton className="chat-send" title="Send and get NOVA's answer" loading={p.aiBusy} disabled={!p.noteText.trim() && !p.hasNotes} onClick={p.onSend}>
              {p.aiBusy ? null : <ArrowUpIcon />}
            </LoadButton>
          </div>
        </div>
      )}

      {layout === 'focus' && (
        <>
          <div className="focus-actions">
            <LoadButton className="big-btn" loading={p.aiBusy} disabled={!p.hasNotes} onClick={p.onSummarize}>{p.aiBusy ? 'Thinking…' : '✧ Ask'}</LoadButton>
            {p.canListen ? (
              <button className={`big-btn primary ${p.listening ? 'on' : ''}`} onClick={p.onToggleListen}>{p.listening ? '■ Stop' : '● Listen'}</button>
            ) : voiceNote}
            <label className="big-btn">
              {p.readBusy ? <Spinner size={18} /> : <span>▣</span>}Screenshot
              {fileInput}
            </label>
          </div>
          <div className="dock-row sub">{autoToggle}</div>
        </>
      )}

      {layout === 'tabs' && (
        <div className={`dock-row primary${p.auto ? '' : ' three'}`}>
          {p.canListen ? (
            <button className={`mic ${p.listening ? 'on' : ''}`} onClick={p.onToggleListen}>
              <span className="dot" />{p.listening ? 'Stop' : 'Listen'}
            </button>
          ) : voiceNote}
          {autoToggle}
          {suggestButton}
        </div>
      )}

      {layout !== 'chat' && (
      <div className="tools-row">
        {p.canShare && (
          <LoadButton className={`tile${p.sharing ? ' on' : ''}`} onClick={p.onToggleShare}>
            <span className="ico">◫</span>{p.sharing ? 'Stop sharing' : 'Share screen'}
          </LoadButton>
        )}
        {p.canShare && (
          <LoadButton className={`tile${p.capturing ? ' on' : ''}`} onClick={p.onToggleCapture}>
            <span className="ico">◉</span>{p.capturing ? 'Stop audio' : 'Meeting audio'}
          </LoadButton>
        )}
        {layout !== 'focus' && (
          <label className="tile">
            {p.readBusy ? <Spinner size={18} /> : <span className="ico">▣</span>}Screenshot
            {fileInput}
          </label>
        )}
      </div>
      )}

      {layout !== 'chat' && composer}
    </div>
  )
}
