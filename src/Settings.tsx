import { useState } from 'react'
import { THEMES } from './lib/settings'
import type { Settings } from './lib/settings'
import { LoadButton } from './Spinner'
import './appearance.css'

const LANGS: [string, string][] = [
  ['', 'Device default'], ['en-KE', 'English (Kenya)'], ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'], ['sw-KE', 'Kiswahili (Kenya)']
]
const SPEEDS: [number, string][] = [[20, 'Fast'], [40, 'Normal'], [90, 'Relaxed']]
const CHUNKS: [number, string][] = [[20, 'Live'], [30, 'Normal'], [60, 'Saver']]

interface Props { settings: Settings; onChange: (s: Settings) => unknown }

export default function SettingsPage({ settings, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const memories = settings.memories ?? []
  const learned = settings.learned ?? []
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const sw = (on: boolean, flip: () => void) => (
    <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={flip}><span className="knob" />{on ? 'On' : 'Off'}</button>
  )
  async function addMemory() {
    const t = draft.trim()
    if (!t) return
    await onChange({ ...settings, memories: [...memories, t].slice(-40) })
    setDraft('')
  }
  const forget = (i: number) => void onChange({ ...settings, memories: memories.filter((_, k) => k !== i) })
  const forgetLearned = (i: number) => void onChange({ ...settings, learned: learned.filter((_, k) => k !== i) })

  return (
    <section className="page">
      <h2>Settings</h2>

      <div className="card">
        <h3>Appearance</h3>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button key={t.id} data-preview={t.id} className={`theme-tile${settings.theme === t.id ? ' on' : ''}`} onClick={() => set('theme', t.id)}>
              <span className="sw"><i /><i /><i /></span>{t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Listening</h3>
        <div className="setting">
          <div className="lbl"><strong>Language</strong><small>What NOVA expects to hear. Applies the next time you tap Listen.</small></div>
          <select className="field" style={{ maxWidth: 200 }} value={settings.lang} onChange={e => set('lang', e.target.value)}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="setting">
          <div className="lbl"><strong>Keep screen awake</strong><small>Stops the screen turning off while NOVA is listening.</small></div>
          {sw(settings.wake, () => set('wake', !settings.wake))}
        </div>
        <div className="setting">
          <div className="lbl"><strong>Meeting audio delay</strong><small>How often captured meeting audio (laptop only) becomes text. Live feels quicker but uses more of your free AI quota.</small></div>
          <div className="seg">{CHUNKS.map(([v, l]) => <button key={v} className={settings.chunk === v ? 'on' : ''} onClick={() => set('chunk', v)}>{l}</button>)}</div>
        </div>
      </div>

      <div className="card">
        <h3>AI assistant</h3>
        <div className="setting">
          <div className="lbl"><strong>AI mode</strong><small>Smart thinks harder and answers better, a few seconds slower. Fast replies quicker.</small></div>
          <div className="seg">
            <button className={settings.brain === 'fast' ? 'on' : ''} onClick={() => set('brain', 'fast')}>Fast</button>
            <button className={settings.brain === 'smart' ? 'on' : ''} onClick={() => set('brain', 'smart')}>Smart</button>
          </div>
        </div>
        <div className="setting">
          <div className="lbl"><strong>Learn from my sessions</strong><small>After a session, NOVA notes lasting facts about you (skills, goals, preferences) to personalise future answers. It ignores other people's details. You can remove anything it learns.</small></div>
          {sw(settings.learn !== false, () => set('learn', settings.learn === false))}
        </div>
        <div className="setting">
          <div className="lbl"><strong>Auto-suggest on by default</strong><small>Whether each new session starts with Auto switched on.</small></div>
          {sw(settings.autoDefault, () => set('autoDefault', !settings.autoDefault))}
        </div>
        <div className="setting">
          <div className="lbl"><strong>Suggestion speed</strong><small>Minimum wait between automatic suggestions. Longer saves your free AI quota.</small></div>
          <div className="seg">{SPEEDS.map(([v, l]) => <button key={v} className={settings.interval === v ? 'on' : ''} onClick={() => set('interval', v)}>{l}</button>)}</div>
        </div>
        <div className="setting">
          <div className="lbl"><strong>Answer length</strong><small>Short gives quick bullets. Detailed gives fuller answers.</small></div>
          <div className="seg">
            <button className={settings.style === 'short' ? 'on' : ''} onClick={() => set('style', 'short')}>Short</button>
            <button className={settings.style === 'detailed' ? 'on' : ''} onClick={() => set('style', 'detailed')}>Detailed</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Memory</h3>
        <p>Things NOVA should remember about you, like your background, skills and goals. It uses them to tailor its answers. Saved only in your account.</p>
        <textarea className="field" rows={4} maxLength={500} value={draft} onChange={e => setDraft(e.target.value)} />
        <LoadButton className="start-button" disabled={!draft.trim() || memories.length >= 40} onClick={addMemory}>Save</LoadButton>
        {memories.length === 0
          ? <p>No memories yet.</p>
          : <ul className="memlist">{memories.map((m, i) => <li key={i}><span>{m}</span><button className="ghost" aria-label="Forget this" onClick={() => forget(i)}>✕</button></li>)}</ul>}
        {learned.length > 0 && (
          <>
            <div className="sub">Learned about you</div>
            <ul className="memlist">{learned.map((m, i) => <li key={i}><span>{m}</span><button className="ghost" aria-label="Forget this" onClick={() => forgetLearned(i)}>✕</button></li>)}</ul>
          </>
        )}
      </div>

      <div className="card">
        <h3>About</h3>
        <p>NOVA Copilot, an early development build by Joe for any interviews or meetings all in one place.All rights reserved.</p>
      </div>
    </section>
  )
}
