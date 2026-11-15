import { describe, expect, it } from 'vitest'
import { joinPdfItems, buildContext, cleanPrep, isLang, languageInstruction, loadLang, loadLastPrep, loadPrep, MAX_PREP, savePrep, saveLang, srLang } from './prep'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('cleanPrep', () => {
  it('trims, normalises line endings and caps length', () => {
    expect(cleanPrep('  a\r\nb  ')).toBe('a\nb')
    expect(cleanPrep('x'.repeat(MAX_PREP + 50)).length).toBe(MAX_PREP)
  })
})

describe('buildContext', () => {
  it('is empty with no prep, English and no quick action', () => {
    expect(buildContext({ prep: '', lang: 'en', quick: null })).toEqual([])
  })
  it('adds background, language and quick instructions in that order', () => {
    const c = buildContext({ prep: 'I am a nurse', lang: 'sw', quick: 'shorter' })
    expect(c).toHaveLength(3)
    expect(c[0].content).toContain('I am a nurse')
    expect(c[1].content).toContain('Kiswahili')
    expect(c[2].content).toContain('two short sentences')
    expect(c.every(n => n.kind === 'note')).toBe(true)
  })
})

describe('language', () => {
  it('only asks the AI for a language when it is not English', () => {
    expect(languageInstruction('en')).toBe('')
    expect(languageInstruction('mixed')).toContain('English and Kiswahili')
  })
  it('picks the speech recognition code', () => {
    expect(srLang('sw', 'en-US')).toBe('sw-KE')
    expect(srLang('mixed', 'en-US')).toBe('en-KE')
    expect(srLang('en', 'fr-FR')).toBe('fr-FR')
    expect(srLang('en', '')).toBe('en-US')
  })
  it('validates language values', () => {
    expect(isLang('sw')).toBe(true)
    expect(isLang('fr')).toBe(false)
  })
})

describe('storage', () => {
  it('saves prep per session and remembers the last one', () => {
    const s = memory()
    savePrep(s, 'a', ' my cv ')
    expect(loadPrep(s, 'a')).toBe('my cv')
    expect(loadPrep(s, 'b')).toBe('')
    expect(loadLastPrep(s)).toBe('my cv')
  })
  it('survives missing or broken storage', () => {
    expect(loadPrep(null, 'a')).toBe('')
    const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
    expect(loadPrep(broken, 'a')).toBe('')
    expect(savePrep(broken, 'a', 'hi')).toBe('hi')
    expect(loadLang(broken)).toBe('en')
  })
  it('stores the chosen language', () => {
    const s = memory()
    expect(loadLang(s)).toBe('en')
    saveLang(s, 'sw')
    expect(loadLang(s)).toBe('sw')
  })
})

describe('joinPdfItems', () => {
  const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5 })
  it('puts items on new lines when the height changes', () => {
    expect(joinPdfItems([item('Jane Doe', 0, 700), item('Nurse', 0, 680)])).toBe('Jane Doe\nNurse')
  })
  it('adds a space between words only when there is a gap', () => {
    expect(joinPdfItems([item('Data', 0, 700), item('Analyst', 30, 700)])).toBe('Data Analyst')
    expect(joinPdfItems([item('Hel', 0, 700), item('lo', 15, 700)])).toBe('Hello')
  })
  it('honours end-of-line markers and tidies blank lines', () => {
    expect(joinPdfItems([{ str: 'A', hasEOL: true }, { str: '', hasEOL: true }, { str: '', hasEOL: true }, { str: 'B' }])).toBe('A\n\nB')
  })
  it('handles empty input', () => {
    expect(joinPdfItems([])).toBe('')
  })
})
