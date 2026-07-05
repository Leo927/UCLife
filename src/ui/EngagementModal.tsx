import { useEffect } from 'react'
import { useEngagement } from '../sim/engagement'
import { playUi } from '../audio/player'
import { combatConfig } from '../config'

const SHIP_CLASS_NAMES_ZH: Record<string, string> = {
  pirate_skirmisher: '海盗游击艇',
  pirate_raider: '海盗劫掠舰',
  pirateLight: '海盗轻型护卫舰',
}

function shipClassLabel(id: string | null): string {
  if (!id) return '未知舰艇'
  return SHIP_CLASS_NAMES_ZH[id] ?? id
}

export function EngagementModal() {
  const open = useEngagement((s) => s.open)
  const enemyShipClassId = useEngagement((s) => s.enemyShipClassId)
  const enemyEscorts = useEngagement((s) => s.enemyEscorts)
  const resolve = useEngagement((s) => s.resolve)
  const dismiss = useEngagement((s) => s.dismiss)

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!open) return null

  const fleetCount = 1 + enemyEscorts.length
  const escortLine = enemyEscorts.length > 0
    ? `护航: ${enemyEscorts.map(shipClassLabel).join(' · ')}`
    : null

  return (
    <div className="status-overlay">
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>遭遇敌方舰队</h2>
          <button className="status-close" onClick={() => { playUi('ui.engagement.dismiss'); dismiss() }} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <p className="map-place-desc">
            旗舰: {shipClassLabel(enemyShipClassId)} · 共 {fleetCount} 艘
          </p>
          {escortLine && <p className="map-place-desc">{escortLine}</p>}
        </section>
        <section className="status-section" style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => { playUi('ui.engagement.negotiate'); resolve('negotiate') }}>尝试谈判</button>
            <button onClick={() => { playUi('ui.engagement.flee'); resolve('flee') }}>脱离</button>
            <button onClick={() => { playUi('ui.engagement.engage'); resolve('engage') }}>交战</button>
          </div>
          {/* W2 Task 3 — flee's consequence is silent no longer; the same
              combat.json5 values drive this line and the mid-combat
              withdraw button's confirm copy, so they can never drift apart. */}
          <p className="map-place-desc" style={{ margin: 0 }}>
            脱离 · 船体 -{Math.round(combatConfig.fleePenalty.hullLossPct * 100)}% · 战备 -{combatConfig.fleePenalty.crDrain}
          </p>
        </section>
      </div>
    </div>
  )
}
