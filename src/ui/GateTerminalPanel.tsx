// Hangar gate terminal — opened by walking onto a gateTerminal
// Interactable in the drydock. Three tabs scoped to the bound ship:
//   • 状态 — hull/armor/flux readout (mirrors the captain's-office briefing)
//   • 船员 — captain + crew list with vacancy badge
//   • 改名 — rename the ship; updates Ship.name, sign re-renders next frame
//
// The "undock" verb is intentionally absent — boarding the ship via the
// gate's board portal is the existing undock path; the terminal is the
// remote-management surface only.

import { useState, useEffect } from 'react'
import { useTrait } from 'koota/react'
import type { TraitInstance } from 'koota'
import { Ship, Owner, EntityKey } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { useUI } from './uiStore'
import { getWorld } from '../ecs/world'
import { playUi } from '../audio/player'
import { shipOwnerLabel } from '../systems/shipMarkers'

const SHIP_SCENE_ID = 'playerShipInterior'

type Tab = 'status' | 'crew' | 'rename'

function findShipEnt(shipKey: string) {
  if (!shipKey) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

export function GateTerminalPanel() {
  const gate = useUI((s) => s.gateTerminal)
  const close = () => {
    playUi('ui.npc.close')
    useUI.getState().openGateTerminal(null)
  }
  const [tab, setTab] = useState<Tab>('status')

  const shipEnt = gate ? findShipEnt(gate.shipKey) : null
  const ship = useTrait(shipEnt ?? null, Ship)
  void useTrait(shipEnt ?? null, Owner)

  useEffect(() => {
    if (gate) setTab('status')
  }, [gate?.gateNumber, gate?.shipKey])

  if (!gate) return null
  if (!shipEnt || !ship) {
    return (
      <div className="status-overlay" onClick={close}>
        <div className="status-panel" onClick={(e) => e.stopPropagation()}>
          <header className="status-header">
            <h2>{gate.gateNumber} · 终端</h2>
            <button className="status-close" onClick={close} aria-label="关闭">✕</button>
          </header>
          <section className="status-section">
            <p className="dialog-response">这处泊位没有舰艇。</p>
          </section>
        </div>
      </div>
    )
  }

  const cls = getShipClass(ship.templateId)
  const ownerLabel = shipOwnerLabel(shipEnt)

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{gate.gateNumber} · {ship.name}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="status-meta">{cls.nameZh} · {ownerLabel}</div>
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button
              className={`dialog-option${tab === 'status' ? ' active' : ''}`}
              onClick={() => setTab('status')}
              data-gate-tab="status"
            >状态</button>
            <button
              className={`dialog-option${tab === 'crew' ? ' active' : ''}`}
              onClick={() => setTab('crew')}
              data-gate-tab="crew"
            >船员</button>
            <button
              className={`dialog-option${tab === 'rename' ? ' active' : ''}`}
              onClick={() => setTab('rename')}
              data-gate-tab="rename"
            >改名</button>
          </div>
        </section>
        {tab === 'status' && <StatusTab ship={ship} />}
        {tab === 'crew' && <CrewTab ship={ship} />}
        {tab === 'rename' && (
          <RenameTab
            shipEnt={shipEnt}
            currentName={ship.name}
            onDone={() => setTab('status')}
          />
        )}
      </div>
    </div>
  )
}

function StatusTab({ ship }: { ship: TraitInstance<typeof Ship> }) {
  return (
    <section className="status-section">
      <ReadinessBar label="船体"   current={ship.hullCurrent}   max={ship.hullMax}   color="#4ade80" />
      <ReadinessBar label="装甲"   current={ship.armorCurrent}  max={ship.armorMax}  color="#a3a3a3" />
      <ReadinessBar label="电荷"   current={ship.fluxCurrent}   max={ship.fluxMax}   color="#3b82f6" reverse />
      <ReadinessBar label="战备"   current={ship.crCurrent}     max={ship.crMax}     color="#f59e0b" />
      <ReadinessBar label="燃料"   current={ship.fuelCurrent}   max={ship.fuelMax}   color="#60a5fa" />
      <ReadinessBar label="物资"   current={ship.suppliesCurrent} max={ship.suppliesMax} color="#34d399" />
    </section>
  )
}

function CrewTab({ ship }: { ship: TraitInstance<typeof Ship> }) {
  const captainText = ship.assignedCaptainId ? `已就任 · ${ship.assignedCaptainId}` : '空缺'
  return (
    <section className="status-section">
      <h3>船长</h3>
      <p className="dialog-response">{captainText}</p>
      <h3>船员</h3>
      <p className="dialog-response">在岗 {ship.crewIds.length} 人</p>
    </section>
  )
}

function RenameTab({
  shipEnt, currentName, onDone,
}: {
  shipEnt: ReturnType<typeof findShipEnt>
  currentName: string
  onDone: () => void
}) {
  const [value, setValue] = useState(currentName)
  const showToast = useUI((s) => s.showToast)
  const apply = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      showToast('名称不能为空')
      return
    }
    if (!shipEnt) return
    const cur = shipEnt.get(Ship)
    if (!cur) return
    shipEnt.set(Ship, { ...cur, name: trimmed })
    playUi('ui.factory-manager.accept')
    showToast(`已改名 · ${trimmed}`)
    onDone()
  }
  return (
    <section className="status-section">
      <h3>改名</h3>
      <input
        className="rename-input"
        data-gate-rename-input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={32}
      />
      <div className="dialog-options">
        <button className="dialog-option" data-gate-rename-apply onClick={apply}>保存</button>
        <button className="dialog-option" onClick={onDone}>取消</button>
      </div>
    </section>
  )
}

function ReadinessBar(props: {
  label: string
  current: number
  max: number
  color: string
  reverse?: boolean
}) {
  const { label, current, max, color, reverse } = props
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0
  const fillPct = reverse ? 100 - pct : pct
  return (
    <div className="captain-readiness">
      <div className="captain-readiness-row">
        <span className="captain-readiness-label">{label}</span>
        <span className="captain-readiness-value">{Math.round(current)} / {Math.round(max)}</span>
      </div>
      <div className="captain-readiness-track">
        <div
          className="captain-readiness-fill"
          style={{ width: `${fillPct}%`, background: color }}
        />
      </div>
    </div>
  )
}
