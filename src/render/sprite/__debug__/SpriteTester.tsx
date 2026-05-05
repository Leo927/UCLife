// Open via window.uclifeSpriteTester() in devtools, or via DebugPanel.

import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { DEBUG_AVAILABLE } from '../../../debug/store'
import {
  generateAppearanceForName,
  type AppearanceData,
} from '../../../character/appearanceGen'
import { appearanceToLpc, composeSheet } from '..'
import type { LpcAnimation } from '../types'

interface TesterState { open: boolean; setOpen: (b: boolean) => void }

export const useSpriteTester = create<TesterState>((set) => ({
  open: false,
  setOpen: (b) => set({ open: b }),
}))

if (typeof window !== 'undefined') {
  ;(window as unknown as { uclifeSpriteTester: () => void }).uclifeSpriteTester = () =>
    useSpriteTester.getState().setOpen(true)
}

export function SpriteTester(): JSX.Element | null {
  const open = useSpriteTester((s) => s.open)
  const setOpen = useSpriteTester((s) => s.setOpen)
  const [name, setName] = useState('Alice Chen')
  const [animation, setAnimation] = useState<LpcAnimation>('walk')
  const [genderOverride, setGenderOverride] = useState<'auto' | 'male' | 'female'>('auto')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  const appearance: AppearanceData = useMemo(() => {
    return generateAppearanceForName(name || 'unnamed', {
      gender: genderOverride === 'auto' ? undefined : genderOverride,
    })
  }, [name, genderOverride])

  const manifest = useMemo(() => appearanceToLpc(appearance), [appearance])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    composeSheet(manifest, animation)
      .then((sheet) => {
        if (cancelled) return
        const target = canvasRef.current
        if (!target) return
        target.width = sheet.width
        target.height = sheet.height
        const ctx = target.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, target.width, target.height)
        ctx.drawImage(sheet, 0, 0)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [open, manifest, animation])

  if (!DEBUG_AVAILABLE) return null
  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1a', color: '#eee', padding: 16, borderRadius: 6,
          minWidth: 600, maxWidth: 900, maxHeight: '90vh', overflow: 'auto',
          fontFamily: 'monospace', fontSize: 12,
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>LPC sprite tester (dev)</h2>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'transparent', color: '#eee', border: '1px solid #444', padding: '2px 8px', cursor: 'pointer' }}
          >
            close
          </button>
        </header>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <label>
            name:
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ marginLeft: 4, background: '#222', color: '#eee', border: '1px solid #444', padding: '2px 6px', width: 200 }}
            />
          </label>
          <label>
            animation:
            <select
              value={animation}
              onChange={(e) => setAnimation(e.target.value as LpcAnimation)}
              style={{ marginLeft: 4, background: '#222', color: '#eee', border: '1px solid #444' }}
            >
              <option value="walk">walk</option>
              <option value="idle">idle</option>
            </select>
          </label>
          <label>
            gender:
            <select
              value={genderOverride}
              onChange={(e) => setGenderOverride(e.target.value as 'auto' | 'male' | 'female')}
              style={{ marginLeft: 4, background: '#222', color: '#eee', border: '1px solid #444' }}
            >
              <option value="auto">auto (seed)</option>
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </label>
        </div>
        <div style={{ background: '#0d0d0d', padding: 8, marginBottom: 12, border: '1px solid #333' }}>
          <canvas
            ref={canvasRef}
            style={{ imageRendering: 'pixelated', display: 'block', width: '100%' }}
          />
        </div>
        {error && (
          <div style={{ color: '#f88', marginBottom: 8 }}>error: {error}</div>
        )}
        <details open>
          <summary style={{ cursor: 'pointer' }}>manifest</summary>
          <pre style={{ fontSize: 10, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </details>
        <details>
          <summary style={{ cursor: 'pointer' }}>appearance</summary>
          <pre style={{ fontSize: 10, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(appearance, null, 2)}
          </pre>
        </details>
        <footer style={{ marginTop: 12, fontSize: 10, color: '#888' }}>
          Open with <code style={{ color: '#bbb' }}>uclifeSpriteTester()</code> in devtools.
        </footer>
      </div>
    </div>
  )
}
