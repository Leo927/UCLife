// Phase 7.0.C — conscription draft-notice panel. Opens when a draft notice
// issues (the 'ui:draft-notice' event). The player resolves the refusal roll:
// accept the draft, refuse (stat-checked), or pay a bribe to improve the odds
// then refuse. Resolution routes through systems/conscription.resolveDraft;
// a drafted outcome fires the perspective-shift hook into Phase 7.1.

import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money } from '../ecs/traits'
import { useUI } from './uiStore'
import { useClock, gameDayNumber } from '../sim/clock'
import { resolveDraft, type DraftChoice } from '../systems/conscription'
import { playUi } from '../audio/player'

export function DraftNoticePanel() {
  const notice = useUI((s) => s.draftNotice)
  const setNotice = useUI((s) => s.setDraftNotice)
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)

  if (!notice) return null

  const refusalPct = Math.round(notice.refusalChance * 100)
  // Affordability checked live (money can change between issuance and decision).
  const canBribe = (money?.amount ?? 0) >= notice.bribeCost

  const resolve = (choice: DraftChoice) => {
    const date = useClock.getState().gameDate
    const outcome = resolveDraft(choice, gameDayNumber(date), date.getTime())
    playUi(outcome.outcome === 'civilian' ? 'ui.hr.accept' : 'ui.npc.close')
    setNotice(null)
  }

  return (
    <div className="status-overlay" data-draft-notice-overlay>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>征召令</h2>
        </header>
        <section className="status-section">
          <p style={{ margin: '0 0 8px' }}>
            联邦军征召令已送达。你可以接受、设法逃避(成功率约 {refusalPct}%),或花钱打点关系再试。
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="shop-item-buy" data-draft-accept onClick={() => resolve('accept')}>
              接受征召
            </button>
            <button className="shop-item-buy" data-draft-refuse onClick={() => resolve('refuse')}>
              设法逃避 ({refusalPct}%)
            </button>
            <button
              className="shop-item-buy"
              data-draft-bribe
              disabled={!canBribe}
              onClick={() => resolve('bribe')}
            >
              行贿 ¥{notice.bribeCost}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
