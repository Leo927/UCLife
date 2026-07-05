// W2 Task 6 — defeat / flee debrief beat. Fires from endCombat's two
// non-victory branches (src/systems/combat.ts) via the
// 'ui:open-combat-debrief' event (see boot/uiBindings.ts). Styling mirrors
// CombatTallyPanel; unlike the victory tally this is a beat, not a menu —
// one continue button, no click-outside dismiss, no choices.

import { useUI } from './uiStore'
import { playUi } from '../audio/player'

const OUTCOME_HEADING_ZH: Record<'defeat' | 'flee', string> = {
  defeat: '战败',
  flee: '脱离',
}

export function CombatDebriefPanel() {
  const debrief = useUI((s) => s.combatDebrief)
  const setDebrief = useUI((s) => s.setCombatDebrief)

  if (!debrief) return null

  const onContinue = () => {
    playUi('ui.npc.close')
    setDebrief(null)
  }

  return (
    <div className="status-overlay" data-combat-debrief data-combat-debrief-outcome={debrief.outcome}>
      <div className="status-panel">
        <header className="status-header">
          <h2>战斗结算 · {OUTCOME_HEADING_ZH[debrief.outcome]}</h2>
        </header>
        <section className="status-section">
          {debrief.lines.map((line) => (
            <div key={line.labelZh} className="combat-tally-row">
              <span className="combat-tally-row-label">{line.labelZh}</span>
              <span className="combat-tally-row-value">{line.valueZh}</span>
            </div>
          ))}
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" data-combat-debrief-continue onClick={onContinue}>
              继续
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
