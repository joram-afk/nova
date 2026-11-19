import { supabase } from './supabase'
import type { Mode } from '../types'

// The server (api/assist.ts) owns the prompt for each task.
export type AssistTask = 'assist' | 'summary' | 'transcribe' | 'screen' | 'learn'

export interface AssistPayload {
  task: AssistTask
  mode: Mode
  notes?: { kind: string; content: string }[]
  style?: 'short' | 'detailed'
  image?: string // base64 jpeg
  audio?: string // base64 audio
  mime?: string
}

// Authenticated client for /api/assist.
export async function callAssist(payload: AssistPayload, fallback = 'AI request failed'): Promise<string> {
  const { data: s } = await supabase.auth.getSession()
  const r = await fetch('/api/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
    body: JSON.stringify(payload)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || fallback)
  return String(j.text ?? '')
    }
