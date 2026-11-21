// Live-session layout choice. Pure helpers so they are easy to test; the app passes localStorage.
export type Layout = 'chat' | 'focus' | 'tabs'

export const LAYOUTS: { code: Layout; label: string }[] = [
  { code: 'chat', label: 'Chat feed' },
  { code: 'focus', label: 'Focus view' },
  { code: 'tabs', label: 'Live + Transcript' }
]

export function isLayout(v: unknown): v is Layout {
  return v === 'chat' || v === 'focus' || v === 'tabs'
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadLayout(store: Store | null): Layout {
  try { const v = store?.getItem('nova.layout'); return isLayout(v) ? v : 'chat' } catch { return 'chat' }
}

export function saveLayout(store: Store | null, layout: Layout) {
  try { store?.setItem('nova.layout', layout) } catch { /* storage blocked */ }
}
