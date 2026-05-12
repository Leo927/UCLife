// Phase 6.2.C2 — fleet roster notebook surface. Opened from a button
// inside the captain's-office briefing panel (the diegetic home for
// fleet-tier admin); standalone modal that lists every owned ship + its
// state + captain + hangar location + current hull/armor. Read-mostly:
// the only writeable verbs at 6.2.C2 are mothball / scrap stubs that
// toast a "TBD" message — real wiring lands at 6.2.G (mothball) and
// later phases (scrap). Each ship row reads off the Ship trait + its
// templateId (for the display name) + the dockedAtPoiId (to resolve
// the hangar's player-facing label, walked from Building entities in
// every scene world).
//
// The roster does not subscribe via useQuery on every scene world (the
// React layer's useQuery is scoped to the active world proxy). Instead
// we snapshot ship + hangar state on each render — fleet entity count
// stays in the dozens even at full 6.2 scope, so the O(N) walk lands
// well inside the frame budget for a modal that re-renders only when
// the player opens it.

import { useState } from 'react'
import {
  Ship, IsFlagshipMark, EntityKey, Building, Hangar, type HangarSlotClass,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getShipClass } from '../data/ship-classes'
import { getPoi } from '../data/pois'
import { useUI } from './uiStore'
import { dialogueText } from '../data/dialogueText'
import { playUi } from '../audio/player'

interface RosterRow {
  entityKey: string
  templateId: string
  shipName: string
  isFlagship: boolean
  hangarLabel: string
  poiId: string
  hangarSlotClass: HangarSlotClass
  captainNameZh: string
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  inCombat: boolean
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
    out.push({
      entityKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
      hangarLabel,
      poiId,
      hangarSlotClass: cls.hangarSlotClass,
      // 6.2.D wires captain assignments; render placeholder until then.
      captainNameZh: '',
      hullCurrent: s.hullCurrent,
      hullMax: s.hullMax,
      armorCurrent: s.armorCurrent,
      armorMax: s.armorMax,
      inCombat: s.inCombat,
    })
  }
  return out
}

function collectHangarLabelByPoi(): Map<string, string> {
  const out = new Map<string, string>()
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar)) {
      const label = b.get(Building)?.label ?? ''
      // Mirror poiIdForHangarScene's mapping (POIS.sceneId === sceneId).
      const poi = poiIdForScene(sceneId)
      if (poi && label) out.set(poi, label)
    }
  }
  return out
}

function poiIdForScene(sceneId: string): string | null {
  // Local copy of systems/shipDelivery.poiIdForHangarScene that doesn't
  // round-trip through that systems module. ui/ → systems/ direction is
  // already established (other panels import describeHangarRepair); we
  // keep this resolver local to keep the import graph narrow.
  if (sceneId === 'vonBraunCity') return 'vonBraun'
  if (sceneId === 'granadaDrydock') return 'granada'
  return null
}

export function FleetRosterPanel() {
  const open = useUI((s) => s.fleetRosterOpen)
  const setOpen = useUI((s) => s.setFleetRoster)
  const showToast = useUI((s) => s.showToast)
  // Local bump counter so save/load + receive-delivery in another panel
  // refresh the modal on its next render after re-open. The roster is
  // read-only mid-modal; no live subscription needed.
  const [, setTick] = useState(0)
  void setTick

  if (!open) return null

  const t = dialogueText.branches.fleetRoster
  const rows = collectRoster()

  const close = () => {
    playUi('ui.npc.close')
    setOpen(false)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()} data-fleet-roster>
        <header className="status-header">
          <h2>{t.title}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
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
                  <span data-roster-state style={{ flex: '0 0 auto' }}>
                    {r.inCombat ? t.stateActive : t.stateInPort}
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
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={close}>{dialogueText.buttons.back}</button>
          </div>
        </section>
      </div>
    </div>
  )
}
