// Pure helpers for transcripts. Kept free of React so they are easy to test.

// Clean a pasted or uploaded transcript (.vtt, .srt, .txt) down to its spoken lines.
export function parseTranscript(raw: string): string[] {
  return raw.replace(/\r/g, '').split('\n').map(l => l.trim())
    .filter(l => l && l !== 'WEBVTT' && !/^\d+$/.test(l) && !/-->/.test(l) && !/^(NOTE|Kind:|Language:)/.test(l))
    .map(l => l.replace(/<[^>]+>/g, ''))
}

// Group lines into chunks of roughly `max` characters, never splitting a line.
export function chunkLines(lines: string[], max = 500): string[] {
  const chunks: string[] = []
  let cur = ''
  for (const l of lines) {
    if (cur && cur.length + l.length > max) { chunks.push(cur); cur = '' }
    cur += (cur ? '\n' : '') + l
  }
  if (cur) chunks.push(cur)
  return chunks
}

// Does this line sound like a question worth answering?
export function isQuestion(text: string): boolean {
  const t = text.toLowerCase().trim()
  return /\?|^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|tell me|describe|explain|walk me)\b/.test(t)
}

// Android Chrome re-sends a growing sentence many times. Merge those interim results before saving.
export function mergeInterim(pending: string, raw: string): { commit: boolean; pending: string } {
  const t = raw.trim()
  if (!t) return { commit: false, pending }
  const a = t.toLowerCase(), b = pending.toLowerCase()
  const commit = Boolean(pending) && !(a.startsWith(b) || b.startsWith(a))
  const cur = commit ? '' : pending
  const next = cur && cur.toLowerCase().startsWith(a) && cur.length >= t.length ? cur : t
  return { commit, pending: next }
}
