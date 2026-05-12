// Phase 6.2.C2 — fleet roster notebook surface. Opened from a button
// inside the captain's-office briefing panel (the diegetic home for
// fleet-tier admin); standalone modal that lists every owned ship + its
// state + captain + hangar location + current hull/armor.
//
// Phase 6.2.D — the roster's captain column reads the live
// `Ship.assignedCaptainId` (resolves to a Character name) and each row
// surfaces a 船员 button that swaps to a per-ship crew-detail view with
// move / fire / hire-from-idle actions. Move requires a destination
// ship with a vacancy; fire clears the assignment (drops the captain
// Effect on the ship's StatSheet) without refunding the signing fee.
// Hire-from-idle invokes the same systems/fleetCrew.manRestFromIdlePool
// helper the captain's-office talk verb uses.

import { useState } from 'react'
import {
  Ship, IsFlagshipMark, IsInActiveFleet, EntityKey, Building, Hangar, IsPlayer, Character,
  type HangarSlotClass,
} from '../ecs/traits'
import { fleetConfig } from '../config'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getShipClass } from '../data/ship-classes'
import { getPoi } from '../data/pois'
import { useUI } from './uiStore'
import { dialogueText } from '../data/dialogueText'
import { playUi } from '../audio/player'
import {
  findShipByKey, findNpcByKey, fireCaptain, fireCrewMember, moveCrewMember,
  manRestFromIdlePool, crewVacancyForShip, snapshotCrewRoster,
} from '../systems/fleetCrew'

interface RosterRow {
  entityKey: string
  templateId: string
  shipName: string
  isFlagship: boolean
  hangarLabel: string
  poiId: string
  hangarSlotClass: HangarSlotClass
  captainKey: string
  captainNameZh: string
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  inCombat: boolean
  crewCount: number
  crewMax: number
  // Phase 6.2.E1 — read-only mirrors of war-room state. The verb to
  // toggle these lives at the war-room plot table on the flagship
  // bridge; the roster only reflects.
  isInActiveFleet: boolean
  aggression: string
}

function collectRoster(): RosterRow[] {
  const out: RosterRow[] = []
  const shipWorld = getWorld('playerShipInterior')
  const hangarLabelByPoi = collectHangarLabelByPoi()
  for (const e of shipWorld.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    const cls = getShipClass(s.templateId)
    const poiId = s.dockedAtPoiId
    const poiName = poiId ? (getPoi(poiId)?.nameZh ?? poiId) : ''
    const hangarLabel = hangarLabelByPoi.get(poiId) ?? poiName
    const captainKey = s.assignedCaptainId
    const captainName = captainKey ? captainNameOf(captainKey) : ''
    out.push({
      entityKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
      hangarLabel,
      poiId,
      hangarSlotClass: cls.hangarSlotClass,
      captainKey,
      captainNameZh: captainName,
      hullCurrent: s.hullCurrent,
      hullMax: s.hullMax,
      armorCurrent: s.armorCurrent,
      armorMax: s.armorMax,
      inCombat: s.inCombat,
      crewCount: s.crewIds.length,
      crewMax: cls.crewMax,
      isInActiveFleet: e.has(IsInActiveFleet),
      aggression: s.aggression,
    })
  }
  return out
}

function captainNameOf(npcKey: string): string {
  const hit = findNpcByKey(npcKey)
  if (!hit) return npcKey
  return hit.entity.get(Character)?.name ?? npcKey
}

function collectHangarLabelByPoi(): Map<string, string> {
  const out = new Map<string, string>()
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar)) {
      const label = b.get(Building)?.label ?? ''
      const poi = poiIdForScene(sceneId)
      if (poi && label) out.set(poi, label)
    }
  }
  return out
}

function poiIdForScene(sceneId: string): string | null {
  if (sceneId === 'vonBraunCity') return 'vonBraun'
  if (sceneId === 'granadaDrydock') return 'granada'
  return null
}

export function FleetRosterPanel() {
  const open = useUI((s) => s.fleetRosterOpen)
  const setOpen = useUI((s) => s.setFleetRoster)
  // Tick state lets crew-row actions force a re-render of the roster
  // without remounting the modal.
  const [tick, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)
  // Per-ship crew-detail view; null = roster list.
  const [crewDrillShipKey, setCrewDrillShipKey] = useState<string | null>(null)

  if (!open) return null

  const t = dialogueText.branches.fleetRoster
  const rows = collectRoster()
  void tick

  const close = () => {
    playUi('ui.npc.close')
    setOpen(false)
    setCrewDrillShipKey(null)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()} data-fleet-roster>
        <header className="status-header">
          <h2>{t.title}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        {crewDrillShipKey === null ? (
          <RosterList rows={rows} onCrewClick={(k) => setCrewDrillShipKey(k)} onMutate={bump} />
        ) : (
          <CrewDetailPanel
            shipKey={crewDrillShipKey}
            allShips={rows}
            onBack={() => { setCrewDrillShipKey(null); bump() }}
            onMutate={bump}
          />
        )}
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={close}>{dialogueText.buttons.back}</button>
          </div>
        </section>
      </div>
    </div>
  )
}

function RosterList({
  rows, onCrewClick, onMutate,
}: { rows: RosterRow[]; onCrewClick: (shipKey: string) => void; onMutate: () => void }) {
  const t = dialogueText.branches.fleetRoster
  const showToast = useUI((s) => s.showToast)
  void onMutate
  return (
    <section className="status-section">
      {rows.length === 0 ? (
        <p className="hr-intro">{t.empty}</p>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          {rows.map((r) => (
            <li
              key={r.entityKey}
              className="dev-row"
              data-roster-row={r.entityKey}
              style={{ flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}
            >
              <span className="dev-key" style={{ minWidth: 0, flex: '1 0 12em' }}>
                {r.shipName}
                {r.isFlagship && (
                  <span data-roster-flagship style={{ marginLeft: 4, opacity: 0.7 }}>
                    · {t.flagshipBadge}
                  </span>
                )}
              </span>
              <span data-roster-hangar style={{ flex: '1 0 8em' }}>
                {t.colHangar}: {r.hangarLabel || t.captainEmpty}
              </span>
              <span data-roster-captain style={{ flex: '1 0 6em' }}>
                {t.colCaptain}: {r.captainNameZh || t.captainEmpty}
              </span>
              <span data-roster-crew style={{ flex: '0 0 auto' }}>
                {t.crewMemberLabel}: {r.crewCount} / {r.crewMax}
              </span>
              <span data-roster-state style={{ flex: '0 0 auto' }}>
                {r.inCombat ? t.stateActive : t.stateInPort}
              </span>
              <span data-roster-active-fleet={r.isInActiveFleet ? '1' : '0'} style={{ flex: '0 0 auto' }}>
                {dialogueText.branches.warRoom.rosterStateLabel}: {r.isInActiveFleet
                  ? dialogueText.branches.warRoom.stateActive
                  : dialogueText.branches.warRoom.stateReserve}
              </span>
              <span data-roster-aggression={r.aggression} style={{ flex: '0 0 auto' }}>
                {dialogueText.branches.warRoom.rosterAggressionLabel}: {
                  fleetConfig.aggressionLevels.find((a) => a.id === r.aggression)?.labelZh ?? r.aggression
                }
              </span>
              <span data-roster-hull style={{ flex: '0 0 auto' }}>
                {t.colHull} {Math.round(r.hullCurrent)} / {r.hullMax}
              </span>
              <span data-roster-armor style={{ flex: '0 0 auto' }}>
                {t.colArmor} {Math.round(r.armorCurrent)} / {r.armorMax}
              </span>
              <span style={{ display: 'inline-flex', gap: '0.25em' }}>
                <button
                  className="dialog-option"
                  data-roster-crew-open={r.entityKey}
                  onClick={() => onCrewClick(r.entityKey)}
                >
                  {t.crewButton}
                </button>
                <button
                  className="dialog-option"
                  data-roster-mothball={r.entityKey}
                  onClick={() => showToast(t.mothballStubToast)}
                >
                  {t.mothballButton}
                </button>
                <button
                  className="dialog-option"
                  data-roster-scrap={r.entityKey}
                  onClick={() => showToast(t.scrapStubToast)}
                >
                  {t.scrapButton}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CrewDetailPanel({
  shipKey, allShips, onBack, onMutate,
}: {
  shipKey: string
  allShips: RosterRow[]
  onBack: () => void
  onMutate: () => void
}) {
  const t = dialogueText.branches.fleetRoster
  const showToast = useUI((s) => s.showToast)
  const ship = findShipByKey(shipKey)
  if (!ship) {
    return (
      <section className="status-section">
        <p className="hr-intro">{t.empty}</p>
        <button className="dialog-option" onClick={onBack}>{t.crewBackButton}</button>
      </section>
    )
  }
  const roster = snapshotCrewRoster().find((r) => r.shipKey === shipKey)
  if (!roster) {
    return (
      <section className="status-section">
        <p className="hr-intro">{t.empty}</p>
        <button className="dialog-option" onClick={onBack}>{t.crewBackButton}</button>
      </section>
    )
  }
  const otherShips = allShips.filter((s) => s.entityKey !== shipKey)
  const vacancy = crewVacancyForShip(ship)

  const onFireCaptain = () => {
    if (!fireCaptain(ship)) return
    playUi('ui.npc.close')
    showToast(t.crewToastFireCaptain.replace('{name}', roster.captainName || t.captainEmpty))
    onMutate()
  }

  const onFireCrew = (npcKey: string, name: string) => {
    if (!fireCrewMember(ship, npcKey)) return
    playUi('ui.npc.close')
    showToast(t.crewToastFired.replace('{name}', name || npcKey))
    onMutate()
  }

  const onMoveCrew = (npcKey: string, destKey: string, destName: string, name: string) => {
    const dest = findShipByKey(destKey)
    if (!dest) {
      showToast(t.crewToastMoveFailed.replace('{reason}', 'no_dest'))
      return
    }
    const r = moveCrewMember(ship, dest, npcKey)
    if (!r.ok) {
      showToast(t.crewToastMoveFailed.replace('{reason}', r.reason))
      return
    }
    playUi('ui.hr.accept')
    showToast(t.crewToastMoved.replace('{name}', name || npcKey).replace('{ship}', destName))
    onMutate()
  }

  const onHireFromIdle = () => {
    let player = null
    for (const sceneId of SCENE_IDS) {
      const w = getWorld(sceneId)
      const p = w.queryFirst(IsPlayer)
      if (p) { player = p; break }
    }
    if (!player) {
      showToast(t.crewHireFromIdleEmpty)
      return
    }
    const res = manRestFromIdlePool(player, ship)
    playUi(res.hired > 0 ? 'ui.hr.accept' : 'ui.npc.close')
    if (res.hired === 0) {
      if (res.stoppedReason === 'no_idle') showToast(t.crewHireFromIdleEmpty)
      else showToast(
        t.crewToastHireNoFunds.replace('{n}', String(res.hired)).replace('{cost}', String(res.signingFeesPaid)),
      )
    } else {
      showToast(
        t.crewToastHired.replace('{n}', String(res.hired)).replace('{cost}', String(res.signingFeesPaid)),
      )
    }
    onMutate()
  }

  return (
    <section className="status-section" data-crew-detail={shipKey}>
      <h3>{roster.shipName} · {t.crewSectionTitle}</h3>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        <li className="dev-row" data-crew-captain-row={roster.captainKey || ''}>
          <span className="dev-key">{t.crewCaptainLabel}</span>
          <span>{roster.captainName || t.captainEmpty}</span>
          {roster.captainKey && (
            <button
              className="dialog-option"
              data-crew-fire-captain={roster.captainKey}
              onClick={onFireCaptain}
            >
              {t.crewFireLabel}
            </button>
          )}
        </li>
        {roster.crew.length === 0 ? (
          <li className="dev-row"><span className="hr-intro">{t.crewEmpty}</span></li>
        ) : (
          roster.crew.map((c) => (
            <li key={c.npcKey} className="dev-row" data-crew-row={c.npcKey}>
              <span className="dev-key">{t.crewMemberLabel}</span>
              <span>{c.name || c.npcKey}</span>
              <button
                className="dialog-option"
                data-crew-fire={c.npcKey}
                onClick={() => onFireCrew(c.npcKey, c.name)}
              >
                {t.crewFireLabel}
              </button>
              {otherShips.length > 0 && otherShips.map((dest) => (
                <button
                  key={dest.entityKey}
                  className="dialog-option"
                  data-crew-move={`${c.npcKey}->${dest.entityKey}`}
                  disabled={dest.crewCount >= dest.crewMax}
                  onClick={() => onMoveCrew(c.npcKey, dest.entityKey, dest.shipName, c.name)}
                >
                  {t.crewMoveTo} {dest.shipName}
                </button>
              ))}
            </li>
          ))
        )}
        <li className="dev-row" data-crew-vacancy={vacancy}>
          <span className="dev-key">{t.crewVacancyLabel}</span>
          <span>{vacancy} / {roster.crewMax}</span>
          <button
            className="dialog-option"
            data-crew-hire-from-idle={shipKey}
            disabled={vacancy <= 0}
            onClick={onHireFromIdle}
          >
            {t.crewHireFromIdleLabel}
          </button>
        </li>
      </ul>
      <button className="dialog-option" data-crew-back="1" onClick={onBack}>
        {t.crewBackButton}
      </button>
    </section>
  )
}
