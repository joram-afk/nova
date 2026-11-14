import { describe, expect, it } from 'vitest'
import { downsample, encodeWav, joinChunks, peakLevel } from './audio'

describe('downsample', () => {
  it('reduces 48k to 16k by a factor of three', () => {
    const out = downsample(new Float32Array(48000).fill(0.5), 48000, 16000)
    expect(out.length).toBe(16000)
    expect(out[0]).toBeCloseTo(0.5)
  })
  it('leaves audio alone when it is already at or below the target rate', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(downsample(input, 16000, 16000)).toBe(input)
  })
})

describe('peakLevel', () => {
  it('finds the loudest sample either side of zero', () => {
    expect(peakLevel(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7)
  })
  it('is zero for silence', () => {
    expect(peakLevel(new Float32Array(100))).toBe(0)
  })
})

describe('joinChunks', () => {
  it('joins blocks in order', () => {
    const out = joinChunks([new Float32Array([1, 2]), new Float32Array([3])])
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})

describe('encodeWav', () => {
  it('writes a valid 16k mono WAV header and sample data', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1]), 16000)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 6)
    const v = new DataView(await blob.arrayBuffer())
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
  })
})
