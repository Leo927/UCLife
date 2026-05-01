import { useEffect } from 'react'
import { useTrait } from 'koota/react'
import { Character, Workstation, Job } from '../ecs/traits'
import { useUI } from './uiStore'
import { Portrait } from '../render/portrait/react/Portrait'
import { getJobSpec } from '../data/jobs'

export function PortraitModal() {
  const target = useUI((s) => s.enlargedPortrait)
  const setEnlarged = useUI((s) => s.setEnlargedPortrait)
  const info = useTrait(target, Character)
  const job = useTrait(target, Job)

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlarged(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, setEnlarged])

  if (!target || !info) return null

  const wsTrait = job?.workstation?.get(Workstation) ?? null
  const wsSpec = wsTrait ? getJobSpec(wsTrait.specId) : null
  const title = wsSpec?.jobTitle ?? info.title

  const close = () => setEnlarged(null)

  return (
    <div className="portrait-modal-overlay" onClick={close}>
      <div className="portrait-modal-panel" onClick={(e) => e.stopPropagation()}>
        <header className="portrait-modal-header">
          <h2>{info.name}{title ? ` · ${title}` : ''}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <div className="portrait-modal-body">
          <Portrait
            entity={target}
            renderer="revamp"
            width={400}
            height={560}
            clickable={false}
          />
        </div>
      </div>
    </div>
  )
}
