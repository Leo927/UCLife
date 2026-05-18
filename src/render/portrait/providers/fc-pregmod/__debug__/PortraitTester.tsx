// Open via window.uclifePortraitTester() in devtools, or via DebugPanel.
// Renders FC pregmod presets through the FC provider's slave-rendering path
// directly — bypassing the user's active provider preference because this
// tester exists specifically to inspect FC output (preg / piercings fields
// that don't round-trip through Appearance traits).

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { DEBUG_AVAILABLE } from '../../../../../debug/store'
import { makeBaseSlave } from '../adapter/defaults'
import type { SlaveLike } from '../adapter/SlaveLike'
import { preloadFc, renderFromSlave } from '../index'

interface TesterState {
  open: boolean
  setOpen: (b: boolean) => void
}

export const usePortraitTester = create<TesterState>((set) => ({
  open: false,
  setOpen: (b) => set({ open: b }),
}))

if (typeof window !== 'undefined') {
  ;(window as unknown as { uclifePortraitTester: () => void }).uclifePortraitTester = () =>
    usePortraitTester.getState().setOpen(true)
}

type Preset = 'default-female' | 'default-male' | 'preg' | 'punk'

function buildPreset(p: Preset): SlaveLike {
  switch (p) {
    case 'default-female':
      return makeBaseSlave({ id: 1001, preset: 'civilian-female' })
    case 'default-male':
      return makeBaseSlave({ id: 1002, preset: 'civilian-male' })
    case 'preg': {
      const s = makeBaseSlave({ id: 1003, preset: 'civilian-female' })
      s.preg = 25
      s.belly = 15000
      return s
    }
    case 'punk': {
      const s = makeBaseSlave({ id: 1004, preset: 'civilian-female' })
      s.hColor = 'neon pink'
      s.hStyle = 'tails'
      s.hLength = 60
      s.makeup = 4
      s.skin = 'pale'
      s.piercing.lips = { weight: 1 }
      s.piercing.nose = { weight: 1 }
      s.piercing.eyebrow = { weight: 1 }
      s.piercing.ear = { weight: 2 }
      return s
    }
  }
}

function FcSlavePreview({ slave }: { slave: SlaveLike }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    preloadFc().then(
      () => { if (!cancelled) setReady(true) },
      (err) => { if (!cancelled) setError(err as Error) },
    )
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !ready) return
    try {
      const fragment = renderFromSlave(slave)
      while (el.firstChild) el.removeChild(el.firstChild)
      el.appendChild(fragment)
    } catch (err) {
      setError(err as Error)
    }
  }, [slave, ready])

  if (error) {
    return <div style={{ width: 240, height: 320, color: '#a33', fontSize: 11 }}>Tester error: {error.message}</div>
  }
  if (!ready) {
    return <div style={{ width: 240, height: 320, opacity: 0.5, fontSize: 11 }}>加载头像…</div>
  }
  // position: relative is load-bearing — FC layers use position: absolute.
  return <div ref={containerRef} style={{ width: 240, height: 320, overflow: 'hidden', position: 'relative' }} />
}

export function PortraitTester(): JSX.Element | null {
  const open = usePortraitTester((s) => s.open)
  const setOpen = usePortraitTester((s) => s.setOpen)
  const [preset, setPreset] = useState<Preset>('default-female')

  if (!DEBUG_AVAILABLE) return null
  if (!open) return null

  const slave = buildPreset(preset)

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1a',
          color: '#eee',
          padding: 16,
          borderRadius: 6,
          minWidth: 400,
          maxWidth: 600,
          maxHeight: '90vh',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>Portrait tester (dev)</h2>
          <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#eee', border: '1px solid #444', padding: '2px 8px', cursor: 'pointer' }}>
            close
          </button>
        </header>
        <div style={{ display: 'flex', gap: 16 }}>
          <FcSlavePreview slave={slave} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>preset:</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {(['default-female', 'default-male', 'preg', 'punk'] as Preset[]).map((p) => (
                  <label key={p} style={{ cursor: 'pointer' }}>
                    <input type="radio" checked={preset === p} onChange={() => setPreset(p)} /> {p}
                  </label>
                ))}
              </div>
            </div>
            <details>
              <summary style={{ cursor: 'pointer' }}>slave json</summary>
              <pre style={{ fontSize: 10, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(slave, null, 2)}
              </pre>
            </details>
          </div>
        </div>
        <footer style={{ marginTop: 12, fontSize: 10, color: '#888' }}>
          Open with <code style={{ color: '#bbb' }}>uclifePortraitTester()</code> in devtools.
        </footer>
      </div>
    </div>
  )
}
