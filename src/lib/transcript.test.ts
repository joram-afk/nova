import { describe, expect, it } from 'vitest'
import { chunkLines, isQuestion, mergeInterim, parseTranscript } from './transcript'

describe('parseTranscript', () => {
  it('drops WEBVTT headers, cue numbers, timestamps and tags', () => {
    const raw = 'WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.000\r\n<v Ann>Hello everyone</v>\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.000\r\nLet us begin\r\n'
    expect(parseTranscript(raw)).toEqual(['Hello everyone', 'Let us begin'])
  })
  it('returns nothing for empty input', () => {
    expect(parseTranscript('  \n\n ')).toEqual([])
  })
})

describe('chunkLines', () => {
  it('keeps short input in one chunk', () => {
    expect(chunkLines(['a', 'b', 'c'])).toEqual(['a\nb\nc'])
  })
  it('starts a new chunk once the limit is passed, without splitting lines', () => {
    const line = 'x'.repeat(300)
    expect(chunkLines([line, line, line], 500)).toEqual([line, line, line])
  })
})

describe('isQuestion', () => {
  it('spots question marks and question openers', () => {
    expect(isQuestion('What is your biggest strength')).toBe(true)
    expect(isQuestion('Tell me about yourself')).toBe(true)
    expect(isQuestion('Is that right?')).toBe(true)
  })
  it('ignores plain statements', () => {
    expect(isQuestion('We shipped the release yesterday')).toBe(false)
  })
  it('only matches a question word at the start of the line', () => {
    expect(isQuestion('So what is your biggest strength')).toBe(false)
  })
})

describe('mergeInterim', () => {
  it('replaces the held text as the sentence grows', () => {
    expect(mergeInterim('what is', 'what is the')).toEqual({ commit: false, pending: 'what is the' })
  })
  it('keeps the longer text when a shorter echo arrives', () => {
    expect(mergeInterim('what is the time', 'what is')).toEqual({ commit: false, pending: 'what is the time' })
  })
  it('asks to save the held sentence when a new one starts', () => {
    expect(mergeInterim('what is the time', 'tell me about')).toEqual({ commit: true, pending: 'tell me about' })
  })
  it('ignores blank input', () => {
    expect(mergeInterim('hello', '   ')).toEqual({ commit: false, pending: 'hello' })
  })
})
