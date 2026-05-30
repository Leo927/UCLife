// Phase 6.2 / Issue #70 — brig walk-up: occupant list + capacity gauge +
// per-prisoner verb wall. The room itself is authored in
// ship-classes.json5 per-class; this kiosk is the verb surface the 'brig'
// interactable opens. The verb wall (PrisonerVerbRow) is shared with the
// captain's-office comm panel so both surfaces drive ONE implementation.

import { useTrait, useQueryFirst } from 'koota/react'
import { Ship, IsFlagshipMark } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { useUI } from './uiStore'
import { useScene } from '../sim/scene'
import { useBrig } from '../sim/brig'
import { playUi } from '../audio/player'
import { PrisonerVerbRow } from './PrisonerVerbs'

const SHIP_SCENE_ID = 'playerShipInterior'

export function BrigPanel() {
  const open = useUI((s) => s.brigPanelOpen)
  const close = useUI((s) => s.setBrigPanel)
  const activeId = useScene((s) => s.activeId)
  const shipEnt = useQueryFirst(Ship, IsFlagshipMark)
  const ship = useTrait(shipEnt, Ship)
  const prisoners = useBrig((s) => s.prisoners)

  if (!open) return null
  if (activeId !== SHIP_SCENE_ID || !ship) return null

  const cls = getShipClass(ship.templateId)
  const cap = cls.brigCapacity
  const over = prisoners.length > cap

  const onClose = () => {
    playUi('ui.npc.close')
    close(false)
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>禁闭室 · {cls.nameZh}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">容量</span>
            <span className="combat-tally-row-value">
              {prisoners.length} / {cap}
              {over ? ' · 超员' : ''}
            </span>
          </div>
        </section>
        <section className="status-section">
          <h3>羁押人员</h3>
          {prisoners.length === 0 ? (
            <div className="status-meta">禁闭室无人。</div>
          ) : (
            prisoners.map((p) => (
              <div key={p.id} className="combat-tally-prisoner" data-prisoner-id={p.id}>
                <div className="combat-tally-row">
                  <span className="combat-tally-row-label">
                    {p.nameZh}
                    {p.titleZh ? <span className="status-meta"> · {p.titleZh}</span> : null}
                  </span>
                  <span className="combat-tally-row-value">
                    {p.contextZh} · 给养 {Math.round(p.provision)}
                  </span>
                </div>
                <PrisonerVerbRow prisoner={p} />
              </div>
            ))
          )}
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={onClose}>关闭</button>
          </div>
        </section>
      </div>
    </div>
  )
}
