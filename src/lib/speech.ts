import { callAssist } from './assist'
import type { Mode } from '../types'
import { downsample, encodeWav, joinChunks, peakLevel } from './audio'

// Keep the SpeechRecognition interface used by App.tsx, but capture actual microphone samples
// and send them to NOVA's authenticated transcription endpoint instead of relying on browser speech services.
class CloudSpeechRecognition {
  continuous = true
  interimResults = true
  lang = ''
  onresult: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onend: (() => void) | null = null

  private active = false
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private mute: GainNode | null = null
  private blocks: Float32Array[] = []
  private sampleCount = 0
  private chain: Promise<void> = Promise.resolve()

  start(): void {
    if (this.active) return
    this.active = true
    void this.openMicrophone()
  }

  private async openMicrophone(): Promise<void> {
    try {
      if (!window.isSecureContext) throw new Error('Microphone capture requires HTTPS. Open NOVA using its secure Vercel URL.')
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone capture.')
      if (typeof AudioContext === 'undefined') throw new Error('This browser does not support microphone audio processing.')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (!this.active) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      this.stream = stream
      const context = new AudioContext()
      this.context = context
      await context.resume()
      if (!this.active) { await this.release(); return }

      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const mute = context.createGain()
      mute.gain.value = 0
      this.source = source
      this.processor = processor
      this.mute = mute
      processor.onaudioprocess = event => {
        if (!this.active) return
        const input = event.inputBuffer.getChannelData(0)
        this.blocks.push(new Float32Array(input))
        this.sampleCount += input.length
        if (this.sampleCount >= context.sampleRate * 8) this.flushAudio()
      }
      source.connect(processor)
      // A ScriptProcessorNode only runs when connected to an output. Mute its output to avoid feedback.
      processor.connect(mute)
      mute.connect(context.destination)
    } catch (error) {
      this.active = false
      this.emitError(error instanceof Error ? error.message : 'Could not access the microphone.', 'not-allowed')
      await this.release()
      this.onend?.()
    }
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.flushAudio()
    void this.chain.finally(async () => {
      await this.release()
      this.onend?.()
    })
  }

  abort(): void {
    this.active = false
    this.blocks = []
    this.sampleCount = 0
    void this.release().finally(() => this.onend?.())
  }

  private flushAudio(): void {
    if (!this.blocks.length) return
    const blocks = this.blocks
    this.blocks = []
    this.sampleCount = 0
    this.chain = this.chain.then(async () => {
      const context = this.context
      if (!context) return
      const samples = joinChunks(blocks)
      if (peakLevel(samples) < 0.015) return
      const pcm = downsample(samples, context.sampleRate, 16000)
      if (!pcm.length) return
      const wav = encodeWav(pcm, 16000)
      if (wav.size > 4_000_000) throw new Error('The audio chunk is too large to upload.')
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('Could not encode the recorded audio.'))
        reader.readAsDataURL(wav)
      })
      const text = await callAssist({ task: 'transcribe', mode: 'Meeting', audio, mime: 'audio/wav' }, 'Could not transcribe microphone audio')
      if (!this.active || !text.trim() || /^\[?silence\]?\.?$/i.test(text.trim())) return
      this.onresult?.({ resultIndex: 0, results: [[{ transcript: text.trim() }]] })
    }).catch(error => {
      this.emitError(error instanceof Error ? error.message : 'Microphone transcription failed.', 'network')
    })
  }

  private emitError(message: string, code: string): void {
    const event = new Event('error') as Event & { error: string; message: string }
    Object.defineProperties(event, { error: { value: code }, message: { value: message } })
    this.onerror?.(event)
  }

  private async release(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null
      try { this.processor.disconnect() } catch { /* already disconnected */ }
      this.processor = null
    }
    try { this.mute?.disconnect() } catch { /* already disconnected */ }
    this.mute = null
    try { this.source?.disconnect() } catch { /* already disconnected */ }
    this.source = null
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (this.context) {
      const context = this.context
      this.context = null
      try { await context.close() } catch { /* already closed */ }
    }
  }
}

export const SR = CloudSpeechRecognition
export const speechSupported =
  typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined'
