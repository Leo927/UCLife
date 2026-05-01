import { create } from 'zustand'

export type TransitionStyle = 'fade'
export type TransitionPhase = 'idle' | 'out' | 'midpoint' | 'in'

interface TransitionState {
  style: TransitionStyle
  phase: TransitionPhase
  // 0..1 inside each phase. Out: 0 = clear, 1 = fully covered. In: 1 = fully
  // covered, 0 = clear.
  progress: number
  inProgress: boolean
  _setPhase: (phase: TransitionPhase, progress: number) => void
  _setIdle: () => void
}

export const useTransition = create<TransitionState>((set) => ({
  style: 'fade',
  phase: 'idle',
  progress: 0,
  inProgress: false,
  _setPhase: (phase, progress) => set({ phase, progress, inProgress: true }),
  _setIdle: () => set({ phase: 'idle', progress: 0, inProgress: false }),
}))

interface RunTransitionOptions {
  style?: TransitionStyle
  outMs?: number
  inMs?: number
  // Fired with the cover fully opaque, so visible-world mutations (teleport,
  // scene swap) are invisible to the player. Awaited.
  midpoint: () => void | Promise<void>
}

const DEFAULT_OUT_MS = 280
const DEFAULT_IN_MS = 280

let activePromise: Promise<void> | null = null

function animatePhase(
  ms: number,
  phase: TransitionPhase,
  progressFn: (t: number) => number,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const setPhase = useTransition.getState()._setPhase
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms)
      setPhase(phase, progressFn(t))
      if (t < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
}

export async function runTransition(opts: RunTransitionOptions): Promise<void> {
  // Coalesce back-to-back invocations so a double-click doesn't strand the
  // cover.
  if (activePromise) await activePromise
  const outMs = opts.outMs ?? DEFAULT_OUT_MS
  const inMs = opts.inMs ?? DEFAULT_IN_MS
  const style = opts.style ?? 'fade'
  useTransition.setState({ style })

  activePromise = (async () => {
    await animatePhase(outMs, 'out', (t) => t)
    useTransition.getState()._setPhase('midpoint', 1)
    await opts.midpoint()
    await animatePhase(inMs, 'in', (t) => 1 - t)
    useTransition.getState()._setIdle()
  })()
  try {
    await activePromise
  } finally {
    activePromise = null
  }
}
