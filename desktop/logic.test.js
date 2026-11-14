const test = require('node:test')
const assert = require('node:assert')
const { DEFAULT_URL, HOTKEYS, normalizeUrl, cleanOverlayState, cleanOverlayAction, isInternal } = require('./logic')

test('normalizeUrl adds https, trims paths, rejects other schemes', () => {
  assert.strictEqual(normalizeUrl('nova-copilot.vercel.app/x?y=1'), 'https://nova-copilot.vercel.app')
  assert.strictEqual(normalizeUrl('  '), DEFAULT_URL)
  assert.strictEqual(normalizeUrl('javascript:alert(1)'), null)
  assert.strictEqual(normalizeUrl('file:///etc/passwd'), null)
})
test('cleanOverlayState caps text and coerces flags', () => {
  const s = cleanOverlayState({ text: 'a'.repeat(9000), listening: 1, extra: 'x' })
  assert.strictEqual(s.text.length, 4000)
  assert.strictEqual(s.listening, true)
  assert.strictEqual(s.capturing, false)
  assert.deepStrictEqual(Object.keys(s).sort(), ['busy', 'capturing', 'listening', 'text', 'title'])
  assert.strictEqual(cleanOverlayState(null).text, '')
})
test('cleanOverlayAction allows only known actions', () => {
  assert.deepStrictEqual(cleanOverlayAction({ type: 'ask' }), { type: 'ask' })
  assert.deepStrictEqual(cleanOverlayAction({ type: 'note', text: '  hi ' }), { type: 'note', text: 'hi' })
  assert.strictEqual(cleanOverlayAction({ type: 'eval' }), null)
  assert.strictEqual(cleanOverlayAction('ask'), null)
})
test('isInternal compares origins', () => {
  assert.ok(isInternal('https://nova-copilot.vercel.app/a', 'https://nova-copilot.vercel.app'))
  assert.ok(!isInternal('https://evil.com', 'https://nova-copilot.vercel.app'))
  assert.ok(!isInternal('not a url', 'https://nova-copilot.vercel.app'))
})
test('hotkeys are unique', () => {
  assert.strictEqual(new Set(HOTKEYS.map(h => h.accelerator)).size, HOTKEYS.length)
})
