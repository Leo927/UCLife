// Phase 6.0 captain's office — pre-launch readiness summary.
// Opened by walking onto the 'captainsDesk' interactable in the
// captain's-office room. Reads the flagship's Ship trait directly;
// closes back to the walkable scene without committing to any action.
//
// Phase 6.2+ will extend this panel to host the comm panel (officer
// orders, prisoner verbs); today it's a read-only briefing.

import { useTrait, useQueryFirst, useQuery } from 'koota/react'
import { Ship, IsFlagshipMark, IsPlayer, FleetPool, Ms, EntityKey } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { getPoi } from '../data/pois'
import { useUI } from './uiStore'
import { useScene } from '../sim/scene'
import { playUi } from '../audio/player'
import { dialogueText } from '../data/dialogueText'
import {
  crewVacancyForShip, manRestFromFactionPool,
} from '../systems/fleetCrew'
import { getWorld, SCENE_IDS } from '../ecs/world'

const SHIP_SCENE_ID = 'playerShipInterior'

export function CaptainsOfficePanel() {
  const open = useUI((s) => s.captainsOfficeOpen)
  const close = useUI((s) => s.setCaptainsOffice)
  const activeId = useScene((s) => s.activeId)
  // Subscribe to the Ship trait so a re-render fires when hull / supplies
  // change after we've opened the panel (e.g. autosave + reload).
  const shipEnt = useQueryFirst(Ship, IsFlagshipMark)
  const ship = useTrait(shipEnt, Ship)
  // Fleet fuel — Starsector-style shared pool, not per-ship.
  const fleetPoolEnt = useQueryFirst(FleetPool)
  const fleetPool = useTrait(fleetPoolEnt, FleetPool)

  if (!open) return null
  if (activeId !== SHIP_SCENE_ID || !ship) return null

  const cls = getShipClass(ship.templateId)
  const poi = ship.dockedAtPoiId ? getPoi(ship.dockedAtPoiId) : undefined
  const dockState = ship.inCombat
    ? '战斗中'
    : poi
      ? `停泊 · ${poi.nameZh}`
      : '在轨自由航行'

  const onClose = () => {
    playUi('ui.npc.close')
    close(false)
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>船长简报 · {cls.nameZh}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="status-meta">{dockState}</div>
        </section>
        <section className="status-section">
          <h3>战斗状态</h3>
          <ReadinessBar label="船体" current={ship.hullCurrent} max={ship.hullMax} color="#4ade80" />
          <ReadinessBar label="装甲" current={ship.armorCurrent} max={ship.armorMax} color="#a3a3a3" />
          <ReadinessBar label="电荷" current={ship.fluxCurrent} max={ship.fluxMax} color="#3b82f6" reverse />
          <ReadinessBar label="战备" current={ship.crCurrent} max={ship.crMax} color="#f59e0b" />
        </section>
        <section className="status-section">
          <h3>补给</h3>
          <ReadinessBar
            label="燃料"
            current={fleetPool?.fuelCurrent ?? 0}
            max={fleetPool?.fuelMax ?? 0}
            color="#60a5fa"
          />
          <ReadinessBar
            label="物资"
            current={fleetPool?.supplyCurrent ?? 0}
            max={fleetPool?.supplyMax ?? 0}
            color="#34d399"
          />
        </section>
        <ReadinessSection shipEnt={shipEnt} />
        <ManTheRestSection shipEnt={shipEnt} />
        <section className="status-section">
          <div className="dialog-options">
            <button
              className="dialog-option"
              data-fleet-roster-open
              onClick={() => {
                playUi('ui.npc.open')
                useUI.getState().setFleetRoster(true)
              }}
            >
              {dialogueText.branches.fleetRoster.openButton}
            </button>
            <button
              className="dialog-option"
              data-pilot-roster-open
              onClick={() => {
                playUi('ui.npc.open')
                useUI.getState().setPilotRoster(true)
              }}
            >
              {dialogueText.branches.pilotRoster.openButton}
            </button>
            <button className="dialog-option" onClick={onClose}>关闭</button>
          </div>
        </section>
      </div>
    </div>
  )
}

// W4.4 — advisory readiness rows. Purely informational; takeHelm() stays
// ungated (the player may sortie undercrewed / unpiloted). Crew filled reads
// via crewVacancyForShip; MS loaded counts aboard hangar bodies; pilots
// assigned is the aboard-MS subset carrying a pilotId. Deliberately does NOT
// use the combat-gated countLaunchableWings().
function ReadinessSection({ shipEnt }: { shipEnt: ReturnType<typeof useQueryFirst> | null }) {
  const t = dialogueText.branches.captainsOfficeReadiness
  // Subscribe to MS add/remove + Ship value changes so custody / crew edits
  // ripple into the counts while the panel is open.
  const msEnts = useQuery(Ms)
  void useTrait(shipEnt, Ship)
  if (!shipEnt) return null
  const s = shipEnt.get(Ship)
  if (!s) return null
  const flagshipKey = shipEnt.get(EntityKey)?.key ?? ''

  const vacancy = crewVacancyForShip(shipEnt)
  const crewFilled = s.crewIds.length
  const crewRequired = crewFilled + vacancy
  const crewReady = vacancy <= 0

  let msLoaded = 0
  let pilotsAssigned = 0
  for (const ent of msEnts) {
    const m = ent.get(Ms)
    if (!m || m.storedOnShipKey !== flagshipKey) continue
    msLoaded += 1
    if (m.pilotId !== '') pilotsAssigned += 1
  }
  const msReady = msLoaded > 0
  const pilotsReady = pilotsAssigned > 0

  return (
    <section
      className="status-section"
      data-captains-office-readiness
      data-crew-filled={crewFilled}
      data-crew-required={crewRequired}
      data-crew-ready={crewReady}
      data-ms-loaded={msLoaded}
      data-ms-ready={msReady}
      data-pilots-assigned={pilotsAssigned}
      data-pilots-ready={pilotsReady}
    >
      <h3>{t.header}</h3>
      <ReadinessRow label={t.crewLabel} detail={`${crewFilled} / ${crewRequired}`} ready={crewReady} />
      <ReadinessRow label={t.msLabel} detail={`${msLoaded}`} ready={msReady} />
      <ReadinessRow label={t.pilotLabel} detail={`${pilotsAssigned} / ${msLoaded}`} ready={pilotsReady} />
    </section>
  )
}

function ReadinessRow({ label, detail, ready }: { label: string; detail: string; ready: boolean }) {
  const t = dialogueText.branches.captainsOfficeReadiness
  return (
    <div className="captain-readiness-status-row">
      <span className="captain-readiness-label">{label}</span>
      <span className="captain-readiness-value">{detail}</span>
      <span className={ready ? 'readiness-chip readiness-chip-ok' : 'readiness-chip readiness-chip-bad'}>
        {ready ? t.ready : t.notReady}
      </span>
    </div>
  )
}

function ManTheRestSection({ shipEnt }: { shipEnt: ReturnType<typeof useQueryFirst> | null }) {
  // Subscribe to the Ship trait so crew changes ripple to the button
  // labels (vacancy / "船员已满").
  void useTrait(shipEnt, Ship)
  const t = dialogueText.branches.captainsOfficeManRest
  const showToast = useUI((s) => s.showToast)
  if (!shipEnt) return null
  const s = shipEnt.get(Ship)
  if (!s) return null
  const vacancy = crewVacancyForShip(shipEnt)
  const hasCaptain = s.assignedCaptainId !== ''

  let label = t.buttonIdle
  let disabled = false
  if (!hasCaptain) { label = t.buttonNoCaptain; disabled = true }
  else if (vacancy <= 0) { label = t.buttonNoVacancy; disabled = true }

  const onMan = () => {
    let player = null
    for (const sceneId of SCENE_IDS) {
      const p = getWorld(sceneId).queryFirst(IsPlayer)
      if (p) { player = p; break }
    }
    if (!player) {
      showToast(t.toastNoIdle)
      return
    }
    const res = manRestFromFactionPool(player, shipEnt)
    playUi(res.hired > 0 ? 'ui.hr.accept' : 'ui.npc.close')
    if (res.hired === 0) {
      if (res.stoppedReason === 'no_idle') showToast(t.toastNoIdle)
      else showToast(t.toastNoFunds.replace('{n}', String(res.hired)))
      return
    }
    if (res.stoppedReason === 'no_funds') {
      showToast(t.toastNoFunds.replace('{n}', String(res.hired)))
    } else if (res.stoppedReason === 'cap') {
      showToast(t.toastCap.replace('{n}', String(res.hired)))
    } else {
      showToast(t.toastFilled.replace('{n}', String(res.hired)))
    }
  }

  return (
    <section className="status-section">
      <h3>船员补员</h3>
      <button
        className="dialog-option"
        data-captains-office-man-rest="1"
        disabled={disabled}
        onClick={onMan}
      >
        {label}
      </button>
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
