// Dormant today: every POI has a single dockScene so this modal never
// opens. Kept live so that adding a second landing scene to any POI in
// pois.json5 activates the picker without further code changes.

import { useUI } from './uiStore'
import { runTransition, useTransition } from '../sim/transition'
import { disembarkShip } from '../sim/scene'
import { getSceneConfig } from '../data/scenes'
import { resolveDisembarkArrival } from '../systems/interaction'
import { playUi } from '../audio/player'

export function DockPickerModal() {
  const payload = useUI((s) => s.dockPicker)
  const close = useUI((s) => s.closeDockPicker)
  const showToast = useUI((s) => s.showToast)
  const inTransition = useTransition((s) => s.inProgress)

  if (!payload) return null

  const onClose = () => { playUi('ui.flight.close'); close() }

  const pick = (targetSceneId: string) => {
    if (inTransition) return
    const arrivalPx = resolveDisembarkArrival(targetSceneId, payload.shipKey)
    if (!arrivalPx) {
      showToast('该坐标不可登陆')
      return
    }
    close()
    runTransition({ midpoint: () => disembarkShip(targetSceneId, arrivalPx) })
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>下船 · 选择停泊点</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          {payload.candidates.map((sceneId) => {
            const cfg = (() => {
              try { return getSceneConfig(sceneId) } catch { return null }
            })()
            const label = cfg?.titleZh ?? sceneId
            return (
              <div key={sceneId} className="transit-terminal-row" data-dock-picker-row={sceneId}>
                <div className="transit-terminal-info">
                  <div className="transit-terminal-name">{label}</div>
                </div>
                <button
                  className="transit-terminal-go"
                  onClick={() => pick(sceneId)}
                  disabled={inTransition}
                >
                  下船
                </button>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
