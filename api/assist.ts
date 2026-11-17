// Vercel serverless function: keeps the AI keys on the server.
export const config = { maxDuration: 60 }

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------
const FULL_MEETING =
  'You are NOVA, summarizing a full meeting transcript. Reply in plain text with these sections: **Overview** (3-4 sentences), **Key discussion points** (short bullets), **Decisions made**, **Action items** (owner and deadline if stated), **Open questions**. Use only what is in the transcript and name speakers when the transcript gives names. Be concise and precise.'

const LEARN =
  'You extract lasting facts about the USER from a session so an assistant can personalise future help. Facts must be about the user themselves: skills, education, experience, projects, goals, interests, preferences, languages, how they like answers. Lines starting with USER NOTE are the user. Lines starting with HEARD may include other people, so ignore anything about anyone else and anything you are unsure the user said about themselves. Never include sensitive data (health, money, passwords, ID numbers, exact location, relationships, politics, religion) or temporary details. Do not repeat facts already known. Output ONLY a JSON array of up to 4 short strings, each under 140 characters, or [] if there is nothing lasting.'

const TRANSCRIBE =
  'You transcribe meeting audio. Output only the words spoken, exactly as heard, with no commentary. If there is no clear speech, output exactly [silence].'

const SCREEN =
  'You are NOVA. You read a screenshot for the user during a live conversation. Reply in plain text: one line saying what is on screen, then the important readable text (questions, headings, numbers, names) as short bullets. If it shows a question or problem, add a line starting with "Suggested answer:" and a short outline. Never guess at text you cannot read.'

// Speech recognition mishears names and technical terms ("Joe Cash" -> "joke ash"). The fix happens here on the
// server with no word list for the user to maintain: the model uses the user's background and the rest of the
// conversation to work out what was most likely said.
const MISHEARD =
  ' The HEARD lines come from live speech recognition and may contain mis-heard words, especially names, product names and technical terms. Use the background about the user and the rest of the conversation to work out what was most likely said, and answer that. Only if a correction changes the meaning of a question, add one short line starting "Heard as:" with your best guess. Say nothing about this when the transcript is clear.'

const MISHEARD_LEARN =
  ' HEARD lines come from speech recognition and may contain mistakes, so skip any fact you are not sure about.'

const SPELLING_HINT =
  ' Use the background below ONLY to spell names and technical terms correctly when you hear them. Never add words that were not spoken.'

const PROMPTS: Record<string, string> = {
  Meeting:
    'You are NOVA, a sharp meeting assistant. Using the transcript and notes, reply in plain text with: **Summary** (2-3 sentences), **Key points** (short bullets), **Action items** (owner if mentioned) and, only if useful, **Watch out** (risks or unanswered questions). Be precise and never invent facts. Lines starting with ON SCREEN were read from the user\'s screen.',
  Interview:
    'You are NOVA, an expert interview coach helping the user answer live. Find the most recent question (lines starting with HEARD, or ON SCREEN if the screen shows a question). Reply in plain text with: **Question type** (behavioral, technical, situational or general), **What they want** (one line), **Answer outline** (3-4 short bullets in the order to say them; use the STAR structure for behavioral questions) and **Opening line** the user can start with. Ground examples in the background the user shared. If it has nothing relevant, say so briefly and give an honest framework instead of inventing experience or credentials. Be concise.'
}

// ---------------------------------------------------------------------------------------------
// Models. Each model has its own free daily quota, so we fall through the list when one is used up.
// Change model names here (or set GEMINI_MODEL in Vercel to try one first).
// ---------------------------------------------------------------------------------------------
type Brain = 'fast' | 'smart'
const MODELS: Record<Brain, string[]> = {
  fast: ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  smart: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
}

// ---------------------------------------------------------------------------------------------
// Backup providers (free tiers). Gemini is tried first. When it is out of quota, too slow or failing, the request
// moves on to these in order. A provider is used only when its key is set in Vercel:
//   GROQ_API_KEY        chat (Llama / GPT-OSS) and speech-to-text (Whisper)
//   CEREBRAS_API_KEY    also needs CEREBRAS_MODELS, a comma list of model ids from your Cerebras account
//   MISTRAL_API_KEY     chat
//   OPENROUTER_API_KEY  chat and images, using OpenRouter's free-models router
// Optional overrides (comma lists): GROQ_MODELS, MISTRAL_MODELS, OPENROUTER_MODELS,
//   GROQ_VISION_MODEL, MISTRAL_VISION_MODEL, OPENROUTER_VISION_MODELS
// ---------------------------------------------------------------------------------------------
const list = (v: string | undefined, fallback: string[]): string[] => {
  const x = (v || '').split(',').map(s => s.trim()).filter(Boolean)
  return x.length ? x : fallback
}

interface Backup { key: string; base: string; apiKey: string; models: string[]; vision: string[] }

function backups(): Backup[] {
  const env = process.env
  const out: Backup[] = []
  if (env.GROQ_API_KEY) out.push({ key: 'groq', base: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, models: list(env.GROQ_MODELS, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant']), vision: list(env.GROQ_VISION_MODEL, []) })
  if (env.CEREBRAS_API_KEY && env.CEREBRAS_MODELS) out.push({ key: 'cerebras', base: 'https://api.cerebras.ai/v1', apiKey: env.CEREBRAS_API_KEY, models: list(env.CEREBRAS_MODELS, []), vision: [] })
  if (env.MISTRAL_API_KEY) out.push({ key: 'mistral', base: 'https://api.mistral.ai/v1', apiKey: env.MISTRAL_API_KEY, models: list(env.MISTRAL_MODELS, ['mistral-small-latest']), vision: list(env.MISTRAL_VISION_MODEL, []) })
  if (env.OPENROUTER_API_KEY) out.push({ key: 'openrouter', base: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, models: list(env.OPENROUTER_MODELS, ['openrouter/free']), vision: list(env.OPENROUTER_VISION_MODELS, ['openrouter/free']) })
  return out
}

// A provider that just said "too many requests" is skipped for a while, so later requests do not wait on it.
// This lives in memory on a warm server instance, which is good enough to save most of the wasted waiting.
const coolUntil: Record<string, number> = {}
const isCooling = (key: string) => Date.now() < (coolUntil[key] || 0)
function cool(key: string, res: any, fallbackMs = 60000) {
  const secs = Number(res?.headers?.get?.('retry-after'))
  const ms = Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, 30 * 60000) : fallbackMs
  coolUntil[key] = Date.now() + ms
}

// Backups only get the most recent part of long text: free tiers have small per-minute token limits.
const BACKUP_TEXT_CHARS = 20000

// A JSON-array answer ("learn") must be an array. Backup models sometimes wrap it in text or code fences.
function asJsonArray(s: string): string {
  const m = s.match(/\[[\s\S]*\]/)
  if (!m) return '[]'
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? JSON.stringify(v) : '[]' } catch { return '[]' }
}

interface BackupJob {
  task: TaskName
  system: string
  text: string
  image: string
  audio: string
  audioMime: string
  lang: string
  tokens: number
  wantsJson: boolean
  deadline: number // timestamp after which we stop trying
}

const remaining = (job: BackupJob) => job.deadline - Date.now()

async function groqTranscribe(job: BackupJob): Promise<string | null> {
  const key = process.env.GROQ_API_KEY
  if (!key || isCooling('groq-stt')) return null
  const bytes = Uint8Array.from(atob(job.audio), c => c.charCodeAt(0))
  const m = job.audioMime
  const ext = m.includes('wav') ? 'wav' : m.includes('mp4') || m.includes('m4a') || m.includes('aac') ? 'm4a' : m.includes('ogg') ? 'ogg' : m.includes('mpeg') || m.includes('mp3') ? 'mp3' : 'webm'
  for (const model of list(process.env.GROQ_STT_MODELS, ['whisper-large-v3-turbo', 'whisper-large-v3'])) {
    const ms = Math.min(20000, remaining(job))
    if (ms < 3000) return null
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: m }), `audio.${ext}`)
    form.append('model', model)
    form.append('response_format', 'json')
    form.append('temperature', '0')
    if (job.lang === 'en' || job.lang === 'sw') form.append('language', job.lang) // mixed speech: let Whisper detect
    const t0 = Date.now()
    try {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(ms) })
      console.log(`assist backup task=transcribe provider=groq model=${model} status=${r.status} ms=${Date.now() - t0}`)
      if (r.status === 429) { cool('groq-stt', r); return null }
      if (r.status === 401 || r.status === 403) return null
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const t = typeof j?.text === 'string' ? j.text.trim() : ''
      return t || '[silence]'
    } catch (e: any) {
      console.log('assist backup failed transcribe groq', model, e?.name, Date.now() - t0, 'ms')
    }
  }
  return null
}

async function backupChat(job: BackupJob): Promise<{ text: string; via: string } | null> {
  const wantsImage = job.task === 'screen'
  for (const b of backups()) {
    if (isCooling(b.key)) continue
    const models = wantsImage ? b.vision : b.models
    if (!models.length) continue
    const user: any = wantsImage
      ? [{ type: 'text', text: 'Read this screen.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${job.image}` } }]
      : job.text.slice(-BACKUP_TEXT_CHARS)
    for (const model of models) {
      const ms = Math.min(20000, remaining(job))
      if (ms < 3000) return null
      const t0 = Date.now()
      try {
        const r = await fetch(`${b.base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${b.apiKey}`, 'content-type': 'application/json', ...(b.key === 'openrouter' ? { 'X-Title': 'NOVA Copilot' } : {}) },
          signal: AbortSignal.timeout(ms),
          body: JSON.stringify({ model, max_tokens: job.tokens, temperature: 0.3, messages: [{ role: 'system', content: job.system }, { role: 'user', content: user }] })
        })
        console.log(`assist backup task=${job.task} provider=${b.key} model=${model} status=${r.status} ms=${Date.now() - t0}`)
        if (r.status === 429) { cool(b.key, r); break } // this provider is out for now: go to the next provider
        if (r.status === 401 || r.status === 403) break // bad or missing key: skip the provider
        if (!r.ok) continue // maybe a retired model name: try its next model
        const j: any = await r.json().catch(() => ({}))
        const raw = j?.choices?.[0]?.message?.content
        const text = (typeof raw === 'string' ? raw : '').trim()
        if (!text) continue
        return { text: job.wantsJson ? asJsonArray(text) : text, via: b.key }
      } catch (e: any) {
        console.log('assist backup failed', job.task, b.key, model, e?.name, Date.now() - t0, 'ms')
      }
    }
  }
  return null
}

// Is there any backup that could handle this kind of job?
function hasBackup(task: TaskName): boolean {
  if (task === 'transcribe') return Boolean(process.env.GROQ_API_KEY)
  return backups().some(b => (task === 'screen' ? b.vision : b.models).length > 0)
}

async function tryBackups(job: BackupJob): Promise<{ text: string; via: string } | null> {
  if (job.task === 'transcribe') {
    const t = await groqTranscribe(job)
    return t === null ? null : { text: t, via: 'groq' }
  }
  return backupChat(job)
}

// ---------------------------------------------------------------------------------------------
// Tasks. To add a new kind of AI job, add one entry here and send its name as `task` from the app.
// ---------------------------------------------------------------------------------------------
type TaskName = 'assist' | 'summary' | 'transcribe' | 'screen' | 'learn'

interface TaskConfig {
  system: (mode: string, style: string, context: string) => string
  fastOnly: boolean // always use the quick models, whatever the user's AI mode is
  tokens: number // max output tokens
  long: boolean // slower job (audio, images, long transcripts): allow a longer wait
  json?: boolean // ask the model for JSON
  textChars: number // how much of the notes text to send (the most recent part)
}

const TASKS: Record<TaskName, TaskConfig> = {
  assist: { system: (mode, style, ctx) => PROMPTS[mode] + MISHEARD + style + ctx, fastOnly: false, tokens: 2048, long: false, textChars: 12000 },
  summary: { system: (_m, _s, ctx) => FULL_MEETING + MISHEARD + ctx, fastOnly: false, tokens: 4096, long: true, textChars: 150000 },
  transcribe: { system: (_m, _s, ctx) => TRANSCRIBE + (ctx ? SPELLING_HINT + ctx.slice(0, 1500) : ''), fastOnly: true, tokens: 1200, long: true, textChars: 12000 },
  screen: { system: () => SCREEN, fastOnly: false, tokens: 1500, long: true, textChars: 12000 },
  learn: { system: (_m, _s, ctx) => LEARN + MISHEARD_LEARN + ctx, fastOnly: true, tokens: 500, long: false, json: true, textChars: 12000 }
}

function isTask(v: unknown): v is TaskName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TASKS, v)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const began = Date.now()

  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const apiKey = process.env.GEMINI_API_KEY
  const anyBackup = backups().length > 0
  if (!url || !anon || (!apiKey && !anyBackup)) return res.status(500).json({ error: 'Server is not configured' })

  // Only signed-in users may spend AI credits.
  const token = String(req.headers.authorization || '').replace('Bearer ', '')
  const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } })
  if (!who.ok) return res.status(401).json({ error: 'Please sign in again' })
  const account: any = await who.json().catch(() => ({}))
  const prefs: any = account?.user_metadata?.settings ?? {}
  const brain: Brain = prefs.brain === 'fast' ? 'fast' : 'smart'
  const memories: string[] = Array.isArray(prefs.memories)
    ? prefs.memories.filter((m: unknown) => typeof m === 'string').slice(0, 40).map((m: string) => m.trim().slice(0, 500)).filter(Boolean)
    : []
  const learnedFacts: string[] = Array.isArray(prefs.learned)
    ? prefs.learned.filter((m: unknown) => typeof m === 'string').slice(-60).map((m: string) => m.trim().slice(0, 300)).filter(Boolean)
    : []
  const legacy = typeof prefs.about === 'string' ? prefs.about.trim().slice(0, 2000) : ''
  const about = [...memories.map(m => `- ${m}`), ...learnedFacts.map(m => `- ${m}`), legacy].filter(Boolean).join('\n')
  const userName = typeof account?.user_metadata?.display_name === 'string' ? account.user_metadata.display_name.trim().slice(0, 60) : ''

  let body: any
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).json({ error: 'Invalid request' }) }

  const mode = body?.mode === 'Interview' ? 'Interview' : 'Meeting'
  const audio = typeof body?.audio === 'string' && body.audio.length < 4200000 ? body.audio : ''
  const audioMime = typeof body?.mime === 'string' && body.mime.startsWith('audio/') ? body.mime.split(';')[0] : 'audio/webm'
  const image = typeof body?.image === 'string' && body.image.length < 4000000 ? body.image : ''
  const lang = body?.lang === 'sw' || body?.lang === 'mixed' || body?.lang === 'en' ? body.lang : ''

  // The app sends `task`. Older app versions sent flags (learn / audio / image / full), so still understand those.
  let task: TaskName = isTask(body?.task)
    ? body.task
    : body?.learn === true ? 'learn' : audio ? 'transcribe' : image ? 'screen' : body?.full === true ? 'summary' : 'assist'
  if (task === 'summary' && mode !== 'Meeting') task = 'assist' // full-transcript summaries are Meeting-only
  const cfg = TASKS[task]

  const style = body?.style === 'detailed' ? ' Give a fuller, more detailed answer.' : ' Keep it very short: at most 6 short lines.'
  const notes: { kind: string; content: string }[] = Array.isArray(body?.notes) ? body.notes : []
  const text = notes
    .filter(n => n.kind !== 'ai')
    .map(n => `${n.kind === 'transcript' ? 'HEARD' : n.kind === 'screen' ? 'ON SCREEN' : 'USER NOTE'}: ${n.content}`)
    .join('\n')
    .slice(-cfg.textChars)
  const noInput = task === 'transcribe' ? !audio : task === 'screen' ? !image : !text.trim()
  if (noInput) return res.status(400).json({ error: 'Nothing to analyze yet. Record or add notes first.' })

  const context =
    (userName ? `\n\nThe user's name is ${userName}.` : '') +
    (about ? `\n\nBackground the user shared about themselves (use only when relevant; never invent beyond it):\n${about}` : '')
  const langHint = task === 'transcribe'
    ? lang === 'sw' ? ' The speech is in Kiswahili.' : lang === 'mixed' ? ' The speech may mix English and Kiswahili. Write each word in the language it was spoken in.' : ''
    : ''
  const system = cfg.system(mode, style, context) + langHint

  const chain: Brain = cfg.fastOnly ? 'fast' : brain
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...MODELS[chain]] : MODELS[chain]
  const level = chain === 'smart' ? 'medium' : 'low'
  const limit = cfg.long ? 35000 : brain === 'smart' ? 25000 : 18000
  const parts =
    task === 'transcribe' ? [{ inlineData: { mimeType: audioMime, data: audio } }, { text: 'Transcribe this audio.' }]
    : task === 'screen' ? [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: 'Read this screen.' }]
    : [{ text }]
  const ask = (model: string, thinking: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey as string, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(limit),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: cfg.tokens, ...(cfg.json ? { responseMimeType: 'application/json' } : {}), ...(thinking ? { thinkingConfig: { thinkingLevel: level } } : {}) }
      })
    })

  // Gemini: walk through its models until one answers.
  const runGemini = async () => {
    let r: any = null
    if (!apiKey) return { r, data: {} as any, out: '' }
    const start = Date.now()
    for (const m of models) {
      if (Date.now() - start > 30000) break
      const t0 = Date.now()
      try {
        r = await ask(m, true)
        if (r.status === 400) r = await ask(m, false) // model may not support thinking levels
        console.log(`assist task=${task} model=${m} brain=${brain} status=${r.status} ms=${Date.now() - t0}`)
        if (r.ok) break
      } catch (e: any) {
        console.log('assist failed', task, m, e?.name, Date.now() - t0, 'ms')
        r = null
      }
    }
    const data: any = r ? await r.json().catch(() => ({})) : {}
    const out = r?.ok ? (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim() : ''
    return { r, data, out }
  }

  const runBackups = () => tryBackups({
    task, system, text, image, audio, audioMime, lang,
    tokens: cfg.tokens, wantsJson: Boolean(cfg.json),
    deadline: began + 52000 // the function may run for 60 seconds
  })

  const canBackup = hasBackup(task)
  const geminiCooling = canBackup && isCooling('gemini')

  // If Gemini hit its limit a moment ago, go straight to the backups and keep Gemini as the last resort.
  if (geminiCooling) {
    const alt = await runBackups()
    if (alt) return res.status(200).json({ text: alt.text, via: alt.via })
  }

  const g = await runGemini()
  if (g.out) return res.status(200).json({ text: g.out, via: 'gemini' })
  if (g.r?.status === 429) coolUntil.gemini = Date.now() + 120000

  // Gemini is out of quota, too slow or failing: try the other free providers in order.
  if (canBackup && !geminiCooling) {
    const alt = await runBackups()
    if (alt) return res.status(200).json({ text: alt.text, via: alt.via })
  }

  if (!g.r) return res.status(apiKey ? 504 : 502).json({ error: apiKey ? 'The AI took too long to answer. Please try again.' : 'No AI provider could answer this. Try again shortly.' })
  if (g.r.status === 429) return res.status(429).json({ error: canBackup ? 'The free AI limit is used up on every provider for now. It resets daily. Try again later.' : 'The free AI limit for today is used up on every model. It resets daily. To remove the limit, enable billing in Google AI Studio, or add another provider key in Vercel (GROQ_API_KEY).' })
  if (!g.r.ok) return res.status(502).json({ error: g.data?.error?.message || 'AI request failed' })
  return res.status(502).json({ error: 'The AI returned no answer. Try again.' })
}
