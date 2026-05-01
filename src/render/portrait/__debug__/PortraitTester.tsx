// Open via window.uclifePortraitTester() in devtools, or via DebugPanel.

import { useState } from 'react'
import { create } from 'zustand'
import { DEBUG_AVAILABLE } from '../../../debug/store'
import { Portrait } from '../react/Portrait'
import { makeBaseSlave } from '../adapter/defaults'
import type { SlaveLike } from '../adapter/SlaveLike'

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
          <Portrait slave={slave} renderer="revamp" width={240} height={320} />
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
