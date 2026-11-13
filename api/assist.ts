// Vercel serverless function: keeps the Gemini key on the server.
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

  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const apiKey = process.env.GEMINI_API_KEY
  if (!url || !anon || !apiKey) return res.status(500).json({ error: 'Server is not configured' })

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
  const system = cfg.system(mode, style, context)

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
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(limit),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: cfg.tokens, ...(cfg.json ? { responseMimeType: 'application/json' } : {}), ...(thinking ? { thinkingConfig: { thinkingLevel: level } } : {}) }
      })
    })

  let r: any = null
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
  if (!r) return res.status(504).json({ error: 'The AI took too long to answer. Please try again.' })
  const data: any = await r.json().catch(() => ({}))
  if (r.status === 429) return res.status(429).json({ error: 'The free AI limit for today is used up on every model. It resets daily. To remove the limit, enable billing in Google AI Studio.' })
  if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'AI request failed' })
  const out = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
  if (!out) return res.status(502).json({ error: 'The AI returned no answer. Try again.' })
  return res.status(200).json({ text: out })
}
