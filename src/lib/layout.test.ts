import { describe, expect, it } from 'vitest'
import { LAYOUTS, isLayout, loadLayout, saveLayout } from './layout'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('layout', () => {
  it('defaults to the chat feed', () => {
    expect(loadLayout(memory())).toBe('chat')
    expect(loadLayout(null)).toBe('chat')
  })
  it('remembers the chosen layout', () => {
    const s = memory()
    saveLayout(s, 'focus')
    expect(loadLayout(s)).toBe('focus')
    saveLayout(s, 'tabs')
    expect(loadLayout(s)).toBe('tabs')
  })
  it('ignores unknown stored values and broken storage', () => {
    const s = memory()
    s.setItem('nova.layout', 'sidebar')
    expect(loadLayout(s)).toBe('chat')
    const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
    expect(loadLayout(broken)).toBe('chat')
    expect(() => saveLayout(broken, 'tabs')).not.toThrow()
  })
  it('offers all three layouts', () => {
    expect(LAYOUTS.map(l => l.code)).toEqual(['chat', 'focus', 'tabs'])
    expect(LAYOUTS.every(l => isLayout(l.code))).toBe(true)
  })
})
