// Issue #71 — recoverables dialogue. Fires at combat resolution BEFORE the
// post-combat tally: lists every survivor hull (Recover / Salvage /
// Scuttle) and every ejected pod (Recover / Leave). Closing early applies
// the defaults (scuttle hulls, leave pods). On close the panel calls
// finishRecoverables(), which re-emits the (brig-refreshed) tally.
//
// The list is read from systems/recoverables; the panel re-reads after
// each action via a local version counter so the rows reflect the chosen
// resolution and the prize-crew gate.

import { useState } from 'react'
import { useUI } from './uiStore'
import { playUi } from '../audio/player'
import {
  getRecoverables, recoverHull, salvageHull, scuttleHull,
  recoverPod, leavePod, canRecoverHull, finishRecoverables,
} from '../systems/recoverables'

const RESOLUTION_LABEL: Record<string, string> = {
  recover: '已接管',
  salvage: '已拆解',
  scuttle: '已放弃',
  leave: '已放任',
  pending: '',
}

export function RecoverablesPanel() {
  const open = useUI((s) => s.recoverablesOpen)
  const setOpen = useUI((s) => s.setRecoverables)
  const showToast = useUI((s) => s.showToast)
  // Re-read the live list after each action.
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  if (!open) return null
  void version
  const { hulls, pods } = getRecoverables()

  const close = () => {
    playUi('ui.npc.close')
    setOpen(false)
    finishRecoverables()
  }

  const onRecoverHull = (id: string) => {
    const r = recoverHull(id)
    playUi(r.ok ? 'ui.hr.accept' : 'ui.npc.close')
    if (!r.ok) showToast(r.reasonZh ?? '无法接管。')
    bump()
  }
  const onSalvageHull = (id: string) => { salvageHull(id); playUi('ui.hr.accept'); bump() }
  const onScuttleHull = (id: string) => { scuttleHull(id); playUi('ui.npc.close'); bump() }
  const onRecoverPod = (id: string) => {
    const r = recoverPod(id)
    playUi(r.ok ? 'ui.hr.accept' : 'ui.npc.close')
    if (!r.ok) showToast(r.reasonZh ?? '无法收容。')
    bump()
  }
  const onLeavePod = (id: string) => { leavePod(id); playUi('ui.npc.close'); bump() }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>战场回收</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>

        <section className="status-section">
          <h3>残存舰体</h3>
          {hulls.length === 0 ? (
            <div className="status-meta">无可回收舰体。</div>
          ) : (
            hulls.map((h) => {
              const gate = canRecoverHull(h.id)
              const resolved = h.resolution !== 'pending'
              return (
                <div key={h.id} className="combat-tally-prisoner" data-recoverable-hull={h.id}>
                  <div className="combat-tally-row">
                    <span className="combat-tally-row-label">{h.nameZh}</span>
                    <span className="combat-tally-row-value">
                      {resolved ? RESOLUTION_LABEL[h.resolution] : `船体 ${Math.round(h.hullCurrent)}`}
                    </span>
                  </div>
                  {!resolved && (
                    <div className="dialog-options">
                      <button
                        className="dialog-option"
                        data-hull-verb="recover"
                        disabled={!gate.ok}
                        title={gate.ok ? '' : gate.reasonZh}
                        onClick={() => onRecoverHull(h.id)}
                      >接管{gate.ok ? '' : ' · 船员不足'}</button>
                      <button className="dialog-option" data-hull-verb="salvage" onClick={() => onSalvageHull(h.id)}>拆解</button>
                      <button className="dialog-option" data-hull-verb="scuttle" onClick={() => onScuttleHull(h.id)}>放弃</button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </section>

        <section className="status-section">
          <h3>逃生舱</h3>
          {pods.length === 0 ? (
            <div className="status-meta">无逃生舱。</div>
          ) : (
            pods.map((p) => {
              const resolved = p.resolution !== 'pending'
              return (
                <div key={p.id} className="combat-tally-prisoner" data-recoverable-pod={p.id}>
                  <div className="combat-tally-row">
                    <span className="combat-tally-row-label">
                      {p.nameZh}
                      {p.titleZh ? <span className="status-meta"> · {p.titleZh}</span> : null}
                    </span>
                    <span className="combat-tally-row-value">
                      {resolved ? RESOLUTION_LABEL[p.resolution] : p.contextZh}
                    </span>
                  </div>
                  {!resolved && (
                    <div className="dialog-options">
                      <button className="dialog-option" data-pod-verb="recover" onClick={() => onRecoverPod(p.id)}>收容入禁闭室</button>
                      <button className="dialog-option" data-pod-verb="leave" onClick={() => onLeavePod(p.id)}>放任</button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </section>

        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" data-recoverables-confirm onClick={close}>确认 · 进入结算</button>
          </div>
        </section>
      </div>
    </div>
  )
}
