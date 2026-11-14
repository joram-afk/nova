// Pure helpers for the desktop shell. No Electron imports, so they can be tested with plain Node.
const DEFAULT_URL = 'https://nova-copilot.vercel.app'

const HOTKEYS = [
  { accelerator: 'CommandOrControl+Shift+Space', action: 'toggle-overlay' },
  { accelerator: 'CommandOrControl+Shift+A', action: 'ask' },
  { accelerator: 'CommandOrControl+Shift+S', action: 'screen' },
  { accelerator: 'CommandOrControl+Shift+L', action: 'listen' }
]

// Accept "nova-copilot.vercel.app" or a full address. Only http(s) is allowed.
function normalizeUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return DEFAULT_URL
  if (/^(javascript|data|file|vbscript|blob|about):/i.test(raw)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch { return null }
}

// Keep only what the overlay needs, and cap sizes so a huge AI answer cannot freeze it.
function cleanOverlayState(s) {
  const o = s && typeof s === 'object' ? s : {}
  return {
    text: String(o.text || '').slice(0, 4000),
    listening: Boolean(o.listening),
    capturing: Boolean(o.capturing),
    busy: Boolean(o.busy),
    title: String(o.title || '').slice(0, 120)
  }
}

// Only these actions may travel from the overlay to the web app.
const OVERLAY_ACTIONS = new Set(['ask', 'screen', 'listen', 'note'])
function cleanOverlayAction(a) {
  if (!a || typeof a !== 'object' || !OVERLAY_ACTIONS.has(a.type)) return null
  return a.type === 'note' ? { type: 'note', text: String(a.text || '').trim().slice(0, 2000) } : { type: a.type }
}

// Only allow the app's own address inside the main window; everything else opens in the normal browser.
function isInternal(target, appUrl) {
  try { return new URL(target).origin === new URL(appUrl).origin } catch { return false }
}

module.exports = { DEFAULT_URL, HOTKEYS, normalizeUrl, cleanOverlayState, cleanOverlayAction, isInternal }
