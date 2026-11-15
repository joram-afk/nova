// Pure helpers for session prep (CV / job description / notes), reply language and quick-reply buttons.

export type Lang = 'en' | 'sw' | 'mixed'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'mixed', label: 'English + Kiswahili' }
]

export const MAX_PREP = 6000

export type QuickKey = 'shorter' | 'example' | 'simple'
export const QUICK: Record<QuickKey, { label: string; instruction: string }> = {
  shorter: { label: 'Shorter', instruction: 'Rewrite your previous answer in at most two short sentences.' },
  example: { label: 'Give an example', instruction: 'Give one short, concrete example I can say that supports your previous answer.' },
  simple: { label: 'Explain simply', instruction: 'Explain your previous answer in plain, simple words, as if to someone new to the topic.' }
}
export const QUICK_KEYS = Object.keys(QUICK) as QuickKey[]

export function cleanPrep(s: string): string {
  return String(s || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_PREP)
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'sw' || v === 'mixed'
}

// What the AI should be told about language. English needs no instruction.
export function languageInstruction(lang: Lang): string {
  if (lang === 'sw') return 'Write your reply in Kiswahili. Keep names and technical terms as they are.'
  if (lang === 'mixed') return 'The speakers mix English and Kiswahili. Understand both. Reply in the language of the last thing said, and use English if unsure.'
  return ''
}

// Language code for the browser's live speech recognition.
export function srLang(lang: Lang, fallback: string): string {
  if (lang === 'sw') return 'sw-KE'
  if (lang === 'mixed') return 'en-KE'
  return fallback || 'en-US'
}

export interface ContextNote { kind: string; content: string }

// Extra notes added to the end of the conversation sent to the AI. They are never saved.
// They go last so the server cannot drop them when it keeps only the most recent notes.
export function buildContext(opts: { prep: string; lang: Lang; quick: QuickKey | null }): ContextNote[] {
  const out: ContextNote[] = []
  const prep = cleanPrep(opts.prep)
  if (prep) out.push({ kind: 'note', content: 'BACKGROUND FROM THE USER (CV, job description or notes). Use it to tailor your answers to them. Do not repeat it back unless asked:\n' + prep })
  const lang = languageInstruction(opts.lang)
  if (lang) out.push({ kind: 'note', content: 'INSTRUCTION: ' + lang })
  if (opts.quick) out.push({ kind: 'note', content: 'INSTRUCTION: ' + QUICK[opts.quick].instruction })
  return out
}

// ---- storage (injected so it can be tested; the app passes localStorage) ----
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const prepKey = (id: string) => 'nova.prep.' + id

export function loadPrep(store: Store | null, sessionId: string): string {
  try { return store?.getItem(prepKey(sessionId)) || '' } catch { return '' }
}
export function loadLastPrep(store: Store | null): string {
  try { return store?.getItem('nova.prep.last') || '' } catch { return '' }
}
export function savePrep(store: Store | null, sessionId: string, text: string): string {
  const clean = cleanPrep(text)
  try {
    store?.setItem(prepKey(sessionId), clean)
    if (clean) store?.setItem('nova.prep.last', clean)
  } catch { /* storage blocked */ }
  return clean
}
export function loadLang(store: Store | null): Lang {
  try { const v = store?.getItem('nova.lang'); return isLang(v) ? v : 'en' } catch { return 'en' }
}
export function saveLang(store: Store | null, lang: Lang) {
  try { store?.setItem('nova.lang', lang) } catch { /* storage blocked */ }
}

// ---- PDF text ----
export interface PdfItem { str?: string; transform?: number[]; width?: number; hasEOL?: boolean }

// Turn the text pieces pdf.js returns for one page into readable lines.
export function joinPdfItems(items: PdfItem[]): string {
  let out = ''
  let lastY: number | null = null
  let lastEnd: number | null = null
  for (const it of items) {
    const str = typeof it.str === 'string' ? it.str : ''
    const x = Array.isArray(it.transform) ? it.transform[4] : null
    const y = Array.isArray(it.transform) ? it.transform[5] : null
    if (out && lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      out = out.replace(/[ \t]+$/, '') + '\n' // new line on the page
    } else if (out && str && !out.endsWith(' ') && !out.endsWith('\n') && !str.startsWith(' ')) {
      // same line: add a space only when there is a visible gap, so split words stay whole
      const gap = x !== null && lastEnd !== null ? x - lastEnd : 2
      if (gap > 1) out += ' '
    }
    out += str
    if (it.hasEOL) { out += '\n'; lastY = null; lastEnd = null; continue }
    if (str.trim()) {
      if (y !== null) lastY = y
      lastEnd = x !== null && typeof it.width === 'number' ? x + it.width : null
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
