// Phase 6.2.C2 fleet debug handles. Smoke-test surface for the Pegasus
// buy + fleet-roster screen:
//
//   shipSalesRepEntity(specId)  — locate the seated AE sales rep so the
//                                  smoke can drive setDialogNPC + assert
//                                  the role flag without DOM hunting.
//   fleetRosterSnapshot()       — read-only mirror of FleetRosterPanel's
//                                  derivation: every Ship across every
//                                  scene world, with display name, hangar
//                                  label, captain (placeholder until
//                                  6.2.D), and damage state.
//   setFleetRosterOpen(open)    — toggles the roster modal so smoke can
//                                  assert it renders without driving the
//                                  walkable captain's-desk verb.
//   forceShipDocking(key, poi)  — re-points a Ship's dockedAtPoiId so the
//                                  no-slot path can be tested by faking
//                                  drydock capital occupancy.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import {
  Workstation, Position, Building, Hangar, EntityKey, Ship, IsFlagshipMark,
} from '../../ecs/traits'
import { useUI } from '../../ui/uiStore'
import { getShipClass } from '../../data/ship-classes'
import { getPoi } from '../../data/pois'
import { poiIdForHangarScene } from '../../systems/shipDelivery'

// Resolve the seated AE sales rep NPC by workstation specId across every
// scene world. Returns null when the spec is unmanned or absent. Used by
// the smoke's setDialogNPC(rep) drive.
registerDebugHandle('shipSalesRepEntity', (specId: string) => {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const ws of w.query(Workstation, Position)) {
      const data = ws.get(Workstation)!
      if (data.specId !== specId) continue
      return data.occupant ?? null
    }
  }
  return null
})

interface FleetRosterRow {
  entityKey: string
  templateId: string
  shipName: string
  isFlagship: boolean
  poiId: string
  hangarLabel: string
  hangarSlotClass: string
  captainKey: string
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  inCombat: boolean
}

registerDebugHandle('fleetRosterSnapshot', (): FleetRosterRow[] => {
  // Build a poi → hangar-label index up front; fleet entity count stays
  // in the dozens at full 6.2 scope so the nested walk is cheap.
  const hangarLabelByPoi = new Map<string, string>()
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar)) {
      const label = b.get(Building)?.label ?? ''
      const poi = poiIdForHangarScene(sceneId)
      if (poi && label) hangarLabelByPoi.set(poi, label)
    }
  }

  const out: FleetRosterRow[] = []
  const shipWorld = getWorld('playerShipInterior')
  for (const e of shipWorld.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    const cls = getShipClass(s.templateId)
    const poiName = s.dockedAtPoiId ? (getPoi(s.dockedAtPoiId)?.nameZh ?? s.dockedAtPoiId) : ''
    const hangarLabel = hangarLabelByPoi.get(s.dockedAtPoiId) ?? poiName
    out.push({
      entityKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
      poiId: s.dockedAtPoiId,
      hangarLabel,
      hangarSlotClass: cls.hangarSlotClass,
      captainKey: '',
      hullCurrent: s.hullCurrent,
      hullMax: s.hullMax,
      armorCurrent: s.armorCurrent,
      armorMax: s.armorMax,
      inCombat: s.inCombat,
    })
  }
  return out
})

registerDebugHandle('setFleetRosterOpen', (open: boolean) => {
  useUI.getState().setFleetRoster(open)
  return useUI.getState().fleetRosterOpen
})

// Re-point a Ship's dockedAtPoiId. Smoke uses this to occupy capital
// slots at granada without going through an actual buy/deliver flow,
// so the no-slot gate path is exercisable end-to-end.
registerDebugHandle('forceShipDocking', (entityKey: string, poiId: string) => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== entityKey) continue
    const s = e.get(Ship)!
    e.set(Ship, { ...s, dockedAtPoiId: poiId })
    return e.get(Ship)!.dockedAtPoiId
  }
  return null
})
