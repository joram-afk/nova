export type Mode = 'Meeting' | 'Interview'
export type NoteKind = 'note' | 'transcript' | 'ai' | 'screen'

export interface Row { id: string; title: string; mode: Mode; created_at: string }
export interface Note { id: string; content: string; kind: NoteKind; created_at: string }

// How each kind of note is named. Keep this in sync with api/assist.ts and schema.sql.
export const NOTE_KINDS: Record<NoteKind, { tag: string; label: string }> = {
  note: { tag: 'NOTE', label: 'Your note' },
  transcript: { tag: 'HEARD', label: 'Heard' },
  ai: { tag: 'NOVA', label: 'NOVA' },
  screen: { tag: 'ON SCREEN', label: 'On screen' }
}
