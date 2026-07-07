// W3 (ms-identity) Task 7 — eject-confirm beat. Opens (auto-paused, per
// post-combat.md's designed pause set) when the player's MS hull hits 0 or
// life support drains to 0 mid-sortie. A beat, not a choice: one confirm
// button — confirming spawns the drifting escape pod (systems/combat.ts →
// sim/ejection.ts) and resumes the fight with the player as observer.

import { useUI } from './uiStore'
import { confirmPlayerEject } from '../systems/combat'
import { playUi } from '../audio/player'

export function EjectConfirmModal() {
  const payload = useUI((s) => s.ejectConfirm)
  const setEjectConfirm = useUI((s) => s.setEjectConfirm)

  if (!payload) return null

  const onConfirm = () => {
    playUi('ui.npc.close')
    confirmPlayerEject()
    setEjectConfirm(null)
  }

  return (
    <div className="status-overlay eject-confirm-overlay" data-eject-confirm>
      <div className="status-panel">
        <header className="status-header">
          <h2>{payload.titleZh}</h2>
        </header>
        <section className="status-section">
          <p>{payload.reasonZh}</p>
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" data-eject-confirm-button onClick={onConfirm}>
              弹射！
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
