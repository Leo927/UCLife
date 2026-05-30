// Phase 6.2 captain's-office comm panel — the kiosk that hangs the
// officer face wall + named-POW intel reveal on a single surface inside
// the captain's office. Opened via the 'commPanel' interactable.
//
// Single-ship 6.2 ships the adjutant slot only; the comm panel is the
// surface where 6.2.5 will hang prisoner verbs (interrogate / ransom /
// recruit / execute / hand-over / release). Today it's read-only.

import { useTrait, useQueryFirst } from 'koota/react'
import { Ship, IsFlagshipMark, Ms, EntityKey } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { useUI } from './uiStore'
import { useScene } from '../sim/scene'
import { useBrig } from '../sim/brig'
import { playUi } from '../audio/player'
import { useClock } from '../sim/clock'
import { getWorld } from '../ecs/world'
import { dispatchRecoveryTug } from '../sim/recoveryTug'
import { pushCombatLog } from '../sim/combatLog'
import { PrisonerVerbRow } from './PrisonerVerbs'

const SHIP_SCENE_ID = 'playerShipInterior'

export function CommPanelDialog() {
  const open = useUI((s) => s.commPanelOpen)
  const close = useUI((s) => s.setCommPanel)
  const activeId = useScene((s) => s.activeId)
  const shipEnt = useQueryFirst(Ship, IsFlagshipMark)
  const ship = useTrait(shipEnt, Ship)
  // Subscribe to brig store so a fresh capture re-renders without close/open.
  const prisoners = useBrig((s) => s.prisoners)
  // Phase 6.2.5.C — the recovery-tug verb is only available during
  // tactical play (clock.mode === 'combat').
  const clockMode = useClock((s) => s.mode)

  if (!open) return null
  if (activeId !== SHIP_SCENE_ID || !ship) return null

  const cls = getShipClass(ship.templateId)
  const adjutant = cls.officers.adjutant

  const onClose = () => {
    playUi('ui.npc.close')
    close(false)
  }

  // Stranded MS list — any MS in the playerShipInterior world with
  // currentPropellant === 0 is a candidate for tug recovery. We don't
  // gate on storedOnShipKey here because the stranded MS is deployed
  // (sortie state), not stored aboard. The systems/recoveryTug.ts
  // dispatch path will gate on the CombatShipState row existing.
  const strandedList: Array<{ key: string; name: string }> = []
  if (clockMode === 'combat') {
    const w = getWorld(SHIP_SCENE_ID)
    for (const ent of w.query(Ms, EntityKey)) {
      const m = ent.get(Ms)!
      if (m.currentPropellant <= 0) {
        strandedList.push({ key: ent.get(EntityKey)!.key, name: m.name })
      }
    }
  }

  const onDispatchTug = (msKey: string) => {
    playUi('ui.hr.accept')
    const r = dispatchRecoveryTug(msKey)
    if (!r.ok) pushCombatLog(`回收艇派遣失败 · ${r.reasonZh}`, 'warn')
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
              <div key={p.id} className="combat-tally-prisoner" data-prisoner-id={p.id}>
                <div className="combat-tally-row">
                  <span className="combat-tally-row-label">
                    {p.nameZh}
                    {p.titleZh ? <span className="status-meta"> · {p.titleZh}</span> : null}
                  </span>
                  <span className="combat-tally-row-value">给养 {Math.round(p.provision)}</span>
                </div>
                <PrisonerVerbRow prisoner={p} />
              </div>
            ))
          )}
        </section>
        {clockMode === 'combat' && (
          <section className="status-section">
            <h3>战术指令 · 回收艇</h3>
            {strandedList.length === 0 ? (
              <div className="status-meta">无搁浅 MS · 暂无回收任务。</div>
            ) : (
              strandedList.map((s) => (
                <div key={s.key} className="combat-tally-row">
                  <span className="combat-tally-row-label">{s.name} · 推进剂耗尽</span>
                  <button
                    className="dialog-option"
                    style={{ padding: '2px 10px', fontSize: '0.85em' }}
                    onClick={() => onDispatchTug(s.key)}
                  >
                    派遣回收艇
                  </button>
                </div>
              ))
            )}
            <div className="status-meta">
              派遣条件：船员 computers + mechanics 技能合计达标 · 占用一座机库门直至完成。
            </div>
          </section>
        )}
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={onClose}>关闭</button>
          </div>
        </section>
      </div>
    </div>
  )
}
