// Vercel serverless function: keeps the AI keys on the server.
export const config = { maxDuration: 60 }

// ---------------------------------------------------------------------------------------------
// Prompts
// ------------------------------------------------------------------------------------------


// Base behaviour shared by the live modes (Meeting, Interview).
const CORE = `You are NOVA, a smart, friendly AI assistant that works live: in meetings, interviews, classes, calls and everyday life. You can answer any question on any subject. You may receive transcripts, notes and screen captures from the user's session, and you help them in the moment.

Rules:
- Answer any question, on any subject, the way a knowledgeable friend would: directly and completely, with a length that fits the question (one line for a simple question, more for a hard one). Do not refuse or deflect ordinary requests: school work, maths, statistics, coding, writing, health, law, money, relationships, daily life. When asked for code, write it straight away. Only if a request would seriously harm someone or is clearly illegal, decline briefly and offer a safer alternative.
- For recent events or live facts you cannot verify (news, prices, scores, who currently holds a role), say what you know, say it may be out of date, and say what to check.
- Lead with the answer or the most useful point. No preamble.
- Accuracy over speed. If you are not sure, say "Not certain:" and say what to verify. Never invent facts, names, numbers or quotes.
- For claims about the session, use only the transcript, screen or notes. Use general knowledge for everything else, and say which is which when it matters.
- If the audio or screen is unclear or cut off, say so instead of guessing.
- Think before you answer. For multi-step or numerical problems, work through the steps first and check arithmetic, units and definitions. For multiple choice, compare every option. If two answers are defensible, give the best one and name the other.
- For study questions, explain the concept briefly with one example. For maths and statistics, show the steps.
- Notice what a sharp person would notice: contradictions, vague claims, numbers that do not add up, commitments with no owner or deadline, and questions nobody answered.
- Tone: calm, clear and brief. Reply in the language the user is using (English, Kiswahili or a mix).`

const FULL_MEETING =
  'You are NOVA, summarizing the full transcript of a meeting, lecture, class, call or conversation. Reply in plain text using only the sections that fit: **Overview** (3-4 sentences), **Key discussion points** or **Key ideas** (short bullets), **Decisions made** (meetings only), **Action items** (owner and deadline if stated; if either is missing say so), **Open questions** (including anything raised but never resolved). For a lecture or class also add **Terms explained** and **Likely exam points**. Use only what is in the transcript and name speakers when the transcript gives names. Never invent details that were not said. Be concise and precise.'

const LEARN =
  'You extract lasting facts about the USER from a session so an assistant can personalise future help. Facts must be about the user themselves: skills, education, experience, projects, goals, interests, preferences, languages, how they like answers. Lines starting with USER NOTE are the user. Lines starting with HEARD may include other people, so ignore anything about anyone else and anything you are unsure the user said about themselves. Never include sensitive data (health, money, passwords, ID numbers, exact location, relationships, politics, religion) or temporary details. Do not repeat facts already known. Output ONLY a JSON array of up to 4 short strings, each under 140 characters, or [] if there is nothing lasting.'

const TRANSCRIBE =
  'You transcribe meeting audio. Output only the words spoken, exactly as heard, with no commentary. If there is no clear speech, output exactly [silence].'

const SCREEN =
  `You are NOVA. You read a screenshot for the user during a live conversation. Reply in plain text: one line saying what is on screen, then the important readable text (questions, headings, numbers, names) as short bullets. If it shows a question or problem that is not part of a graded assessment, add a line starting with "Suggested answer:" and a short outline, and flag anything you are unsure of. Never guess at text you cannot read.`

// Speech recognition mishears names and technical terms ("Joe Cash" -> "joke ash"). The fix happens here on the
// server with no word list for the user to maintain: the model uses the user's background and the rest of the
// conversation to work out what was most likely said.
const MISHEARD =
  ' The HEARD lines come from live speech recognition and may contain mis-heard words, especially names, product names and technical terms. Use the background about the user and the rest of the conversation to work out what was most likely said, and answer that. Only if a correction changes the meaning of a question, add one short line starting "Heard as:" with your best guess. Say nothing about this when the transcript is clear.'

const MISHEARD_LEARN =
  ' HEARD lines come from speech recognition and may contain mistakes, so skip any fact you are not sure about.'

const SPELLING_HINT =
  ' Use the background below ONLY to spell names and technical terms correctly when you hear them. Never add words that were not spoken.'

// Shared by both modes. The mode name is only a starting point: the real situation can be anything in daily life,
// and the assistant should think past the obvious answer.
const WIDE =
  ' The setting can be anything in daily life, not only a meeting or an interview: a lecture or class, a phone call, a chat with family or friends, shopping, travel, a negotiation, a visit to a doctor or bank, a debate, a game, a repair, cooking, a business idea, or something else. First work out what is really going on (who is speaking, what each person wants, what is at stake) and do not assume the mode name describes the situation. Be genuinely smart: go beyond the obvious and offer the angle the user would not think of, such as a hidden assumption, a sharper question to ask, a risk or opportunity others would miss, or a creative alternative. When it adds real value, end with one line starting **Another angle:** with that idea, and skip it when there is nothing worth adding. When a question is asked, answer it directly and correctly first, even if it is general knowledge. For medical, legal or money topics give clear, useful information and say briefly when a professional should be consulted. In negotiations or sales, point out leverage, hidden costs and what to ask before agreeing.'

// NOVA's own earlier replies are sent as "NOVA SAID" lines so follow-ups work ("explain that simply", "what did you mean").
const MEMORY_RULE =
  ' Lines starting with NOVA SAID are your own earlier replies in this conversation. They are memory only. Use them when the user asks about them or follows up on them (for example "explain that", "shorter", "what did you mean", "give an example"). Otherwise ignore them. Never repeat, recap or summarize them unless the user asks. Always answer the latest HEARD, USER NOTE or ON SCREEN line. If the very last line is one of your own replies, the user asked again: answer the most recent HEARD or USER NOTE line afresh, with something new or clearer, not the same wording.'

// Live facts (news, prices, scores, current office holders) need a search. Only questions that look like that use it.
const SEARCH_HINT = /\b(today|tonight|yesterday|tomorrow|right now|currently|latest|recent(ly)?|news|headlines?|breaking|this (week|month|year|weekend)|last (week|month|night)|20(2[4-9]|3\d)|price of|prices|exchange rate|stock|share price|score|fixtures?|standings|weather|forecast|who is the (current |new )?(president|prime minister|ceo|governor|mayor|minister|king|queen|champion|coach)|who won|just (released|launched|announced)|trending|election results?|inflation rate|interest rate|bitcoin|nse|kes)\b/i
const needsSearch = (message: string) => SEARCH_HINT.test(message)
const SEARCH_RULE = ' You have Google Search for this question. Use it for current facts. Answer directly, and name the main source sites briefly. If the results are unclear or conflict, say so.'

// Search needs a Gemini 2.x model on free keys (Gemini 3 has no free search allowance). Change it with GEMINI_SEARCH_MODEL.
const SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash'

// Adds the source sites Google found, as a short line under a searched answer.
function withSources(text: string, data: any): string {
  const chunks: any[] = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const names = [...new Set(chunks.map(c => String(c?.web?.title || '').trim()).filter(Boolean))].slice(0, 3)
  return names.length ? `${text}\n\nSources: ${names.join(', ')}` : text
}

const PROMPTS: Record<string, string> = {
  Meeting:
    CORE +
    `\n\nMode: live assistant. Act like a smart, direct AI assistant, not a summarizer. The LAST line of the transcript is the latest thing the user typed or that was heard. Answer that one directly and completely, as if it were the only message. Earlier lines are background: use them only when the latest message depends on them, and never recap, summarize or repeat what was already said or answered. If the latest line is a greeting or small talk, reply in one short line. If it is a question (even a rough one from speech recognition), answer it correctly first, then add detail only if it helps. Do not use headings such as Summary, Key points or Action items unless the user explicitly asks for a summary or notes. Use plain sentences, with short bullets only when a list really helps. Lines starting with ON SCREEN were read from the user's screen.` +
    WIDE,
  Interview:
    CORE +
    `\n\nMode: interview coach helping the user answer live. Find the most recent question (lines starting with HEARD, or ON SCREEN if the screen shows a question). Reply in plain text with: **Question type** (behavioral, technical, situational or general), **What they want** (one line, including what the interviewer is really testing), **Answer outline** (3-4 short bullets in the order to say them; use the STAR structure for behavioral questions and include a result with a number when the user's background supports one) and **Opening line** the user can start with. The whole answer should take about 60-90 seconds to say. For technical questions give the correct answer first, then the reasoning. Ground examples in the background the user shared. If it has nothing relevant, say so briefly and give an honest framework instead of inventing experience or credentials. When it fits, make **Another angle** a standout move, such as a sharp question to ask the interviewer or a detail that sets the user apart. If the conversation is not an interview, or the latest question is not an interview question, skip this format and help with what is actually happening. Be concise.` +
    WIDE
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
//   NVIDIA_API_KEY      chat (build.nvidia.com free developer credits). Credits run out, so it is tried last.
// Optional overrides (comma lists): GROQ_MODELS, MISTRAL_MODELS, OPENROUTER_MODELS,
//   NVIDIA_MODELS, GROQ_VISION_MODEL, MISTRAL_VISION_MODEL, OPENROUTER_VISION_MODELS, NVIDIA_VISION_MODELS
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
  if (env.NVIDIA_API_KEY) out.push({ key: 'nvidia', base: 'https://integrate.api.nvidia.com/v1', apiKey: env.NVIDIA_API_KEY, models: list(env.NVIDIA_MODELS, ['meta/llama-3.3-70b-instruct']), vision: list(env.NVIDIA_VISION_MODELS, []) })
  return out
}

// Checking the sign-in token is a network round trip to Supabase on every request. Live suggestions fire every few
// seconds, so a short cache removes that wait. 20 seconds keeps changes to settings and memory feeling immediate.
const ACCOUNT_TTL_MS = 20000
const accountCache = new Map<string, { at: number; account: any }>()
function cachedAccount(token: string): any | null {
  const hit = accountCache.get(token)
  return hit && Date.now() - hit.at < ACCOUNT_TTL_MS ? hit.account : null
}
function rememberAccount(token: string, account: any) {
  if (accountCache.size > 200) accountCache.clear()
  accountCache.set(token, { at: Date.now(), account })
}

// Stop waiting on a request when either signal fires (a timeout, or "another provider already answered").
function anySignal(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as any).any
  if (typeof any === 'function') return any.call(AbortSignal, signals)
  return signals[0]
}

type Hit = { text: string; via: string }

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
        if (r.status === 402) { cool(b.key, null, 6 * 3600000); break } // credits used up: stop trying for hours
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
  system: (mode: string, style: string, context: string, today: string) => string
  fastOnly: boolean // always use the quick models, whatever the user's AI mode is
  tokens: number // max output tokens
  long: boolean // slower job (audio, images, long transcripts): allow a longer wait
  json?: boolean // ask the model for JSON
  textChars: number // how much of the notes text to send (the most recent part)
}

const TASKS: Record<TaskName, TaskConfig> = {
  assist: { system: (mode, style, ctx, today) => (PROMPTS[mode] || PROMPTS.Meeting) + MEMORY_RULE + MISHEARD + style + today + ctx, fastOnly: false, tokens: 2048, long: false, textChars: 40000 },
  summary: { system: (_m, _s, ctx, today) => FULL_MEETING + MISHEARD + today + ctx, fastOnly: false, tokens: 4096, long: true, textChars: 150000 },
  transcribe: { system: (_m, _s, ctx, _t) => TRANSCRIBE + (ctx ? SPELLING_HINT + ctx.slice(0, 1500) : ''), fastOnly: true, tokens: 1200, long: true, textChars: 12000 },
  screen: { system: (_m, _s, _c, today) => SCREEN + today, fastOnly: false, tokens: 1500, long: true, textChars: 12000 },
  learn: { system: (_m, _s, ctx, _t) => LEARN + MISHEARD_LEARN + ctx, fastOnly: true, tokens: 500, long: false, json: true, textChars: 12000 }
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
  const token = String(req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'Please sign in again' })
  let account: any = cachedAccount(token)
  if (!account) {
    const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } })
    if (!who.ok) return res.status(401).json({ error: 'Please sign in again' })
    account = await who.json().catch(() => ({}))
    rememberAccount(token, account)
  }
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
  // Ignore malformed notes instead of crashing, and keep only the most recent ones.
  const notes: { kind: string; content: string }[] = Array.isArray(body?.notes)
    ? body.notes.slice(-400).filter((n: any) => n && typeof n.kind === 'string' && typeof n.content === 'string')
    : []
  // Live answers see the whole conversation, including NOVA's own earlier replies, so follow-ups work.
  // Summaries and "learn" only read what the user and others said.
  const withReplies = task === 'assist'
  const label = (n: { kind: string }) => n.kind === 'ai' ? 'NOVA SAID' : n.kind === 'transcript' ? 'HEARD' : n.kind === 'screen' ? 'ON SCREEN' : 'USER NOTE'
  const text = notes
    .filter(n => withReplies || n.kind !== 'ai')
    .map(n => `${label(n)}: ${n.content}`)
    .join('\n')
    .slice(-cfg.textChars)
  const latestMessage = [...notes].reverse().find(n => n.kind !== 'ai')?.content ?? ''
  const hasUserLine = notes.some(n => n.kind !== 'ai')
  const noInput = task === 'transcribe' ? !audio : task === 'screen' ? !image : !hasUserLine || !text.trim()
  if (noInput) return res.status(400).json({ error: 'Nothing to analyze yet. Record or add notes first.' })

  const context =
    (userName ? `\n\nThe user's name is ${userName}.` : '') +
    (about ? `\n\nBackground the user shared about themselves (use only when relevant; never invent beyond it):\n${about}` : '')
  const langHint = task === 'transcribe'
    ? lang === 'sw' ? ' The speech is in Kiswahili.' : lang === 'mixed' ? ' The speech may mix English and Kiswahili. Write each word in the language it was spoken in.' : ''
    : task === 'assist' || task === 'summary'
      ? lang === 'sw' ? ' The conversation is mainly in Kiswahili: reply in Kiswahili unless the user writes in English.' : lang === 'mixed' ? ' The conversation may mix English and Kiswahili: reply in the language of the latest question.' : ''
      : ''
  // Today's date, so "this Friday" or "by next week" can be understood. The app may send its time zone as `tz`.
  let today = ''
  try {
    const tz = typeof body?.tz === 'string' && body.tz.length < 60 ? body.tz : 'Africa/Nairobi'
    today = ` Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })}.`
  } catch { /* invalid time zone: leave the date out */ }
  const system = cfg.system(mode, style, context, today) + langHint

  const chain: Brain = cfg.fastOnly ? 'fast' : brain
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...MODELS[chain]] : MODELS[chain]
  const level = chain === 'smart' ? 'medium' : 'low'
  const limit = cfg.long ? 35000 : brain === 'smart' ? 25000 : 18000
  const parts =
    task === 'transcribe' ? [{ inlineData: { mimeType: audioMime, data: audio } }, { text: 'Transcribe this audio.' }]
    : task === 'screen' ? [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: 'Read this screen.' }]
    : [{ text }]
  const stop = new AbortController() // fired when a backup answers first, so Gemini stops working
  const wantsSearch = task === 'assist' && Boolean(apiKey) && !isCooling('gemini-search') && needsSearch(latestMessage)
  const ask = (model: string, thinking: boolean, search = false) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey as string, 'content-type': 'application/json' },
      signal: anySignal([AbortSignal.timeout(limit), stop.signal]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: search ? system + SEARCH_RULE : system }] },
        contents: [{ role: 'user', parts }],
        ...(search ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { maxOutputTokens: cfg.tokens, ...(cfg.json ? { responseMimeType: 'application/json' } : {}), ...(thinking ? { thinkingConfig: { thinkingLevel: level } } : {}) }
      })
    })

  // Gemini: walk through its models until one answers.
  const runGemini = async () => {
    let r: any = null
    if (!apiKey) return { r, data: {} as any, out: '' }
    const start = Date.now()
    if (wantsSearch) {
      const s0 = Date.now()
      try {
        const sr = await ask(SEARCH_MODEL, false, true)
        console.log(`assist task=${task} model=${SEARCH_MODEL} search=true status=${sr.status} ms=${Date.now() - s0}`)
        if (sr.ok) {
          const sd: any = await sr.json().catch(() => ({}))
          const answer = (sd.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
          if (answer) return { r: sr, data: sd, out: withSources(answer, sd) }
        } else {
          coolUntil['gemini-search'] = Date.now() + 10 * 60000 // free keys often have no search allowance: stop trying for a while
        }
      } catch (e: any) {
        console.log('assist search failed', e?.name, Date.now() - s0, 'ms')
      }
    }
    for (const m of models) {
      if (Date.now() - start > 30000 || stop.signal.aborted) break
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

  // Live answers: if Gemini has not replied after a few seconds, ask a backup provider as well and use whichever
  // answers first. A slow or stuck Gemini then costs a few seconds instead of half a minute.
  const hedgeMs = canBackup && !geminiCooling && (task === 'assist' || task === 'learn')
    ? (Number(process.env.NOVA_HEDGE_MS) || (brain === 'smart' ? 9000 : 5000)) + (wantsSearch ? 6000 : 0)
    : 0
  let backupsTried = geminiCooling
  let hit: Hit | null = null
  let g: Awaited<ReturnType<typeof runGemini>>

  if (hedgeMs) {
    backupsTried = true
    let backupP: Promise<Hit | null> | null = null
    const startBackups = () => (backupP ??= runBackups().catch(() => null))
    const geminiP = runGemini()
    let tid: ReturnType<typeof setTimeout> | undefined
    const slow = new Promise<'slow'>(resolve => { tid = setTimeout(() => resolve('slow'), hedgeMs) })
    const first = await Promise.race([geminiP.then(() => 'done' as const), slow])
    clearTimeout(tid)
    if (first === 'done') {
      g = await geminiP
      hit = g.out ? { text: g.out, via: 'gemini' } : await startBackups() // Gemini failed quickly: use the backups
    } else {
      const bp = startBackups() // Gemini is slow: race a backup against it
      hit = await new Promise<Hit | null>(resolve => {
        let open = 2
        const settle = (h: Hit | null) => { if (h) resolve(h); else if (--open === 0) resolve(null) }
        geminiP.then(x => settle(x.out ? { text: x.out, via: 'gemini' } : null))
        bp.then(settle)
      })
      if (hit && hit.via !== 'gemini') stop.abort() // a backup won: stop waiting for Gemini
      g = await geminiP
    }
  } else {
    g = await runGemini()
    if (g.out) hit = { text: g.out, via: 'gemini' }
  }

  if (g.r?.status === 429) coolUntil.gemini = Date.now() + 120000
  if (hit) return res.status(200).json({ text: hit.text, via: hit.via })

  // Gemini is out of quota, too slow or failing: try the other free providers in order.
  if (canBackup && !backupsTried) {
    const alt = await runBackups()
    if (alt) return res.status(200).json({ text: alt.text, via: alt.via })
  }

  if (!g.r) return res.status(apiKey ? 504 : 502).json({ error: apiKey ? 'The AI took too long to answer. Please try again.' : 'No AI provider could answer this. Try again shortly.' })
  if (g.r.status === 429) return res.status(429).json({ error: canBackup ? 'The free AI limit is used up on every provider for now. It resets daily. Try again later.' : 'The free AI limit for today is used up on every model. It resets daily. To remove the limit, enable billing in Google AI Studio, or add another provider key in Vercel (GROQ_API_KEY).' })
  if (!g.r.ok) {
    console.log('assist gemini error', g.r.status, g.data?.error?.message) // kept in the server log, not sent to the browser
    return res.status(502).json({ error: 'AI request failed. Please try again.' })
  }
  return res.status(502).json({ error: 'The AI returned no answer. Try again.' })
}
