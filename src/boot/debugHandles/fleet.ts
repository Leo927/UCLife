// Phase 6.2.C2 fleet debug handles. Smoke-test surface for the Pegasus
// buy + fleet-roster screen:
//
//   shipSalesRepEntity(specId)  — locate the seated AE sales rep so the
//                                  smoke can drive setDialogNPC + assert
//                                  the role flag without DOM hunting.
//   fleetRosterSnapshot()       — read-only mirror of FleetRosterPanel's
//                                  derivation: every Ship across every
//                                  scene world, with display name, hangar
//                                  label, captain, crew count, damage.
//   setFleetRosterOpen(open)    — toggles the roster modal so smoke can
//                                  assert it renders without driving the
//                                  walkable captain's-desk verb.
//   forceShipDocking(key, poi)  — re-points a Ship's dockedAtPoiId so the
//                                  no-slot path can be tested by faking
//                                  drydock capital occupancy.
//
// Phase 6.2.D additions:
//   hireBranchListing(npcKey)   — returns which hire branches surface on
//                                  an NPC's dialog tree (a smoke-friendly
//                                  mirror of buildNpcDialogue).
//   spawnTestNpc(opts)          — deterministic NPC spawn in a chosen
//                                  scene, useful when the smoke needs an
//                                  idle hireable NPC with a known key.
//   hireCaptainViaDebug         — drives systems/fleetCrew.hireAsCaptain
//                                  by entity key (smoke skips DOM).
//   hireCrewViaDebug            — same for hireAsCrew.
//   fireCaptainViaDebug         — drives systems/fleetCrew.fireCaptain.
//   fireCrewMemberViaDebug      — same for fireCrewMember.
//   moveCrewMemberViaDebug      — same for moveCrewMember.
//   manRestFromIdleViaDebug     — captain's-office "man the rest" verb.
//   crewRosterSnapshot          — per-ship crew/captain snapshot for
//                                  the move/fire assertions.
//   shipStatSheetTopSpeed(key)  — read the post-Effect topSpeed off the
//                                  ship's stat sheet (captain effect
//                                  assertion).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import {
  Workstation, Position, Building, Hangar, EntityKey, Ship, IsFlagshipMark,
  Character, IsPlayer, ShipStatSheet, ShipEffectsList, IsInActiveFleet,
  CombatShipState, FleetEscort,
} from '../../ecs/traits'
import { useUI } from '../../ui/uiStore'
import { getShipClass } from '../../data/ship-classes'
import { getPoi } from '../../data/pois'
import { poiIdForHangarScene } from '../../systems/shipDelivery'
import {
  findNpcByKey, findShipByKey, hireAsCaptain, hireAsCrew, fireCaptain,
  fireCrewMember, moveCrewMember, manRestFromIdlePool, snapshotCrewRoster,
  captainEffectId, fleetCrewSalarySystem,
} from '../../systems/fleetCrew'
import { setShipMothballedByKey } from '../../systems/fleetMothball'
import {
  enqueueHangarTransfer, listTransferDestinations,
} from '../../systems/fleetTransfer'
import { fleetSupplyDrainSystem } from '../../systems/fleetSupplyDrain'
import {
  warRoomDescribe, setIsInActiveFleet, setFormationSlot, setAggression,
} from '../../systems/fleetWarRoom'
import {
  fleetTransitSystem, listShipsInTransit, enqueueShipTransit,
  partitionActiveFleetEscorts,
} from '../../systems/fleetTransit'
import { onFlagshipUndock, onFlagshipDock } from '../../systems/fleetLaunch'
import { formationOffsetForSlot } from '../../systems/fleetFormation'
import { spawnNPC } from '../../character/spawn'
import { pickRandomColor } from '../../character/nameGen'
import { buildNpcDialogue } from '../../ui/dialogue/builder'
import type { DialogueCtx } from '../../ui/dialogue/types'
import { getStat } from '../../stats/sheet'

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
  captainName: string
  crewIds: string[]
  crewCount: number
  crewMax: number
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
    const captainName = s.assignedCaptainId
      ? (findNpcByKey(s.assignedCaptainId)?.entity.get(Character)?.name ?? '')
      : ''
    out.push({
      entityKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
      poiId: s.dockedAtPoiId,
      hangarLabel,
      hangarSlotClass: cls.hangarSlotClass,
      captainKey: s.assignedCaptainId,
      captainName,
      crewIds: [...s.crewIds],
      crewCount: s.crewIds.length,
      crewMax: cls.crewMax,
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

// ── Phase 6.2.D — hire / crew / officer-effect debug handles ───────────

// Spawn a deterministic test NPC in the named scene with a chosen key.
// Bypasses procgen's random `npc-anon-xxx` keys so the smoke can
// reference the same entity across save/load without first walking
// through the immigrant pipeline. Defaults to `vonBraunCity`.
registerDebugHandle('spawnTestNpc', (opts: {
  key: string
  name?: string
  sceneId?: string
  x?: number
  y?: number
}) => {
  const sceneId = opts.sceneId ?? 'vonBraunCity'
  const w = getWorld(sceneId)
  const npc = spawnNPC(w, {
    name: opts.name ?? opts.key,
    color: pickRandomColor(),
    title: '市民',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    key: opts.key,
  })
  return npc.get(EntityKey)!.key
})

// Build the dialogue tree for a given NPC entity and return the labels
// of its top-level branches. Smoke uses this to assert hire branches
// surface (or not) without rendering React.
registerDebugHandle('hireBranchListing', (npcKey: string): string[] => {
  const hit = findNpcByKey(npcKey)
  if (!hit) return []
  const ctx: DialogueCtx = {
    npc: hit.entity,
    title: hit.entity.get(Character)?.title ?? '市民',
    employed: false,
    roles: {
      onShift: false,
      isCashierOnDuty: false,
      isHROnDuty: false,
      isRealtorOnDuty: false,
      isAEOnDuty: false,
      isDoctorOnDuty: false,
      isPharmacistOnDuty: false,
      isSecretaryOnDuty: false,
      isRecruiterOnDuty: false,
      isResearcherOnDuty: false,
      isShipDealerOnDuty: false,
      isRecruitingManagerOnDuty: false,
      isHangarManagerOnDuty: false,
      isAeSupplyDealerOnDuty: false,
      isAEShipSalesOnDuty: false,
      ownsPrivateFacility: false,
      managerStation: null,
    },
  }
  const root = buildNpcDialogue(ctx)
  return (root.children ?? []).map((c) => c.id)
})

function findPlayerEntity() {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

registerDebugHandle('hireCaptainViaDebug', (npcKey: string, shipKey: string) => {
  const player = findPlayerEntity()
  if (!player) return { ok: false, reason: 'no_player' }
  const npc = findNpcByKey(npcKey)?.entity
  const ship = findShipByKey(shipKey)
  if (!npc || !ship) return { ok: false, reason: 'not_found' }
  return hireAsCaptain(player, npc, ship)
})

registerDebugHandle('hireCrewViaDebug', (npcKey: string, shipKey: string) => {
  const player = findPlayerEntity()
  if (!player) return { ok: false, reason: 'no_player' }
  const npc = findNpcByKey(npcKey)?.entity
  const ship = findShipByKey(shipKey)
  if (!npc || !ship) return { ok: false, reason: 'not_found' }
  return hireAsCrew(player, npc, ship)
})

registerDebugHandle('fireCaptainViaDebug', (shipKey: string) => {
  const ship = findShipByKey(shipKey)
  if (!ship) return false
  return fireCaptain(ship)
})

registerDebugHandle('fireCrewMemberViaDebug', (shipKey: string, npcKey: string) => {
  const ship = findShipByKey(shipKey)
  if (!ship) return false
  return fireCrewMember(ship, npcKey)
})

registerDebugHandle('moveCrewMemberViaDebug', (fromKey: string, toKey: string, npcKey: string) => {
  const from = findShipByKey(fromKey)
  const to = findShipByKey(toKey)
  if (!from || !to) return { ok: false, reason: 'not_found' }
  return moveCrewMember(from, to, npcKey)
})

registerDebugHandle('manRestFromIdleViaDebug', (shipKey: string) => {
  const player = findPlayerEntity()
  if (!player) return null
  const ship = findShipByKey(shipKey)
  if (!ship) return null
  return manRestFromIdlePool(player, ship)
})

registerDebugHandle('crewRosterSnapshot', () => snapshotCrewRoster())

// Read the post-Effect topSpeed off the ship's StatSheet. The captain
// emits `eff:officer:<captainKey>:engineering` modifying topSpeed via
// percentMult; a smoke compares pre/post-hire numbers to assert the
// Effect is wired.
registerDebugHandle('shipStatSheetTopSpeed', (shipKey: string) => {
  const ship = findShipByKey(shipKey)
  if (!ship) return null
  if (!ship.has(ShipStatSheet)) return null
  return getStat(ship.get(ShipStatSheet)!.sheet, 'topSpeed')
})

// Read the list of Effect ids currently on the ship's ShipEffectsList.
// The smoke asserts `eff:officer:<key>:engineering` appears after a
// captain hire and disappears after fire.
registerDebugHandle('shipEffectIds', (shipKey: string): string[] => {
  const ship = findShipByKey(shipKey)
  if (!ship) return []
  if (!ship.has(ShipEffectsList)) return []
  return ship.get(ShipEffectsList)!.list.map((e) => e.id)
})

registerDebugHandle('captainEffectIdForKey', (captainKey: string) => {
  return captainEffectId(captainKey)
})

// ── Phase 6.2.E1 — war-room composition + aggression debug handles ──────

registerDebugHandle('warRoomDescribe', () => warRoomDescribe())

registerDebugHandle('setIsInActiveFleet', (
  shipKey: string,
  active: boolean,
  targetSlot?: number,
) => setIsInActiveFleet(shipKey, active, targetSlot))

registerDebugHandle('setFormationSlot', (shipKey: string, targetSlot: number) =>
  setFormationSlot(shipKey, targetSlot),
)

registerDebugHandle('setShipAggression', (shipKey: string, aggression: string) =>
  setAggression(shipKey, aggression),
)

registerDebugHandle('setWarRoomOpen', (open: boolean) => {
  useUI.getState().setWarRoom(open)
  return useUI.getState().warRoomOpen
})

// ── Phase 6.2.E2 — auto-launch + cross-POI transit + formation debug ─────

// Drive the flagship-undock consequence (auto-launch escorts at same
// POI; queue cross-POI transit for escorts at other POIs) without
// going through the actual navigate-out dialog.
registerDebugHandle('forceUndockFlagship', (originPoiId: string, gameDay: number = 0) => {
  return onFlagshipUndock(originPoiId, gameDay)
})

// Drive the flagship-dock consequence (despawn FleetEscort bodies +
// re-dock their Ships at the new POI). Mirror of the auto-launch
// surface above.
registerDebugHandle('forceDockFlagship', (destPoiId: string) => {
  return onFlagshipDock(destPoiId)
})

// Run one daily fleet-transit lander tick. Pure ECS surface — same as
// the day:rollover:settled subscription, just driven explicitly so the
// smoke can assert arrival lands at the expected day.
registerDebugHandle('runFleetTransitTick', (gameDay: number = 0) => {
  return fleetTransitSystem(gameDay)
})

// Snapshot of every ship currently in cross-POI transit. Used by the
// smoke to assert auto-queued transit lands the escort at the destination
// POI on arrivalDay.
registerDebugHandle('fleetTransitDescribe', () => listShipsInTransit())

// Enqueue a transit directly without going through the auto-launch
// dispatch. Used by smoke to bypass the flagship-undock path when
// testing the lander in isolation; also exercised by 6.2.G's hangar
// transfer-to-other-hangar verb (forthcoming).
registerDebugHandle('forceEnqueueShipTransit', (
  shipKey: string,
  originPoiId: string,
  destPoiId: string,
  gameDay: number,
) => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== shipKey) continue
    return enqueueShipTransit(e, originPoiId, destPoiId, gameDay)
  }
  return { ok: false as const, reason: 'no_origin' as const }
})

// Partition the active-fleet's non-flagship ships by POI vs. the
// flagship's. Smoke uses this to assert the same/different counts
// before driving the undock dispatcher.
registerDebugHandle('fleetActiveEscortPartition', (flagshipPoiId: string) => {
  const part = partitionActiveFleetEscorts(flagshipPoiId)
  return {
    sameAsFlagshipPoi: part.sameAsFlagshipPoi.map((e) => e.get(EntityKey)!.key),
    differentPoi: part.differentPoi.map((e) => e.get(EntityKey)!.key),
  }
})

// FleetEscort body snapshot from the spaceCampaign world. Used by the
// smoke to assert active escorts at the flagship's POI auto-launched
// + their Position lands at flagship.pos + formationOffset.
interface EscortBodySnapshot {
  shipKey: string
  pos: { x: number; y: number }
  formationSlot: number
  formationOffset: { dx: number; dy: number } | null
}
registerDebugHandle('fleetEscortBodies', (): EscortBodySnapshot[] => {
  const out: EscortBodySnapshot[] = []
  const space = getWorld('spaceCampaign')
  const shipWorld = getWorld('playerShipInterior')
  const slotByKey = new Map<string, number>()
  for (const e of shipWorld.query(Ship, EntityKey)) {
    slotByKey.set(e.get(EntityKey)!.key, e.get(Ship)!.formationSlot)
  }
  for (const e of space.query(FleetEscort, Position)) {
    const esc = e.get(FleetEscort)!
    const p = e.get(Position)!
    const slot = slotByKey.get(esc.shipKey) ?? -1
    out.push({
      shipKey: esc.shipKey,
      pos: { x: p.x, y: p.y },
      formationSlot: slot,
      formationOffset: formationOffsetForSlot(slot),
    })
  }
  return out
})

// Inspect player-side CombatShipState rows — flagship + every Phase
// 6.2.E2 active-fleet escort that entered tactical. Smoke uses this
// to assert escorts spawn at the right formation slot post-startCombat.
interface CombatPlayerSideSnapshot {
  entityKey: string
  shipClassId: string
  isFlagship: boolean
  isMs: boolean
  pos: { x: number; y: number }
  hullCurrent: number
  hullMax: number
  weaponsCount: number
  aiAggression: number
}
registerDebugHandle('combatPlayerSideSnapshot', (): CombatPlayerSideSnapshot[] => {
  const w = getWorld('playerShipInterior')
  const out: CombatPlayerSideSnapshot[] = []
  for (const e of w.query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.side !== 'player' && !cs.isFlagship && !cs.isPlayer) continue
    out.push({
      entityKey: e.get(EntityKey)?.key ?? '',
      shipClassId: cs.shipClassId,
      isFlagship: cs.isFlagship || cs.isPlayer,
      isMs: cs.isMs,
      pos: { x: cs.pos.x, y: cs.pos.y },
      hullCurrent: cs.hullCurrent,
      hullMax: cs.hullMax,
      weaponsCount: cs.weapons.length,
      aiAggression: cs.ai.aggression,
    })
  }
  return out
})

// Mark a Ship as in the active fleet without going through the war-room
// (which the smoke can also drive). Used to seed the fleet for the
// undock dispatcher tests.
registerDebugHandle('markInActiveFleetRaw', (shipKey: string, slot: number) => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== shipKey) continue
    if (!e.has(IsInActiveFleet)) e.add(IsInActiveFleet)
    const s = e.get(Ship)!
    e.set(Ship, { ...s, formationSlot: slot })
    return { ok: true, shipKey, slot }
  }
  return { ok: false, reason: 'not_found' }
})

// ── Phase 6.2.G — mothball + hangar transfer debug handles ──────────────

registerDebugHandle('setShipMothballedViaDebug', (shipKey: string, mothballed: boolean) => {
  return setShipMothballedByKey(shipKey, mothballed)
})

// Read the mothballed flag off the live Ship trait. Smoke reads this to
// assert the toggle landed.
registerDebugHandle('isShipMothballed', (shipKey: string): boolean | null => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== shipKey) continue
    return e.get(Ship)!.mothballed
  }
  return null
})

// Enumerate destinations a ship can be transferred to (slot cap-checked).
registerDebugHandle('listTransferDestinationsViaDebug', (shipKey: string) => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== shipKey) continue
    return listTransferDestinations(e)
  }
  return []
})

// Drive the transfer-to-other-hangar verb. Returns the system result.
registerDebugHandle('enqueueHangarTransferViaDebug', (
  shipKey: string,
  destPoiId: string,
  gameDay: number,
) => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key !== shipKey) continue
    return enqueueHangarTransfer(e, destPoiId, gameDay)
  }
  return { ok: false as const, reason: 'ship_not_found' as const }
})

// Drive the crew-salary daily tick directly. Returns the per-tick
// summary so smoke can assert ship + total counts move/skip
// correctly when mothballed ships flip in/out.
registerDebugHandle('runFleetCrewSalaryTick', (gameDay: number = 0) => {
  return fleetCrewSalarySystem(getWorld('playerShipInterior'), gameDay)
})

// Drive the supply drain daily tick directly. Smoke uses this to
// assert mothballing skips drain and unmothballing resumes it.
registerDebugHandle('runFleetSupplyDrainTick', (gameDay: number = 0) => {
  return fleetSupplyDrainSystem(
    getWorld('vonBraunCity'),
    getWorld('playerShipInterior'),
    gameDay,
  )
})

// Force-occupy a destination hangar's slot of the given class so the
// smoke can exercise the dest_no_slot refusal without a real buy.
// Spawns N dummy ships of the named class at the target POI and
// returns their keys (for later teardown if needed).
registerDebugHandle('forceFillHangarSlots', (poiId: string, shipClassId: string, count: number): string[] => {
  const w = getWorld('playerShipInterior')
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const cls = getShipClass(shipClassId)
    const key = `dummy-fill-${poiId}-${shipClassId}-${Date.now()}-${i}`
    w.spawn(
      Ship({
        templateId: cls.id,
        hullCurrent: cls.hullMax, hullMax: cls.hullMax,
        armorCurrent: cls.armorMax, armorMax: cls.armorMax,
        fluxMax: cls.fluxMax, fluxCurrent: 0,
        fluxDissipation: cls.fluxDissipation,
        hasShield: cls.hasShield,
        shieldEfficiency: cls.shieldEfficiency,
        topSpeed: cls.topSpeed,
        accel: cls.accel, decel: cls.decel,
        angularAccel: cls.angularAccel, maxAngVel: cls.maxAngVel,
        crCurrent: cls.crMax, crMax: cls.crMax,
        fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
        suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
        dockedAtPoiId: poiId,
        fleetPos: { x: 0, y: 0 },
        inCombat: false,
      }),
      EntityKey({ key }),
    )
    out.push(key)
  }
  return out
})
