// Phase 6.0 post-combat tally — minimum surface (credits + supplies +
// fuel deltas, OK to dismiss). Fires once tactical resolves with a payout
// (see endCombat('victory') in src/systems/combat.ts). Blocks campaign
// progression while open; defaults to OK to acknowledge.
//
// Phase 6.2 will replace this with the full tally — loot routing across
// fleet cargo, named-POW reveal panel, brig occupancy line. The dialog
// signature stays the same so the wiring carries forward.

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

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>战斗结算</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
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
          <div className="dialog-options">
            <button className="dialog-option" onClick={onClose}>返回舰桥</button>
          </div>
        </section>
      </div>
    </div>
  )
}
