type RecognitionConstructor = new () => any

type SpeechError = Event & { error: string }

const nativeRecognition: RecognitionConstructor | undefined =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined

let microphonePermissionGranted = false

async function requestMicrophonePermission(): Promise<void> {
  if (microphonePermissionGranted) return
  if (typeof window === 'undefined' || !window.isSecureContext) {
    throw new Error('Microphone access requires HTTPS. Open NOVA using its secure Vercel URL.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is unavailable. Use an up-to-date Chrome, Edge, or Safari browser over HTTPS.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach(track => track.stop())
  microphonePermissionGranted = true
}

function dispatchRecognitionError(recognition: any, error: string) {
  const event = new Event('error') as SpeechError
  Object.defineProperty(event, 'error', { value: error })
  recognition.dispatchEvent(event)
}

function wrapRecognition(Native: RecognitionConstructor): RecognitionConstructor {
  return new Proxy(Native, {
    construct(target) {
      const recognition = Reflect.construct(target, [])
      let startGeneration = 0
      let starting = false

      return new Proxy(recognition, {
        get(target, property) {
          if (property === 'start') {
            return () => {
              if (starting) return
              starting = true
              const generation = ++startGeneration
              void requestMicrophonePermission()
                .then(() => {
                  if (generation !== startGeneration) return
                  try {
                    target.start()
                  } catch (error) {
                    dispatchRecognitionError(target, error instanceof Error ? 'audio-capture' : 'unknown')
                  }
                })
                .catch(error => {
                  if (generation !== startGeneration) return
                  const code = error instanceof DOMException && error.name === 'NotAllowedError'
                    ? 'not-allowed'
                    : 'audio-capture'
                  dispatchRecognitionError(target, code)
                })
                .finally(() => { starting = false })
            }
          }
          if (property === 'stop' || property === 'abort') {
            return (...args: unknown[]) => {
              startGeneration++
              starting = false
              return Reflect.get(target, property, target).apply(target, args)
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
        set(target, property, value) {
          return Reflect.set(target, property, value, target)
        }
      })
    }
  }) as RecognitionConstructor
}

export const SR = nativeRecognition ? wrapRecognition(nativeRecognition) : undefined
export const speechSupported = Boolean(SR)

export function speechAvailabilityMessage(): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Voice input requires a secure HTTPS connection.'
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Microphone access is unavailable in this browser. Use current Chrome, Edge, or Safari over HTTPS.'
  }
  if (!SR) {
    return 'Live speech recognition is not supported by this browser. Try current Chrome or Edge, or type a note instead.'
  }
  return ''
}
