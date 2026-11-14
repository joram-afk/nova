const { app, BrowserWindow, ipcMain, globalShortcut, session, desktopCapturer, shell, screen } = require('electron')
const fs = require('fs')
const path = require('path')
const { HOTKEYS, normalizeUrl, cleanOverlayState, cleanOverlayAction, isInternal } = require('./logic')

let mainWin = null
let overlay = null
let lastState = cleanOverlayState({})
let appUrl = ''

// The web app address: NOVA_URL env var, else config.json in the app's data folder, else the default.
function loadUrl() {
  let fromFile = ''
  try { fromFile = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')).url } catch { /* no config yet */ }
  return normalizeUrl(process.env.NOVA_URL || fromFile) || normalizeUrl('')
}

function sendToApp(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload)
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1200, height: 800, minWidth: 420, minHeight: 600, backgroundColor: '#0b0f1a', title: 'NOVA COPILOT',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWin.setMenuBarVisibility(false)
  mainWin.loadURL(appUrl)
  // Links to other sites open in the normal browser, never inside NOVA.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url, appUrl)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url) }
  })
  mainWin.on('closed', () => { mainWin = null; if (overlay && !overlay.isDestroyed()) overlay.destroy(); app.quit() })
}

function createOverlay() {
  const area = screen.getPrimaryDisplay().workArea
  const w = 380, h = 280
  overlay = new BrowserWindow({
    width: w, height: h, x: area.x + area.width - w - 16, y: area.y + area.height - h - 16,
    minWidth: 260, minHeight: 150, frame: false, show: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, fullscreenable: false, backgroundColor: '#0b0f1a',
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.loadFile(path.join(__dirname, 'overlay.html'))
  overlay.webContents.on('did-finish-load', () => overlay && overlay.webContents.send('overlay:state', lastState))
  overlay.on('closed', () => { overlay = null })
}

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) createOverlay()
  if (overlay.isVisible()) overlay.hide()
  else { overlay.showInactive(); overlay.webContents.send('overlay:state', lastState) }
}

function registerHotkeys() {
  const failed = []
  for (const h of HOTKEYS) {
    const ok = globalShortcut.register(h.accelerator, () => {
      if (h.action === 'toggle-overlay') toggleOverlay()
      else sendToApp('desktop:action', { type: h.action })
    })
    if (!ok) failed.push(h.accelerator) // another program already uses this shortcut
  }
  if (failed.length) sendToApp('desktop:action', { type: 'notice', text: 'These shortcuts are used by another program: ' + failed.join(', ') })
}

function setupMedia() {
  const ses = session.defaultSession
  // Allow the microphone and screen capture, but only for NOVA's own address.
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture'].includes(permission) && isInternal(wc.getURL(), appUrl))
  })
  // Screen + system sound without the browser's picker: share the main screen and capture what Windows is playing.
  ses.setDisplayMediaRequestHandler(async (request, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (!sources.length) { cb({}); return }
      cb(request && request.audioRequested ? { video: sources[0], audio: 'loopback' } : { video: sources[0] })
    } catch { cb({}) }
  }, { useSystemPicker: false })
}

function setupIpc() {
  ipcMain.on('app:overlay-state', (e, s) => {
    if (!mainWin || e.sender !== mainWin.webContents) return
    lastState = cleanOverlayState(s)
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:state', lastState)
  })
  ipcMain.on('overlay:action', (e, a) => {
    if (!overlay || e.sender !== overlay.webContents) return
    const clean = cleanOverlayAction(a)
    if (clean) sendToApp('desktop:action', clean)
  })
  ipcMain.on('overlay:ignore', (e, v) => {
    if (overlay && !overlay.isDestroyed() && e.sender === overlay.webContents) overlay.setIgnoreMouseEvents(Boolean(v), { forward: true })
  })
  ipcMain.on('overlay:hide', e => { if (overlay && !overlay.isDestroyed() && e.sender === overlay.webContents) overlay.hide() })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus() } })
  app.whenReady().then(() => {
    appUrl = loadUrl()
    setupMedia(); setupIpc(); createMain(); registerHotkeys()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}

module.exports = { loadUrl }
