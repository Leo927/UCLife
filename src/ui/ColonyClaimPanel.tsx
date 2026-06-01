// Phase 6.3.A — Colony claim panel.
// Opened when the player presses E on the administrator's chair in an
// unowned colony. The player can claim the colony here, installing a
// faction member as the first colony admin.
//
// Admin selection and the full diegetic NPC-obstacle flow land in
// Phase 6.3.D; for 6.3.A the claim verb is the minimal take-possession
// action: press the chair, confirm intent, ownership is sealed.

import { useUI } from './uiStore'
import { getPoi } from '../data/pois'
import { claimColony } from '../sim/colony'
import { playUi } from '../audio/player'

export function ColonyClaimPanel() {
  const poiId = useUI((s) => s.colonyClaimPoiId)
  const setPoiId = useUI((s) => s.setColonyClaimPoiId)

  if (!poiId) return null

  const poi = getPoi(poiId)

  const onClose = () => {
    playUi('ui.npc.close')
    setPoiId(null)
  }

  const onClaim = () => {
    claimColony(poiId, null)
    playUi('ui.hr.accept')
    useUI.getState().showToast(`${poi?.nameZh ?? poiId} 已纳入势力版图`)
    setPoiId(null)
  }

  return (
    <div className="status-overlay" onClick={onClose} data-colony-claim-overlay>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>宣告占领 · {poi?.nameZh ?? poiId}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <p style={{ margin: '0 0 8px' }}>
            {poi?.description ?? '这片废弃设施无人认领。'}
          </p>
          <p style={{ margin: 0, opacity: 0.7, fontSize: '0.85em' }}>
            坐上行政主椅，即宣告对此地的实际控制权。
            （行政官委派功能将在后续版本实装）
          </p>
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button
              className="dialog-option"
              data-colony-claim-confirm
              onClick={onClaim}
            >
              宣告占领
            </button>
            <button className="dialog-option" onClick={onClose}>取消</button>
          </div>
        </section>
      </div>
    </div>
  )
}
