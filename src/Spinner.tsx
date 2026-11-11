import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// NOVA orbit: two counter-rotating rings around a pulsing core.
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spin" role="status" aria-label="Loading" style={{ '--s': `${size}px` } as CSSProperties}><i /></span>
}

interface Props {
  onClick: () => unknown
  className?: string
  disabled?: boolean
  loading?: boolean
  title?: string
  children: ReactNode
}

// A button that shows the spinner while its (async) action runs and blocks double clicks.
export function LoadButton({ onClick, className = '', disabled, loading, title, children }: Props) {
  const [busy, setBusy] = useState(false)
  const on = loading ?? busy
  async function run() {
    if (on) return
    setBusy(true)
    try { await onClick() } finally { setBusy(false) }
  }
  return (
    <button className={`${className}${on ? ' is-loading' : ''}`} title={title} disabled={disabled || on} aria-busy={on} onClick={() => void run()}>
      {on && <Spinner size={14} />}{children}
    </button>
  )
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="bubble ai thinking">
      <Spinner size={28} />
      <div><strong className="shimmer">{label}</strong><small>This can take a few seconds</small></div>
    </div>
  )
}
