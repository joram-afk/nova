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

// Layout, top to bottom: pinned suggestion (chat only), status strips, main controls, tool tiles, composer.
// The main controls change with the chosen layout:
//   chat  - text box with a round mic button beside it, Auto underneath
//   focus - three big buttons: Ask, Listen, Screenshot
//   tabs  - the original Listen + Auto row
export default function Dock(p: Props) {
  const layout: Layout = p.layout ?? 'chat'
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
        <>
          <div className="chat-row">
            {composer}
            {p.canListen ? (
              <button className={`mic-round ${p.listening ? 'on' : ''}`} onClick={p.onToggleListen} aria-label={p.listening ? 'Stop listening' : 'Start listening'}>
                {p.listening ? '■' : '●'}
              </button>
            ) : voiceNote}
          </div>
          <div className="dock-row sub">{autoToggle}{suggestButton}</div>
        </>
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

      {layout !== 'chat' && composer}
    </div>
  )
}
