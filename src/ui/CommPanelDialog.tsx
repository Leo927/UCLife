// Phase 6.2 captain's-office comm panel — the kiosk that hangs the
// officer face wall + named-POW intel reveal on a single surface inside
// the captain's office. Opened via the 'commPanel' interactable.
//
// Single-ship 6.2 ships the adjutant slot only; the comm panel is the
// surface where 6.2.5 will hang prisoner verbs (interrogate / ransom /
// recruit / execute / hand-over / release). Today it's read-only.

import { useTrait, useQueryFirst } from 'koota/react'
import { Ship, IsFlagshipMark } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { useUI } from './uiStore'
import { useScene } from '../sim/scene'
import { useBrig } from '../sim/brig'
import { playUi } from '../audio/player'

const SHIP_SCENE_ID = 'playerShipInterior'

export function CommPanelDialog() {
  const open = useUI((s) => s.commPanelOpen)
  const close = useUI((s) => s.setCommPanel)
  const activeId = useScene((s) => s.activeId)
  const shipEnt = useQueryFirst(Ship, IsFlagshipMark)
  const ship = useTrait(shipEnt, Ship)
  // Subscribe to brig store so a fresh capture re-renders without close/open.
  const prisoners = useBrig((s) => s.prisoners)

  if (!open) return null
  if (activeId !== SHIP_SCENE_ID || !ship) return null

  const cls = getShipClass(ship.templateId)
  const adjutant = cls.officers.adjutant

  const onClose = () => {
    playUi('ui.npc.close')
    close(false)
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>通讯面板 · {cls.nameZh}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <h3>船桥军官</h3>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">
              {adjutant.title ?? '副官'} · {adjutant.name}
            </span>
            <span className="combat-tally-row-value">在岗</span>
          </div>
          <div className="status-meta">
            6.2.5 + 章节将在此挂载机械长 · 医务官 · 通讯员等席位。
          </div>
        </section>
        <section className="status-section">
          <h3>禁闭室囚犯 · {prisoners.length} / {cls.brigCapacity}</h3>
          {prisoners.length === 0 ? (
            <div className="status-meta">禁闭室无人。</div>
          ) : (
            prisoners.map((p) => (
              <div key={p.id} className="combat-tally-row">
                <span className="combat-tally-row-label">
                  {p.nameZh}
                  {p.titleZh ? <span className="status-meta"> · {p.titleZh}</span> : null}
                </span>
                <span className="combat-tally-row-value">已羁押</span>
              </div>
            ))
          )}
          <div className="status-meta">
            审讯 · 索赎 · 招募 · 处决 · 移交 · 释放等指令将在 6.2.5 启用。
          </div>
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
