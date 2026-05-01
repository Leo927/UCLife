import { useTransition } from '../sim/transition'

export function TransitionOverlay() {
  const phase = useTransition((s) => s.phase)
  const progress = useTransition((s) => s.progress)
  const style = useTransition((s) => s.style)
  const inProgress = useTransition((s) => s.inProgress)

  if (phase === 'idle') return null

  if (style === 'fade') {
    return (
      <div
        className="transition-overlay"
        style={{
          opacity: progress,
          pointerEvents: inProgress ? 'auto' : 'none',
        }}
      />
    )
  }

  return null
}
