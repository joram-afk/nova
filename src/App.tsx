import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session as AuthSession } from '@supabase/supabase-js'
import { supabase, configured } from './lib/supabase'
import Auth from './Auth'
import { SR, speechSupported } from './lib/speech'
import { downsample, encodeWav, joinChunks, peakLevel } from './lib/audio'
import Profile from './Profile'
import SettingsPage from './Settings'
import SessionList from './SessionList'
import ResetPassword from './ResetPassword'
import Dock from './Dock'
import { LoadButton, Thinking } from './Spinner'
import { DEFAULTS, applyTheme } from './lib/settings'
import type { Settings } from './lib/settings'
import './extra.css'
import './composer.css'
import './nova-extras.css'
import { extractPdfText } from './lib/pdf'
import { LAYOUTS, loadLayout, saveLayout } from './lib/layout'
import type { Layout } from './lib/layout'
import { LANGS, QUICK, QUICK_KEYS, buildContext, cleanPrep, loadLang, loadLastPrep, loadPrep, MAX_PREP, savePrep, saveLang, srLang } from './lib/prep'
import type { Lang, QuickKey } from './lib/prep'

type Mode = 'Meeting' | 'Interview'
type View = 'dashboard' | 'sessions' | 'profile' | 'settings'
interface Row { id: string; title: string; mode: Mode; created_at: string }
interface Note { id: string; content: string; kind: 'note' | 'transcript' | 'ai' | 'screen'; created_at: string }

const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
// Cloud microphone: record the mic ourselves and have the AI turn it into text. Works where the browser's live speech API does not.
const cloudMicSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext)
// Set by the Windows desktop shell (desktop/preload.js). Undefined in a normal browser.
const desktop: any = typeof window !== 'undefined' ? (window as any).desktop : undefined
const store: Storage | null = (() => { try { return window.localStorage } catch { return null } })()
const MIC_CHUNK_MS = 8000
const MIC_MIN_PEAK = 0.02 // quieter than this counts as silence and is not sent (low enough for a lecture played from the phone speaker)
interface CloudMic { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; timer: ReturnType<typeof setInterval>; chunks: Float32Array[]; sess: Row | null; meter?: ReturnType<typeof setInterval> }

// A note can arrive after its session was deleted (a slow transcription, an AI answer, a screen read).
// There is nowhere to save it, so background saves drop it quietly instead of showing a database error.
const sessionGone = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '23503' || /foreign key/i.test(e.message || ''))
const GONE_MESSAGE = 'This session no longer exists. Go back and start a new one.'

function renderAi(text: string): ReactNode {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p)
  const out: ReactNode[] = []
  let items: ReactNode[] = []
  const flush = () => { if (items.length) { out.push(<ul key={`u${out.length}`}>{items}</ul>); items = [] } }
  text.split('\n').forEach((ln, i) => {
    const m = ln.match(/^\s*[-*•]\s+(.*)/)
    if (m) items.push(<li key={i}>{inline(m[1])}</li>)
    else { flush(); if (ln.trim()) out.push(<p key={i}>{inline(ln)}</p>) }
  })
  flush()
  return out
}

function App() {
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [mode, setMode] = useState<Mode>('Meeting')
  const [sessions, setSessions] = useState<Row[]>([])
  const [active, setActive] = useState<Row | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [title, setTitle] = useState('')
  const [noteText, setNoteText] = useState('')
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [auto, setAuto] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [watching, setWatching] = useState(false)
  const [readBusy, setReadBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [stats, setStats] = useState({ notes: 0, ai: 0 })
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const settingsRef = useRef<Settings>(DEFAULTS)
  const appliedRef = useRef(false)
  const wakeRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastSigRef = useRef<number[] | null>(null)
  const readBusyRef = useRef(false)
  const recRef = useRef<any>(null)
  const wantRef = useRef(false)
  const activeRef = useRef<Row | null>(null)
  const notesRef = useRef<Note[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef('')
  const lastSavedRef = useRef('')
  const lastAiRef = useRef(0)
  const busyRef = useRef(false)
  const pauseRef = useRef(0)
  const learnedRef = useRef(new Set<string>())
  const capStreamRef = useRef<MediaStream | null>(null)
  const capRecRef = useRef<MediaRecorder | null>(null)
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const capMeterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capCtxRef = useRef<AudioContext | null>(null)
  const capLevelRef = useRef(0)
  const autoRef = useRef(true)
  const [chatLang, setChatLang] = useState<Lang>(() => loadLang(store))
  const langRef = useRef<Lang>(chatLang)
  const [prep, setPrep] = useState('')
  const prepRef = useRef('')
  const [prepOpen, setPrepOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [layout, setLayout] = useState<Layout>(() => loadLayout(store))
  const [tab, setTab] = useState<'live' | 'transcript'>('live')
  const [showConvo, setShowConvo] = useState(false)
  const [prepDraft, setPrepDraft] = useState('')
  const [prepReading, setPrepReading] = useState(false)
  const micRef = useRef<CloudMic | null>(null)
  const silentRunRef = useRef(0) // how many cloud-mic chunks in a row had no sound
  const levelRef = useRef(0) // loudness of the latest microphone audio (0 to 1)
  const [micLevel, setMicLevel] = useState<number | null>(null) // null when the cloud mic is off
  const sourceRef = useRef<'browser' | 'cloud'>('browser')
  const gotTextRef = useRef(false)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!configured) { setReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setAuth(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => { setAuth(s); if (event === 'PASSWORD_RECOVERY') setRecovery(true) })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!auth) { appliedRef.current = false; stopListening(); stopShare(); stopCapture(); return }
    if (appliedRef.current) return // keep local changes; do not let a slower save overwrite them
    appliedRef.current = true
    const s: Settings = { ...DEFAULTS, ...(auth.user.user_metadata?.settings ?? {}) }
    setSettings(s); settingsRef.current = s; setAuto(s.autoDefault); applyTheme(s.theme)
  }, [auth])
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !wantRef.current) return
      setError('Recording pauses while NOVA is in the background. Keep NOVA open on screen to record.')
      void requestWake()
      if (sourceRef.current === 'cloud') void micRef.current?.ctx.resume().catch(() => undefined)
      else { try { recRef.current?.start() } catch { /* already running */ } }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => {
    if (!sharing || !watching) return
    const id = setInterval(() => void readShared(true), 20000)
    return () => clearInterval(id)
  }, [sharing, watching])
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { if (auth) void loadSessions() }, [auth])
  useEffect(() => {
    const prev = activeRef.current
    if (prev && prev.id !== active?.id) void learnFrom(prev, notesRef.current)
    stopListening() // saves any pending words to the session we are leaving
    stopShare()
    stopCapture()
    activeRef.current = active
    lastSavedRef.current = ''
    if (active) void loadNotes(active.id); else setNotes([])
  }, [active])
  useEffect(() => {
    if (!active) return
    const nearBottom = document.body.scrollHeight - (window.scrollY + window.innerHeight) < 450
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [notes.length, interim, active, aiBusy, readBusy])

  async function loadSessions() {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message); else setSessions(data as Row[])
    void loadStats()
  }
  async function loadStats() {
    const n = await supabase.from('notes').select('id', { count: 'exact', head: true })
    const a = await supabase.from('notes').select('id', { count: 'exact', head: true }).eq('kind', 'ai')
    setStats({ notes: n.count ?? 0, ai: a.count ?? 0 })
  }
  async function renameSession(id: string, name: string) {
    const { error } = await supabase.from('sessions').update({ title: name }).eq('id', id)
    if (error) { setError(error.message); return }
    setSessions(list => list.map(x => x.id === id ? { ...x, title: name } : x))
  }
  function flash(m: string) { setNotice(m); setTimeout(() => setNotice(''), 2200) }
  function sessionText(): string {
    if (!active) return ''
    const tag = (k: Note['kind']) => k === 'ai' ? 'NOVA' : k === 'screen' ? 'ON SCREEN' : k === 'transcript' ? 'HEARD' : 'NOTE'
    return `${active.title}\n${active.mode} - ${new Date(active.created_at).toLocaleString()}\n\n` +
      notes.map(n => `${tag(n.kind)}: ${n.content}`).join('\n\n')
  }
  async function copyText(t: string) {
    try { await navigator.clipboard.writeText(t); flash('Copied to clipboard') } catch { setError('Could not copy to the clipboard.') }
  }
  function exportTxt() {
    const blob = new Blob([sessionText()], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${active?.title ?? 'session'}.txt`.replace(/[\\/:*?"<>|]/g, '-')
    a.click()
    URL.revokeObjectURL(a.href)
    flash('Session exported')
  }
  async function loadNotes(id: string) {
    const { data, error } = await supabase.from('notes').select('id,content,kind,created_at')
      .eq('session_id', id).order('created_at', { ascending: true })
    if (error) setError(error.message); else { notesRef.current = data as Note[]; setNotes(data as Note[]) }
  }
  async function saveSettings(next: Settings) {
    if (next.theme !== settingsRef.current.theme) applyTheme(next.theme)
    setSettings(next); settingsRef.current = next
    const { error } = await supabase.auth.updateUser({ data: { settings: next } })
    if (error) setError(error.message)
  }
  async function deleteAllData() {
    if (!auth || !window.confirm('Delete ALL your sessions and notes? This cannot be undone.')) return
    const { error } = await supabase.from('sessions').delete().eq('user_id', auth.user.id)
    if (error) { setError(error.message); return }
    setActive(null); setSessions([]); setStats({ notes: 0, ai: 0 })
  }
  async function createSession() {
    setError('')
    const name = title.trim() || `${mode} ${new Date().toLocaleDateString()}`
    const { data, error } = await supabase.from('sessions').insert({ title: name, mode }).select().single()
    if (error) { setError(error.message); return }
    setTitle(''); await loadSessions(); setActive(data as Row); setView('sessions')
  }
  async function deleteSession(id: string) {
    if (!window.confirm('Delete this session and all its notes?')) return
    const { error } = await supabase.from('sessions').delete().eq('id', id)
    if (error) { setError(error.message); return }
    if (active?.id === id) setActive(null)
    await loadSessions()
  }
  async function addNote() {
    if (!active || !noteText.trim()) return
    const { error } = await supabase.from('notes').insert({ session_id: active.id, content: noteText.trim() })
    if (error) { setError(sessionGone(error) ? GONE_MESSAGE : error.message); return }
    setNoteText(''); await loadNotes(active.id)
  }

  // The up-arrow: save what you typed (if anything), then have NOVA answer right away.
  async function sendNote() {
    if (!active) return
    const text = noteText.trim()
    if (text) {
      const { error } = await supabase.from('notes').insert({ session_id: active.id, content: text })
      if (error) { setError(sessionGone(error) ? GONE_MESSAGE : error.message); return }
      setNoteText('')
      await loadNotes(active.id)
    }
    if (notesRef.current.length > 0) await askNova()
  }

  async function saveChunk(text: string) {
    const a = activeRef.current
    if (!a || !text.trim()) return
    const { error } = await supabase.from('notes').insert({ session_id: a.id, content: text.trim(), kind: 'transcript' })
    if (error) { if (!sessionGone(error)) setError(error.message) }
    else { await loadNotes(a.id); scheduleAuto() }
  }
  // Android Chrome re-sends the growing sentence many times ("what", "what is", "what is the").
  // We keep only the latest version and save it once, after a short pause.
  function commitPending() {
    if (commitRef.current) clearTimeout(commitRef.current)
    const t = pendingRef.current.trim()
    pendingRef.current = ''
    setInterim('')
    if (!t || t.toLowerCase() === lastSavedRef.current.toLowerCase()) return
    lastSavedRef.current = t
    void saveChunk(t)
  }
  function feed(raw: string) {
    const t = raw.trim()
    if (!t) return
    const p = pendingRef.current
    const a = t.toLowerCase(), b = p.toLowerCase()
    if (p && !(a.startsWith(b) || b.startsWith(a))) commitPending() // a new sentence began
    const cur = pendingRef.current
    pendingRef.current = cur && cur.toLowerCase().startsWith(a) && cur.length >= t.length ? cur : t
    setInterim(pendingRef.current)
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = setTimeout(commitPending, 1400)
  }
  function scheduleAuto() {
    if (!autoRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if ((!wantRef.current && !capStreamRef.current) || busyRef.current || Date.now() < pauseRef.current) return
      if (Date.now() - lastAiRef.current < Math.max(settingsRef.current.interval, 20) * 1000) return
      // Save the free AI quota: only fire when there is something worth answering.
      const list = notesRef.current
      let lastAi = -1
      list.forEach((n, i) => { if (n.kind === 'ai') lastAi = i })
      const heard = list.slice(lastAi + 1).filter(n => n.kind === 'transcript')
      if (!heard.length) return
      const lastText = heard[heard.length - 1].content.toLowerCase().trim()
      const isQuestion = /\?|^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|tell me|describe|explain|walk me)\b/.test(lastText)
      if (!(isQuestion || (activeRef.current?.mode === 'Meeting' && heard.length >= 6))) return
      void askNova()
    }, 3000)
  }
  function changeLayout(l: Layout) { setLayout(l); saveLayout(store, l) }
  function changeLang(l: Lang) { setChatLang(l); langRef.current = l; saveLang(store, l) }
  function openPrep() { setPrepDraft(prep); setPrepOpen(o => !o) }
  function commitPrep(text: string) {
    const a = activeRef.current
    if (!a) return
    const clean = savePrep(store, a.id, text)
    setPrep(clean); prepRef.current = clean; setPrepDraft(clean)
    flash(clean ? 'Prep saved. NOVA will use it.' : 'Prep cleared.')
  }
  async function loadPrepFile(f: File) {
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    const isText = /\.(txt|md|csv)$/i.test(f.name) || f.type.startsWith('text/')
    if (!isPdf && !isText) { setError('Prep files must be a PDF or a text file (.txt or .md). For a Word CV, copy its text and paste it here.'); return }
    setError('')
    try {
      let text = ''
      if (isPdf) {
        setPrepReading(true)
        text = await extractPdfText(f)
        if (!text.trim()) { setError('This PDF has no selectable text (it may be a scan). Copy the text and paste it here instead.'); return }
      } else text = await f.text()
      if (text.trim().length > MAX_PREP) flash('Long file: only the first ' + MAX_PREP + ' characters are used.')
      setPrepDraft(cleanPrep(text))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally { setPrepReading(false) }
  }
  useEffect(() => {
    const id = active?.id
    const v = id ? loadPrep(store, id) : ''
    setPrep(v); prepRef.current = v; setPrepDraft(v); setPrepOpen(false); setMenuOpen(false); setTab('live'); setShowConvo(false)
  }, [active?.id])

  function startListening() {
    if (!SR && !cloudMicSupported) return
    setError('')
    wantRef.current = true
    void requestWake()
    let preferCloud = !SR || Boolean(desktop) || langRef.current === 'mixed' // the desktop shell has no live speech service, so go straight to cloud
    try { if (localStorage.getItem('nova.cloudMic') === '1') preferCloud = true } catch { /* storage blocked */ }
    if (preferCloud && cloudMicSupported) { sourceRef.current = 'cloud'; void startCloudMic() } else startBrowserMic()
  }
  // Live speech from the browser. Fast, but many Android browsers and installed PWAs give no text at all.
  function startBrowserMic() {
    if (!SR) { switchToCloud(); return }
    sourceRef.current = 'browser'
    gotTextRef.current = false
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = srLang(langRef.current, settingsRef.current.lang || navigator.language || 'en-US')
    rec.onresult = (e: any) => {
      gotTextRef.current = true
      for (let i = e.resultIndex; i < e.results.length; i++) feed(e.results[i][0].transcript)
    }
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone permission was blocked. Allow it in your browser settings.')
        stopListening()
      } else if (e.error === 'network' || e.error === 'audio-capture' || e.error === 'language-not-supported') {
        switchToCloud() // live speech is broken on this device: use cloud transcription instead
      }
    }
    rec.onend = () => {
      if (wantRef.current && sourceRef.current === 'browser') { try { rec.start() } catch { /* already restarting */ } }
      else if (sourceRef.current === 'browser') { setListening(false) }
    }
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { switchToCloud(); return }
    // If nothing comes back after a few seconds, the browser is not transcribing. Switch automatically.
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    watchdogRef.current = setTimeout(() => {
      if (wantRef.current && sourceRef.current === 'browser' && !gotTextRef.current) switchToCloud()
    }, 8000)
  }
  function switchToCloud() {
    if (!wantRef.current || sourceRef.current === 'cloud') return
    if (!cloudMicSupported) { setError('Speech recognition is not working in this browser. Try Chrome.'); stopListening(); return }
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    const r = recRef.current
    if (r) { r.onend = null; r.onerror = null; r.onresult = null; try { r.abort() } catch { /* not running */ } }
    recRef.current = null
    try { localStorage.setItem('nova.cloudMic', '1') } catch { /* storage blocked */ }
    sourceRef.current = 'cloud'
    setNotice('Live speech was not working on this device, so NOVA switched to cloud transcription. Text appears a few seconds after you speak.')
    setTimeout(() => setNotice(''), 7000)
    void startCloudMic()
  }
  // Cloud microphone: collect raw audio, cut it every few seconds, skip silence, send the rest as a WAV file.
  async function startCloudMic() {
    try {
      // Echo cancellation and noise suppression are OFF on purpose: they treat sound coming out of the phone's own
      // speaker (a Zoom lecture, a call) as echo and remove it, so the mic would hear nothing. Gain control stays on to lift quiet audio.
      silentRunRef.current = 0
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
      if (!wantRef.current || sourceRef.current !== 'cloud') { stream.getTracks().forEach(t => t.stop()); return }
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctx()
      await ctx.resume().catch(() => undefined)
      const src = ctx.createMediaStreamSource(stream)
      const node = ctx.createScriptProcessor(4096, 1, 1)
      const mute = ctx.createGain()
      mute.gain.value = 0 // the processor must be connected to run, but we must not play the mic back
      const m: CloudMic = { stream, ctx, node, chunks: [], timer: setInterval(() => flushMic(m), MIC_CHUNK_MS), sess: activeRef.current }
      node.onaudioprocess = e => {
        const block = e.inputBuffer.getChannelData(0)
        m.chunks.push(new Float32Array(block))
        let p = 0
        for (let i = 0; i < block.length; i++) { const v = Math.abs(block[i]); if (v > p) p = v }
        levelRef.current = Math.max(p, levelRef.current * 0.8) // rises at once, falls smoothly
      }
      src.connect(node); node.connect(mute); mute.connect(ctx.destination)
      micRef.current = m
      levelRef.current = 0
      setMicLevel(0)
      m.meter = setInterval(() => setMicLevel(levelRef.current), 150) // drives the sound-level bar
      setListening(true)
    } catch (e) {
      wantRef.current = false
      setListening(false)
      releaseWake()
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(denied ? 'Microphone permission was blocked. Allow it in your browser settings.' : 'Could not open the microphone.')
    }
  }
  function flushMic(m: CloudMic) {
    if (!m.chunks.length) return
    const all = joinChunks(m.chunks)
    m.chunks = []
    if (all.length < m.ctx.sampleRate * 1) return // under a second: not worth sending
    if (peakLevel(all) < MIC_MIN_PEAK) { // silence: save the free AI quota
      silentRunRef.current += 1
      if (silentRunRef.current === 3) { // about 24 seconds of nothing: tell the user why this can happen
        setNotice('NOVA is not hearing any sound. To pick up a lecture or call on this phone, play it through the phone speaker (not earphones or Bluetooth) at a high volume.')
        setTimeout(() => setNotice(''), 10000)
      }
      return
    }
    silentRunRef.current = 0
    const wav = encodeWav(downsample(all, m.ctx.sampleRate, 16000), 16000)
    setInterim('Transcribing…')
    void transcribeChunk(wav, m.sess).finally(() => setInterim(''))
  }
  function stopCloudMic() {
    const m = micRef.current
    if (!m) return
    micRef.current = null
    clearInterval(m.timer)
    if (m.meter) clearInterval(m.meter)
    setMicLevel(null)
    try { m.node.disconnect() } catch { /* already disconnected */ }
    flushMic(m) // send the last few words
    m.stream.getTracks().forEach(t => t.stop())
    m.ctx.close().catch(() => undefined)
  }
  function stopListening() {
    wantRef.current = false
    if (timerRef.current) clearTimeout(timerRef.current)
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    commitPending()
    releaseWake()
    stopCloudMic()
    const r = recRef.current
    if (r) { r.onend = null; try { r.stop() } catch { /* not running */ } }
    recRef.current = null
    setListening(false)
  }
  async function requestWake() {
    if (!settingsRef.current.wake) return
    try { wakeRef.current = await (navigator as any).wakeLock?.request('screen') } catch { /* not allowed */ }
  }
  function releaseWake() {
    try { wakeRef.current?.release() } catch { /* ignore */ }
    wakeRef.current = null
  }
  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const v = document.createElement('video')
      v.muted = true; v.srcObject = stream
      await v.play()
      streamRef.current = stream; videoRef.current = v
      stream.getVideoTracks()[0].addEventListener('ended', stopShare)
      setSharing(true)
    } catch { setError('Screen sharing was cancelled or is not available in this browser.') }
  }
  function stopShare() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null; videoRef.current = null; lastSigRef.current = null
    setSharing(false); setWatching(false)
  }
  function toJpeg(src: CanvasImageSource, w: number, h: number): string {
    const k = Math.min(1, 1280 / w)
    const c = document.createElement('canvas')
    c.width = Math.round(w * k); c.height = Math.round(h * k)
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.7).split(',')[1]
  }
  function signature(src: CanvasImageSource): number[] {
    const c = document.createElement('canvas'); c.width = 32; c.height = 18
    const x = c.getContext('2d')!; x.drawImage(src, 0, 0, 32, 18)
    const d = x.getImageData(0, 0, 32, 18).data
    const out: number[] = []
    for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3)
    return out
  }
  async function readShared(onlyIfChanged: boolean) {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    if (onlyIfChanged) {
      const sig = signature(v), prev = lastSigRef.current
      lastSigRef.current = sig
      if (prev) {
        let diff = 0
        for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - prev[i])
        if (diff / sig.length < 10) return // screen did not change much
      }
    }
    await readImage(toJpeg(v, v.videoWidth, v.videoHeight))
  }
  async function readFile(f: File) {
    const url = URL.createObjectURL(f)
    try {
      const img = new Image(); img.src = url; await img.decode()
      await readImage(toJpeg(img, img.naturalWidth, img.naturalHeight))
    } catch { setError('Could not open that image.') }
    URL.revokeObjectURL(url)
  }
  async function readImage(b64: string) {
    const a = activeRef.current
    if (!a || readBusyRef.current) return
    readBusyRef.current = true; setReadBusy(true)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify({ mode: a.mode, image: b64 })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not read the screen')
      const { error } = await supabase.from('notes').insert({ session_id: a.id, content: j.text, kind: 'screen' })
      if (error) { if (!sessionGone(error)) throw new Error(error.message) }
      else await loadNotes(a.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the screen') }
    readBusyRef.current = false; setReadBusy(false)
  }
  // Meeting audio (Zoom, Meet, Teams...): capture the shared screen/tab sound, cut it into chunks,
  // skip silent chunks, and have the AI turn each chunk into text.
  async function startCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const track = stream.getAudioTracks()[0]
      if (!track) {
        stream.getTracks().forEach(t => t.stop())
        setError('No audio was shared. Pick "Entire screen" (Windows) or a browser tab, and tick "Also share system audio" or "Also share tab audio".')
        return
      }
      const audioStream = new MediaStream([track])
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      ctx.createMediaStreamSource(audioStream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      capMeterRef.current = setInterval(() => {
        an.getByteTimeDomainData(buf)
        let max = 0
        for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] - 128))
        capLevelRef.current = Math.max(capLevelRef.current, max)
      }, 200)
      capCtxRef.current = ctx
      capStreamRef.current = stream
      track.addEventListener('ended', stopCapture)
      stream.getVideoTracks()[0]?.addEventListener('ended', stopCapture)
      setCapturing(true)
      recordChunk(audioStream)
    } catch { setError('Meeting audio sharing was cancelled or is not available in this browser.') }
  }
  function recordChunk(audioStream: MediaStream) {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const rec = new MediaRecorder(audioStream, { mimeType: mime })
    const parts: Blob[] = []
    capLevelRef.current = 0
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
    rec.onstop = () => {
      const heardSomething = capLevelRef.current > 6
      if (heardSomething && parts.length) void transcribeChunk(new Blob(parts, { type: mime }))
      if (capStreamRef.current) recordChunk(audioStream)
    }
    rec.start()
    capRecRef.current = rec
    capTimerRef.current = setTimeout(() => { try { rec.stop() } catch { /* already stopped */ } }, (settingsRef.current.chunk || 30) * 1000)
  }
  function stopCapture() {
    const stream = capStreamRef.current
    capStreamRef.current = null
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    if (capMeterRef.current) clearInterval(capMeterRef.current)
    try { if (capRecRef.current?.state === 'recording') capRecRef.current.stop() } catch { /* ignore */ }
    stream?.getTracks().forEach(t => t.stop())
    capCtxRef.current?.close().catch(() => undefined)
    capCtxRef.current = null
    setCapturing(false)
  }
  async function transcribeChunk(blob: Blob, sess: Row | null = activeRef.current) {
    const a = sess // the session the audio was recorded in, even if the user has since switched
    if (!a) return
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(new Error('Could not read the audio'))
        r.readAsDataURL(blob)
      })
      if (!b64 || b64.length > 4000000) return
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify({ task: 'transcribe', mode: a.mode, audio: b64, mime: blob.type, lang: langRef.current })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not turn the meeting audio into text')
      const text = String(j.text ?? '').trim()
      if (!text || /^\[?silence\]?\.?$/i.test(text)) return
      const { error } = await supabase.from('notes').insert({ session_id: a.id, content: text, kind: 'transcript' })
      if (error) { if (sessionGone(error)) return; throw new Error(error.message) }
      if (activeRef.current?.id === a.id) { await loadNotes(a.id); scheduleAuto() }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Audio transcription failed'
      if (/quota|limit/i.test(m)) { stopCapture(); stopListening(); setError(m + ' Recording was stopped.') } else setError(m)
    }
  }
  // After a session, ask the AI for lasting facts about the user and add them to "Learned about you".
  async function learnFrom(s: Row, list: Note[], force = false) {
    const cfg = settingsRef.current
    if (!force && (cfg.learn === false || learnedRef.current.has(s.id))) return
    const usable = list.filter(n => n.kind !== 'ai')
    if (usable.length < (force ? 1 : 4)) { if (force) flash('Add a few notes first, then NOVA can learn from them'); return }
    learnedRef.current.add(s.id)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const r = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
        body: JSON.stringify({ mode: s.mode, learn: true, notes: usable.map(n => ({ kind: n.kind, content: n.content })) })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { if (force) setError(j.error || 'Could not learn from this session'); return }
      let facts: unknown = []
      try { facts = JSON.parse(String(j.text).replace(/^```(?:json)?\s*|```$/g, '').trim()) } catch { return }
      if (!Array.isArray(facts)) return
      const now = settingsRef.current
      const known = [...(now.memories ?? []), ...(now.learned ?? [])].map(x => x.toLowerCase())
      const fresh = (facts as unknown[])
        .filter((f): f is string => typeof f === 'string')
        .map(f => f.trim().slice(0, 300))
        .filter(f => f && !known.includes(f.toLowerCase()))
        .slice(0, 4)
      if (!fresh.length) { if (force) flash('Nothing new to learn yet'); return }
      await saveSettings({ ...now, learned: [...(now.learned ?? []), ...fresh].slice(-60) })
      flash(`NOVA learned ${fresh.length} new thing${fresh.length > 1 ? 's' : ''} about you`)
    } catch { /* learning is best effort */ }
  }
  async function requestAi(m: Mode, list: { kind: string; content: string }[], full = false): Promise<string> {
    const { data: s } = await supabase.auth.getSession()
    const r = await fetch('/api/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: JSON.stringify({ mode: m, notes: list, full, style: settingsRef.current.style })
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'AI request failed')
    return j.text as string
  }
  async function importMeeting() {
    const lines = importText.replace(/\r/g, '').split('\n').map(l => l.trim())
      .filter(l => l && l !== 'WEBVTT' && !/^\d+$/.test(l) && !/-->/.test(l) && !/^(NOTE|Kind:|Language:)/.test(l))
      .map(l => l.replace(/<[^>]+>/g, ''))
    if (lines.length === 0) { setError('Paste a transcript or choose a file first.'); return }
    setImportBusy(true); setError('')
    try {
      const chunks: string[] = []
      let cur = ''
      for (const l of lines) {
        if (cur && cur.length + l.length > 500) { chunks.push(cur); cur = '' }
        cur += (cur ? '\n' : '') + l
      }
      if (cur) chunks.push(cur)
      const name = importTitle.trim() || `Imported meeting ${new Date().toLocaleDateString()}`
      const { data: sess, error: e1 } = await supabase.from('sessions').insert({ title: name, mode: 'Meeting' }).select().single()
      if (e1) throw new Error(e1.message)
      const id = (sess as Row).id
      const base = Date.now() - (chunks.length + 5) * 1000
      for (let i = 0; i < chunks.length; i += 100) {
        const rows = chunks.slice(i, i + 100).map((c, k) => ({
          session_id: id, content: c, kind: 'transcript', created_at: new Date(base + (i + k) * 1000).toISOString()
        }))
        const { error: e2 } = await supabase.from('notes').insert(rows)
        if (e2) throw new Error(e2.message)
      }
      let summary = ''
      try { summary = await requestAi('Meeting', chunks.map(c => ({ kind: 'transcript', content: c })), true) }
      catch (e) { setError((e instanceof Error ? e.message : 'Summary failed') + ' The transcript was imported; open it and tap Summarize to retry.') }
      if (summary) await supabase.from('notes').insert({ session_id: id, content: summary, kind: 'ai' })
      setImportText(''); setImportTitle(''); setShowImport(false)
      await loadSessions(); setActive(sess as Row)
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed') }
    setImportBusy(false)
  }
  async function askNova() { await runAsk(null) }
  async function askQuick(key: QuickKey) { await runAsk(key) }
  async function runAsk(quick: QuickKey | null) {
    const a = activeRef.current
    if (!a || busyRef.current) return
    busyRef.current = true; lastAiRef.current = Date.now()
    setAiBusy(true); setError('')
    try {
      const base = notesRef.current.map(n => ({ kind: n.kind, content: n.content }))
      const full = base.reduce((n, x) => n + x.content.length, 0) > 12000
      // prep, reply language and quick-reply instructions ride along with the request but are not saved as notes
      const list = [...base, ...buildContext({ prep: prepRef.current, lang: langRef.current, quick })]
      const text = await requestAi(a.mode, list, full)
      const { error } = await supabase.from('notes').insert({ session_id: a.id, content: text, kind: 'ai' })
      if (error) { if (!sessionGone(error)) throw new Error(error.message) }
      else await loadNotes(a.id)
    } catch (e) {
      const m = e instanceof Error ? e.message : 'AI request failed'
      if (/quota|limit/i.test(m)) pauseRef.current = Date.now() + 10 * 60 * 1000
      setError(m)
    }
    busyRef.current = false
    setAiBusy(false)
  }

  const latestAi = [...notes].reverse().find(n => n.kind === 'ai')

  // ---- Live session layouts: chat feed, focus view, live + transcript tabs ----
  const lastHeard = [...notes].reverse().find(n => n.kind === 'transcript')
  const emptyHint = active ? (
    <>Tap <strong>Listen</strong> and start talking.<br />NOVA writes down what it hears and offers {active.mode === 'Meeting' ? 'summaries' : 'answer ideas'} as you go.</>
  ) : null
  const thinkingLabel = active?.mode === 'Meeting' ? 'NOVA is summarizing' : 'NOVA is thinking'
  const quickRow = (
    <div className="quick-row">
      {QUICK_KEYS.map(k => <button key={k} disabled={aiBusy} onClick={() => void askQuick(k)}>{QUICK[k].label}</button>)}
    </div>
  )
  const renderFeed = (withQuick: boolean): ReactNode => !active ? null : (
    <>
      {notes.length === 0 && !interim && <div className="empty">{emptyHint}</div>}
      {notes.map(n => n.kind === 'ai' ? (
        <div className="bubble ai" key={n.id}>
          <div className="meta">✧ NOVA<button className="copy" onClick={() => void copyText(n.content)}>Copy</button></div><div className="ai-title">{active.title}</div>{renderAi(n.content)}
          {withQuick && n.id === latestAi?.id && quickRow}
        </div>
      ) : n.kind === 'screen' ? (
        <div className="bubble screen" key={n.id}>
          <div className="meta">◫ On screen</div>{renderAi(n.content)}
        </div>
      ) : (
        <div className={`bubble ${n.kind}`} key={n.id}>
          <div className="meta">{n.kind === 'transcript' ? 'Heard' : 'Your note'}</div>{n.content}
        </div>
      ))}
      {interim && <div className="bubble transcript live"><div className="meta">Listening…</div>{interim}</div>}
      {aiBusy && <Thinking label={thinkingLabel} />}
      {readBusy && <Thinking label="NOVA is reading the screen" />}
      <div ref={endRef} className="feed-end" />
    </>
  )
  const latestCard = !active ? null : (
    <div className="latest-card">
      <div className="meta">✧ NOVA SUGGESTS{latestAi && <button className="copy" onClick={() => void copyText(latestAi.content)}>Copy</button>}</div>
      {aiBusy ? <Thinking label={thinkingLabel} /> : latestAi ? (<><div className="focus-text">{renderAi(latestAi.content)}</div>{quickRow}</>) : <div className="empty">{emptyHint}</div>}
    </div>
  )
  const heardStrip = (interim || lastHeard) ? (
    <div className="focus-heard"><div className="meta">{interim ? 'Listening…' : 'Just heard'}</div>{interim || lastHeard?.content}</div>
  ) : null
  const meter = micLevel !== null ? (
    <div className="mic-meter" role="status" aria-label="Microphone sound level">
      <div className="mic-meter-bar">
        <div className="mic-meter-fill" style={{ width: Math.min(100, Math.round(micLevel * 400)) + '%' }} />
        <i className="mic-meter-tick" style={{ left: Math.round(MIC_MIN_PEAK * 400) + '%' }} />
      </div>
      <span>{micLevel >= MIC_MIN_PEAK ? 'Hearing sound' : 'No sound yet'}</span>
    </div>
  ) : null

  // ---- Windows desktop shell: shortcuts and the floating overlay ----
  async function noteAndAsk(text: string) {
    const a = activeRef.current
    if (!a || !text.trim()) return
    const { error } = await supabase.from('notes').insert({ session_id: a.id, content: text.trim() })
    if (error) { setError(sessionGone(error) ? GONE_MESSAGE : error.message); return }
    await loadNotes(a.id)
    await new Promise(r => setTimeout(r, 60)) // let the new note reach notesRef before asking
    await askNova()
  }
  const actionRef = useRef<(a: any) => void>(() => undefined)
  actionRef.current = (a: any) => {
    if (a?.type === 'notice') { setNotice(String(a.text || '')); setTimeout(() => setNotice(''), 7000); return }
    if (!activeRef.current) { flash('Open a session first.'); return }
    if (a?.type === 'ask') void askNova()
    else if (a?.type === 'listen') { if (wantRef.current) stopListening(); else startListening() }
    else if (a?.type === 'screen') void (async () => { if (!streamRef.current) await startShare(); await readShared(false) })()
    else if (a?.type === 'note') void noteAndAsk(String(a.text || ''))
  }
  useEffect(() => {
    if (!desktop?.onAction) return
    return desktop.onAction((a: any) => actionRef.current(a))
  }, [])
  useEffect(() => {
    desktop?.sendOverlayState?.({ text: latestAi?.content ?? '', listening, capturing, busy: aiBusy, title: active?.title ?? '' })
  }, [latestAi?.content, listening, capturing, aiBusy, active?.title])
  const crumb = view === 'dashboard' ? 'Dashboard' : view === 'profile' ? 'Profile' : view === 'settings' ? 'Settings' : active ? 'Live session' : 'Sessions'
  const shownName: string = auth?.user.user_metadata?.display_name || ''
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'

  if (!ready) return null
  if (!configured) {
    return (
      <div className="auth"><div className="auth-card">
        <h2>Setup needed</h2>
        <p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example), then restart.</p>
      </div></div>
    )
  }
  if (!auth) return <Auth />
  if (recovery) return <ResetPassword onDone={() => setRecovery(false)} />

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">N</div>
          <div><h2>NOVA</h2><span>COPILOT</span></div>
        </div>
        <p className="section-label">WORKSPACE</p>
        <button className={`nav-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>◈ &nbsp; Dashboard</button>
        <button className={`nav-item ${view === 'sessions' ? 'active' : ''}`} onClick={() => setView('sessions')}>◷ &nbsp; Sessions</button>
        <button className={`nav-item ${view === 'profile' ? 'active' : ''}`} onClick={() => setView('profile')}>◐ &nbsp; Profile</button>
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>⚙ &nbsp; Settings</button>
        <div className="sidebar-bottom">
          <div className="profile" style={{ cursor: 'pointer' }} onClick={() => setView('profile')}>
            <div className="avatar">{(shownName || auth.user.email || 'N')[0].toUpperCase()}</div>
            <div><strong>{shownName || 'My Workspace'}</strong><small>{auth.user.email}</small></div>
          </div>
        </div>
      </aside>

      <main className="main">
        {!(view === 'sessions' && active) && (
          <header className="topbar">
            <span className="breadcrumb">Workspace / {crumb}</span>
            <div className="system-status"><span className="status-dot" />Synced</div>
          </header>
        )}
        {notice && <div className="toast ok-toast"><span>{notice}</span></div>}
        {error && <div className="toast"><span>{error}</span><button className="ghost" onClick={() => setError('')}>✕</button></div>}

        {view === 'profile' && <Profile user={auth.user} sessionCount={sessions.length} onDeleteAll={deleteAllData} onSignOut={() => void supabase.auth.signOut()} />}
        {view === 'settings' && <SettingsPage settings={settings} onChange={saveSettings} />}

        {view === 'dashboard' && (
          <>
            <section className="welcome">
              <span className="eyebrow">{greeting.toUpperCase()}{shownName ? `, ${shownName.toUpperCase()}` : ''}</span>
              <h1>Think clearly.<br /><span>Perform confidently.</span></h1>
              <p>Your AI assistant for meetings, interviews and important conversations for free.</p>
            </section>
            <section className="stats3">
              <div className="stat"><b>{sessions.length}</b><span>Sessions</span></div>
              <div className="stat"><b>{stats.notes}</b><span>Notes captured</span></div>
              <div className="stat"><b>{stats.ai}</b><span>AI suggestions</span></div>
            </section>
            <section className="mode-section">
              <div className="section-heading"><div><h2>Choose your workspace</h2><p>Select how NOVA should assist you.</p></div></div>
              <div className="mode-grid">
                <button className={`mode-card ${mode === 'Meeting' ? 'selected' : ''}`} onClick={() => setMode('Meeting')}>
                  <div className="mode-icon">◉</div><h3>Meeting Assistant</h3>
                  <p>Follow conversations, capture key points and generate meeting summaries .</p>
                </button>
                <button className={`mode-card ${mode === 'Interview' ? 'selected' : ''}`} onClick={() => setMode('Interview')}>
                  <div className="mode-icon">✧</div><h3>Interview Assistant</h3>
                  <p>Organize your thoughts, understand questions and prepare clear responses.</p>
                </button>
              </div>
            </section>
            <section className="session-panel">
              <div style={{ flex: 1, width: '100%' }}>
                <span className="eyebrow">READY TO BEGIN</span>
                <h2>{mode} session</h2>
                <input className="field" style={{ marginTop: 14, maxWidth: 420 }} placeholder="Session title (optional)"
                  value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <LoadButton className="start-button" onClick={createSession}>Start session <span>→</span></LoadButton>
            </section>
            {sessions.length > 0 && (
              <section className="recent">
                <div className="head-row"><h2>Recent sessions</h2><button className="ghost" onClick={() => setView('sessions')}>View all →</button></div>
                <div className="list">
                  {sessions.slice(0, 3).map(s => (
                    <button className="row row-link" key={s.id} onClick={() => { setActive(s); setView('sessions') }}>
                      <span className="row-main"><strong>{s.title}</strong><small><span className="badge">{s.mode.toUpperCase()}</span> {new Date(s.created_at).toLocaleString()}</small></span>
                      <span className="chev">→</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {view === 'sessions' && !active && (
          <section className="view">
            <div className="head-row">
              <h2>Your sessions</h2>
              <button className="ghost" onClick={() => setShowImport(!showImport)}>{showImport ? 'Close' : '+ Import meeting'}</button>
            </div>
            {showImport && (
              <div className="import">
                <p className="muted">Zoom on this phone? Import its transcript (.vtt or .txt), or paste text, and NOVA writes the summary.</p>
                <input className="field" placeholder="Meeting title (optional)" value={importTitle} onChange={e => setImportTitle(e.target.value)} />
                <label className="filebtn">Choose transcript file
                  <input type="file" hidden accept=".vtt,.srt,.txt,text/plain,text/vtt"
                    onChange={async e => {
                      const f = e.target.files?.[0]
                      if (f) { setImportText(await f.text()); if (!importTitle) setImportTitle(f.name.replace(/\.[^.]+$/, '')) }
                    }} />
                </label>
                <textarea className="field" rows={6} placeholder="...or paste the transcript here" value={importText} onChange={e => setImportText(e.target.value)} />
                <LoadButton className="start-button" loading={importBusy} disabled={!importText.trim()} onClick={importMeeting}>
                  {importBusy ? 'Importing and summarizing…' : 'Import & summarize'}
                </LoadButton>
              </div>
            )}
            <SessionList sessions={sessions} onOpen={setActive} onDelete={deleteSession} onRename={renameSession} />
          </section>
        )}

        {view === 'sessions' && active && (
          <section className="session">
            <div className="session-head">
              <button className="ghost" onClick={() => setActive(null)} aria-label="Back to sessions">←</button>
              <div className="grow">
                <h2>{active.title}</h2>
                <small><span className="status-dot" title="Synced" /> {new Date(active.created_at).toLocaleString()} <span className="badge">{active.mode.toUpperCase()}</span></small>
              </div>
              <button className="ghost menu-btn" onClick={() => setMenuOpen(o => !o)} aria-label="Menu" aria-expanded={menuOpen}>☰</button>
              {menuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="menu-panel" role="menu">
                    <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); void copyText(sessionText()) }}>⧉ Copy all</button>
                    <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); exportTxt() }}>⇩ Export</button>
                    <LoadButton className="menu-item" onClick={async () => { await learnFrom(active, notes, true); setMenuOpen(false) }}>✧ Learn</LoadButton>
                    <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); openPrep() }}>{prep ? '📎 Prep ✓' : '📎 Prep'}</button>
                    <label className="menu-item menu-row">
                      <span>Language</span>
                      <select className="lang-select" value={chatLang} onChange={e => { changeLang(e.target.value as Lang); setMenuOpen(false) }} aria-label="Language">
                        {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                    </label>
                    <label className="menu-item menu-row">
                      <span>Layout</span>
                      <select className="lang-select" value={layout} onChange={e => { changeLayout(e.target.value as Layout); setMenuOpen(false) }} aria-label="Layout">
                        {LAYOUTS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                    </label>
                  </div>
                </>
              )}
            </div>
            {prepOpen && (
              <div className="prep-panel">
                <p>Load a PDF or text file, or paste your CV, the job description or any notes. NOVA uses them to tailor its answers in this session.</p>
                <textarea value={prepDraft} maxLength={MAX_PREP} onChange={e => setPrepDraft(e.target.value)} placeholder="e.g. I am a data analyst with 3 years of experience. The job is…" />
                <div className="prep-row">
                  <button className="ghost" onClick={() => { commitPrep(prepDraft); setPrepOpen(false) }}>Save</button>
                  <label className="ghost" style={{ cursor: 'pointer' }}>{prepReading ? 'Reading PDF…' : 'Load PDF or .txt'}
                    <input type="file" accept=".pdf,application/pdf,.txt,.md,.csv,text/plain" hidden disabled={prepReading} onChange={e => { const f = e.target.files?.[0]; if (f) void loadPrepFile(f); e.target.value = '' }} />
                  </label>
                  {loadLastPrep(store) && loadLastPrep(store) !== prepDraft && <button className="ghost" onClick={() => setPrepDraft(loadLastPrep(store))}>Use my last prep</button>}
                  {prepDraft && <button className="ghost" onClick={() => { setPrepDraft(''); commitPrep('') }}>Clear</button>}
                  <span className="prep-count">{prepDraft.length}/{MAX_PREP}</span>
                </div>
              </div>
            )}

            {layout === 'chat' && <div className="feed">{renderFeed(true)}</div>}

            {layout === 'focus' && (
              <div className="focus">
                {latestCard}
                {heardStrip}
                <button className="ghost focus-more" onClick={() => setShowConvo(v => !v)}>{showConvo ? 'Hide conversation' : `Show conversation (${notes.length})`}</button>
                {showConvo && <div className="feed">{renderFeed(false)}</div>}
              </div>
            )}

            {layout === 'tabs' && (
              <>
                <div className="tabs-bar" role="tablist">
                  <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>Live</button>
                  <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>Transcript ({notes.length})</button>
                </div>
                {tab === 'live' ? <div className="focus">{latestCard}{heardStrip}</div> : <div className="feed">{renderFeed(false)}</div>}
              </>
            )}

            {meter}
            <Dock
              mode={active.mode}
              layout={layout}
              listening={listening} auto={auto} capturing={capturing} sharing={sharing} watching={watching}
              readBusy={readBusy} aiBusy={aiBusy} hasNotes={notes.length > 0}
              canListen={speechSupported || cloudMicSupported} canShare={canShare}
              pin={layout === 'chat' && latestAi ? renderAi(latestAi.content) : null}
              noteText={noteText}
              onNoteChange={setNoteText}
              onToggleListen={listening ? stopListening : startListening}
              onToggleAuto={() => setAuto(!auto)}
              onSummarize={askNova}
              onToggleShare={sharing ? stopShare : startShare}
              onToggleCapture={capturing ? stopCapture : startCapture}
              onReadNow={() => readShared(false)}
              onToggleWatch={() => setWatching(!watching)}
              onFile={f => void readFile(f)}
              onSend={sendNote}
            />
          </section>
        )}

        {view === 'dashboard' && <footer><span>NOVA COPILOT · Think smart</span><span>created by Joe</span></footer>}
      </main>
    </div>
  )
}

export default App
