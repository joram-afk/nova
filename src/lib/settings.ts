export interface Settings {
  lang: string
  autoDefault: boolean
  interval: number
  wake: boolean
  style: 'short' | 'detailed'
  brain: 'fast' | 'smart'
  about: string
  memories: string[]
  learned: string[]
  learn: boolean
  chunk: number
  theme: string
}

export const DEFAULTS: Settings = {
  lang: '', autoDefault: true, interval: 40, wake: true, style: 'short', brain: 'smart', about: '',
  memories: [], learned: [], learn: true, chunk: 30, theme: 'midnight'
}

export const THEMES = [
  { id: 'midnight', name: 'Midnight' },
  { id: 'light', name: 'Light' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'forest', name: 'Forest' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'rose', name: 'Rose' }
]

export function applyTheme(id: string) {
  const el = document.documentElement
  el.dataset.theme = id
  try { localStorage.setItem('nova-theme', id) } catch { /* storage blocked */ }
  const bg = getComputedStyle(el).getPropertyValue('--c0b0d12').trim()
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}
