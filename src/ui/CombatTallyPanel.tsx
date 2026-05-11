// Phase 6.0 (loot panel) + Phase 6.2 (captured panel + brig occupancy).
// Fires once tactical resolves with a payout (see endCombat('victory')
// in src/systems/combat.ts). Blocks campaign progression while open;
// defaults to OK to acknowledge.
//
// MS-parts inventory routing lands at 6.2.5; the loot column at 6.2
// is still credits + supplies + fuel (no parts row).

import { useUI } from './uiStore'
import { playUi } from '../audio/player'

export function CombatTallyPanel() {
  const tally = useUI((s) => s.combatTally)
  const setTally = useUI((s) => s.setCombatTally)

  if (!tally) return null

  const onClose = () => {
    playUi('ui.npc.close')
    setTally(null)
  }

  const brigOver = tally.brigOccupied > tally.brigCapacity

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>战斗结算</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <h3>缴获</h3>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">资金</span>
            <span className="combat-tally-row-value">
              <span className="combat-tally-row-delta">+¥{tally.creditsDelta}</span>
              ¥{tally.creditsAfter}
            </span>
          </div>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">补给</span>
            <span className="combat-tally-row-value">
              <span className="combat-tally-row-delta">+{tally.suppliesDelta}</span>
              {Math.round(tally.suppliesAfter)} / {tally.suppliesMax}
            </span>
          </div>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">燃料</span>
            <span className="combat-tally-row-value">
              <span className="combat-tally-row-delta">+{tally.fuelDelta}</span>
              {Math.round(tally.fuelAfter)} / {tally.fuelMax}
            </span>
          </div>
        </section>
        <section className="status-section">
          <h3>俘虏</h3>
          {tally.capturedPows.length === 0 ? (
            <div className="status-meta">无具名俘虏。</div>
          ) : (
            tally.capturedPows.map((p) => (
              <div key={p.id} className="combat-tally-row">
                <span className="combat-tally-row-label">
                  {p.nameZh}
                  {p.titleZh ? <span className="status-meta"> · {p.titleZh}</span> : null}
                </span>
                <span className="combat-tally-row-value">
                  {p.contextZh}
                </span>
              </div>
            ))
          )}
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">禁闭室</span>
            <span className="combat-tally-row-value">
              {tally.brigOccupied} / {tally.brigCapacity}
              {brigOver ? ' · 超员' : ''}
            </span>
          </div>
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={onClose}>返回舰桥</button>
          </div>
        </section>
      </div>
    </div>
  )
}
