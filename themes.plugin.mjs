// Build-time theming: turns every hex colour in src/**/*.css into a CSS variable and generates
// the colour sets for each theme, so the stylesheets can stay written with plain hex colours.
import fs from 'node:fs'
import path from 'node:path'

const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const DOCK = 'rgba(11,13,18,.96)'
const norm = m => {
  const h = m.toLowerCase().slice(1)
  return '#' + (h.length === 3 ? h.split('').map(c => c + c).join('') : h)
}
const v = h => `--c${h.slice(1)}`

function toHsl(h) {
  const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(hh * 60 + 360) % 360, s, l]
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const t = n => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return '#' + t(r) + t(g) + t(b)
}

// Dark themes: rotate the purple accent family to another hue; greens, reds and oranges stay put.
const DARK = { midnight: 0, ocean: 205 - 255, forest: 150 - 255, sunset: 20 - 255, rose: 335 - 255 }
function shift(hex, delta) {
  if (!delta) return hex
  const [h, s, l] = toHsl(hex)
  return h >= 240 && h <= 290 && s > 0.15 ? fromHsl((h + delta + 360) % 360, s, l) : hex
}

// Light theme: hand-picked values for the colours the app uses; anything new falls back to inverting lightness.
const LIGHT = {
  '#0b0d12': '#f3f4f8', '#10131a': '#ffffff', '#141824': '#ffffff', '#121620': '#ffffff', '#151725': '#f4f1ff',
  '#191827': '#f1edff', '#1a1730': '#ece6ff', '#28223b': '#e7e0ff', '#221d3a': '#eee9ff', '#15122a': '#f2eeff',
  '#343044': '#e4defa', '#4b3b8f': '#8f7af0',
  '#222630': '#dde0e9', '#222836': '#dde0e9', '#1d212c': '#e6e8ef', '#252a34': '#e1e4ec', '#292d37': '#e1e4ec',
  '#292e3b': '#d9dce6', '#302b45': '#d4ccf5', '#2a2f3b': '#cdd1dd', '#3a3160': '#bfb2f0',
  '#f5f5f7': '#14161d', '#e4e0f5': '#2b2740', '#c9cbd6': '#3a3f50', '#a5a9b7': '#454a5c', '#b4bdc2': '#4a505e',
  '#8e93a4': '#667087', '#9298a7': '#667087', '#8f94a4': '#667087', '#707687': '#7b8296', '#6b7080': '#9aa0b2',
  '#a991ff': '#6a4df0', '#a58aff': '#6a4df0', '#b8a5ff': '#7a5ff5', '#c5b5ff': '#5b3fe0', '#c0b0ff': '#8468f6',
  '#d5c9ff': '#4a30c8', '#171321': '#ffffff', '#111111': '#ffffff',
  '#7ee2a8': '#0d7a4b', '#45c78a': '#1fa06a', '#1f4a38': '#a7dcc1', '#0f1a16': '#e6f7ee', '#e9fff3': '#2fc58a',
  '#ff9c9c': '#c43131', '#ff8a8a': '#c43131', '#ff6b6b': '#e24a4a', '#5a2a2a': '#f0b4b4', '#2a1416': '#fdecec',
  '#1a0b0b': '#ffffff', '#ffb86b': '#a85a00', '#4a3a1f': '#efd3a2',
  '#6cb6ff': '#1c63b8', '#1f3d57': '#b6d3f2', '#0f1720': '#e8f2fc', '#ffffff': '#ffffff'
}
function light(hex) {
  if (LIGHT[hex]) return LIGHT[hex]
  const [h, s, l] = toHsl(hex)
  return fromHsl(h, s, 1 - l)
}

export function buildThemeCss(colors) {
  const block = (sel, scheme, map, dock) =>
    `${sel}{color-scheme:${scheme};${colors.map(c => `${v(c)}:${map(c)}`).join(';')};--cdock:${dock}}`
  let css = block(':root', 'dark', c => c, DOCK)
  for (const [id, delta] of Object.entries(DARK)) {
    css += '\n' + block(`:root[data-theme="${id}"],[data-preview="${id}"]`, 'dark', c => shift(c, delta), DOCK)
  }
  css += '\n' + block(':root[data-theme="light"],[data-preview="light"]', 'light', light, 'rgba(243,244,248,.96)')
  return css
}

function scan(dir, found) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) scan(p, found)
    else if (f.name.endsWith('.css')) for (const m of fs.readFileSync(p, 'utf8').matchAll(HEX)) found.add(norm(m[0]))
  }
}

export function novaThemes() {
  let css = ''
  return {
    name: 'nova-themes',
    enforce: 'pre',
    configResolved(cfg) {
      const found = new Set()
      scan(path.join(cfg.root, 'src'), found)
      css = buildThemeCss([...found])
    },
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css')) return null
      return { code: code.replace(DOCK, 'var(--cdock)').replace(HEX, m => `var(${v(norm(m))})`), map: null }
    },
    transformIndexHtml() {
      return [{ tag: 'style', children: css, injectTo: 'head-prepend' }]
    }
  }
}
