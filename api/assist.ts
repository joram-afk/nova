// Vercel serverless function: keeps the Gemini key on the server.
export const config = { maxDuration: 60 }

const FULL_MEETING =
  'You are NOVA, summarizing a full meeting transcript. Reply in plain text with these sections: **Overview** (3-4 sentences), **Key discussion points** (short bullets), **Decisions made**, **Action items** (owner and deadline if stated), **Open questions**. Use only what is in the transcript and name speakers when the transcript gives names. Be concise and precise.'

const LEARN =
  'You extract lasting facts about the USER from a session so an assistant can personalise future help. Facts must be about the user themselves: skills, education, experience, projects, goals, interests, preferences, languages, how they like answers. Lines starting with USER NOTE are the user. Lines starting with HEARD may include other people, so ignore anything about anyone else and anything you are unsure the user said about themselves. Never include sensitive data (health, money, passwords, ID numbers, exact location, relationships, politics, religion) or temporary details. Do not repeat facts already known. Output ONLY a JSON array of up to 4 short strings, each under 140 characters, or [] if there is nothing lasting.'

const TRANSCRIBE =
  'You transcribe meeting audio. Output only the words spoken, exactly as heard, with no commentary. If there is no clear speech, output exactly [silence].'

const SCREEN =
  'You are NOVA. You read a screenshot for the user during a live conversation. Reply in plain text: one line saying what is on screen, then the important readable text (questions, headings, numbers, names) as short bullets. If it shows a question or problem, add a line starting with "Suggested answer:" and a short outline. Never guess at text you cannot read.'

const PROMPTS: Record<string, string> = {
  Meeting:
    'You are NOVA, a sharp meeting assistant. Using the transcript and notes, reply in plain text with: **Summary** (2-3 sentences), **Key points** (short bullets), **Action items** (owner if mentioned) and, only if useful, **Watch out** (risks or unanswered questions). Be precise and never invent facts. Lines starting with ON SCREEN were read from the user\'s screen.',
  Interview:
    'You are NOVA, an expert interview coach helping the user answer live. Find the most recent question (lines starting with HEARD, or ON SCREEN if the screen shows a question). Reply in plain text with: **Question type** (behavioral, technical, situational or general), **What they want** (one line), **Answer outline** (3-4 short bullets in the order to say them; use the STAR structure for behavioral questions) and **Opening line** the user can start with. Ground examples in the background the user shared. If it has nothing relevant, say so briefly and give an honest framework instead of inventing experience or credentials. Be concise.'
}

// Each model has its own free daily quota, so we fall through the list when one is used up.
const MODELS: Record<string, string[]> = {
  fast: ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  smart: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
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
  const brain = prefs.brain === 'fast' ? 'fast' : 'smart'
  const memories: string[] = Array.isArray(prefs.memories)
    ? prefs.memories.filter((m: unknown) => typeof m === 'string').slice(0, 40).map((m: string) => m.trim().slice(0, 500)).filter(Boolean)
    : []
  const learnedFacts: string[] = Array.isArray(prefs.learned)
    ? prefs.learned.filter((m: unknown) => typeof m === 'string').slice(-60).map((m: string) => m.trim().slice(0, 300)).filter(Boolean)
    : []
  const legacy = typeof prefs.about === 'string' ? prefs.about.trim().slice(0, 2000) : ''
  const about = [...memories.map(m => `- ${m}`), ...learnedFacts.map(m => `- ${m}`), legacy].filter(Boolean).join('\n')
  const userName = typeof account?.user_metadata?.display_name === 'string' ? account.user_metadata.display_name.trim().slice(0, 60) : ''

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const mode = body?.mode === 'Interview' ? 'Interview' : 'Meeting'
  const full = body?.full === true && mode === 'Meeting'
  const style = body?.style === 'detailed' ? ' Give a fuller, more detailed answer.' : ' Keep it very short: at most 6 short lines.'
  const learn = body?.learn === true
  const audio = typeof body?.audio === 'string' && body.audio.length < 4200000 ? body.audio : ''
  const audioMime = typeof body?.mime === 'string' && body.mime.startsWith('audio/') ? body.mime.split(';')[0] : 'audio/webm'
  const image = typeof body?.image === 'string' && body.image.length < 4000000 ? body.image : ''
  const notes: { kind: string; content: string }[] = Array.isArray(body?.notes) ? body.notes : []
  const text = notes
    .filter(n => n.kind !== 'ai')
    .map(n => `${n.kind === 'transcript' ? 'HEARD' : n.kind === 'screen' ? 'ON SCREEN' : 'USER NOTE'}: ${n.content}`)
    .join('\n')
    .slice(full ? -150000 : -12000)
  if (!image && !audio && !text.trim()) return res.status(400).json({ error: 'Nothing to analyze yet. Record or add notes first.' })

  const context =
    (userName ? `\n\nThe user's name is ${userName}.` : '') +
    (about ? `\n\nBackground the user shared about themselves (use only when relevant; never invent beyond it):\n${about}` : '')
  const system = learn ? LEARN + context : audio ? TRANSCRIBE : image ? SCREEN : full ? FULL_MEETING + context : PROMPTS[mode] + style + context

  const chain = audio || learn ? 'fast' : brain
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...MODELS[chain]] : MODELS[chain]
  const level = chain === 'smart' ? 'medium' : 'low'
  const limit = full || image || audio ? 35000 : brain === 'smart' ? 25000 : 18000
  const ask = (model: string, thinking: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(limit),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: audio ? [{ inlineData: { mimeType: audioMime, data: audio } }, { text: 'Transcribe this audio.' }] : image ? [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: 'Read this screen.' }] : [{ text }] }],
        generationConfig: { maxOutputTokens: full ? 4096 : learn ? 500 : audio ? 1200 : image ? 1500 : 2048, ...(learn ? { responseMimeType: 'application/json' } : {}), ...(thinking ? { thinkingConfig: { thinkingLevel: level } } : {}) }
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
      console.log(`assist model=${m} brain=${brain} status=${r.status} ms=${Date.now() - t0}`)
      if (r.ok) break
    } catch (e: any) {
      console.log('assist failed', m, e?.name, Date.now() - t0, 'ms')
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
