const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

function makeFakeElectron() {
  const calls = { shortcuts: [], sent: [], windows: [], ipc: {}, openExternal: [], mediaHandler: null, permHandler: null }
  class Win {
    constructor(o) { this.o = o; this.destroyed = false; this.visible = false; calls.windows.push(this)
      this.webContents = { send: (c, p) => calls.sent.push([this, c, p]), on() {}, setWindowOpenHandler() {}, getURL: () => 'https://nova-copilot.vercel.app/' } }
    setMenuBarVisibility() {} loadURL(u) { this.url = u } loadFile() {} setAlwaysOnTop() {} on() {} destroy() { this.destroyed = true }
    isDestroyed() { return this.destroyed } isVisible() { return this.visible } hide() { this.visible = false } showInactive() { this.visible = true }
    setIgnoreMouseEvents(v) { this.ignore = v } isMinimized() { return false } focus() {}
  }
  const handlers = {}
  const electron = {
    app: { requestSingleInstanceLock: () => true, on: (e, f) => { handlers[e] = f }, whenReady: () => Promise.resolve(), quit() {}, getPath: () => '/tmp/nova-test-none' },
    BrowserWindow: Win,
    ipcMain: { on: (ch, f) => { calls.ipc[ch] = f } },
    globalShortcut: { register: (a, f) => { calls.shortcuts.push([a, f]); return !a.endsWith('+A') }, unregisterAll() {} },
    session: { defaultSession: { setPermissionRequestHandler: f => { calls.permHandler = f }, setDisplayMediaRequestHandler: (f, o) => { calls.mediaHandler = f; calls.mediaOpts = o } } },
    desktopCapturer: { getSources: async () => [{ id: 'screen:0' }] },
    shell: { openExternal: u => calls.openExternal.push(u) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  }
  return { electron, calls }
}

test('desktop main wires windows, hotkeys, media and ipc safely', async () => {
  const { electron, calls } = makeFakeElectron()
  const orig = Module._load
  Module._load = function (req, ...rest) { return req === 'electron' ? electron : orig.call(this, req, ...rest) }
  try { require('./main.js') } finally { Module._load = orig }
  await new Promise(r => setImmediate(r))
  const main = calls.windows[0]
  assert.strictEqual(main.url, 'https://nova-copilot.vercel.app')
  assert.strictEqual(main.o.webPreferences.contextIsolation, true)
  assert.strictEqual(main.o.webPreferences.nodeIntegration, false)
  assert.strictEqual(calls.shortcuts.length, 4)
  // a shortcut that could not register is reported to the app
  assert.ok(calls.sent.some(([, c, p]) => c === 'desktop:action' && p.type === 'notice' && /Shift\+A/.test(p.text)))
  // hotkey forwards to the app
  calls.shortcuts.find(([a]) => a.endsWith('+L'))[1]()
  assert.ok(calls.sent.some(([w, c, p]) => w === main && p && p.type === 'listen'))
  // overlay toggles and is always-on-top, taskbar-hidden
  calls.shortcuts.find(([a]) => a.endsWith('Space'))[1]()
  const ov = calls.windows[1]
  assert.ok(ov.visible && ov.o.alwaysOnTop && ov.o.skipTaskbar && ov.o.frame === false)
  // state only accepted from the main window, and cleaned
  calls.ipc['app:overlay-state']({ sender: {} }, { text: 'ignored' })
  calls.ipc['app:overlay-state']({ sender: main.webContents }, { text: 'hello', listening: true })
  assert.ok(calls.sent.some(([w, c, p]) => w === ov && c === 'overlay:state' && p.text === 'hello' && p.listening === true))
  // overlay actions are filtered
  const before = calls.sent.length
  calls.ipc['overlay:action']({ sender: ov.webContents }, { type: 'eval', code: 'x' })
  assert.strictEqual(calls.sent.length, before)
  calls.ipc['overlay:action']({ sender: ov.webContents }, { type: 'note', text: 'why?' })
  assert.ok(calls.sent.some(([w, c, p]) => w === main && p && p.type === 'note' && p.text === 'why?'))
  // click-through
  calls.ipc['overlay:ignore']({ sender: ov.webContents }, true)
  assert.strictEqual(ov.ignore, true)
  // permissions: only media/display-capture for NOVA's address
  let allowed; calls.permHandler({ getURL: () => 'https://nova-copilot.vercel.app/x' }, 'media', v => { allowed = v }); assert.strictEqual(allowed, true)
  calls.permHandler({ getURL: () => 'https://evil.com' }, 'media', v => { allowed = v }); assert.strictEqual(allowed, false)
  calls.permHandler({ getURL: () => 'https://nova-copilot.vercel.app' }, 'geolocation', v => { allowed = v }); assert.strictEqual(allowed, false)
  // screen + loopback audio, no picker
  let got; await calls.mediaHandler({ audioRequested: true }, v => { got = v })
  assert.deepStrictEqual(got, { video: { id: 'screen:0' }, audio: 'loopback' })
  await calls.mediaHandler({ audioRequested: false }, v => { got = v })
  assert.deepStrictEqual(got, { video: { id: 'screen:0' } })
  assert.strictEqual(calls.mediaOpts.useSystemPicker, false)
})
