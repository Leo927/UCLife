// Long-arc fleet roster — per-ship Starsector-shape stat block + hardpoint
// loadout. Reads/writes the playerShipInterior world directly (not the
// active-scene `world` proxy), so the snapshot captures the fleet even
// when the player is currently in a city scene.
//
// Phase 6.1.5 — Save shape is plural-by-construction: each Ship entity
// snapshots to its own ShipBlock with a stable EntityKey and an
// `isFlagship` marker. Pre-6.1.5 saves wrote a flat single-ship payload
// without entityKey; the restore path accepts both shapes and folds the
// legacy payload into a one-ship fleet on the flagship entity.
//
// Phase 6.2.B — adds ShipStatSheet base round-trip + ShipEffectsList list
// round-trip per ship. The sheet's modifier arrays are derived from the
// Effects list on load (rebuildSheetFromEffects) so we don't write them.
// Missing fields on a legacy block re-project from the template via
// attachShipStatSheet, keeping pre-6.2.B saves loadable.
//
// Transient combat state (charge, projectiles, CombatShipState) is never
// persisted; combat-time saves are refused at the saveGame level.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import {
  Ship, WeaponMount, EntityKey, IsFlagshipMark,
  ShipStatSheet, ShipEffectsList,
} from '../../ecs/traits'
import { attachShipStatSheet } from '../../ecs/shipEffects'
import { serializeSheet, attachFormulas, type SerializedSheet } from '../../stats/sheet'
import { rebuildSheetFromEffects, type Effect } from '../../stats/effects'
import { SHIP_STAT_IDS, SHIP_STAT_FORMULAS, type ShipStatId } from '../../stats/shipSchema'
import { getShipClass } from '../../data/ship-classes'
import { reapplyCaptainEffectsOnRestore } from '../../systems/fleetCrew'

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'

interface ShipBlock {
  entityKey: string
  templateId: string
  isFlagship: boolean
  hullCurrent: number
  armorCurrent: number
  fluxCurrent: number
  crCurrent: number
  fuelCurrent: number
  suppliesCurrent: number
  dockedAtPoiId: string
  fleetPos: { x: number; y: number }
  weapons: { mountIdx: number; weaponId: string }[]
  // Phase 6.2.B — per-ship StatSheet + Effects list. Both optional so a
  // pre-6.2.B save loads cleanly: missing sheet ⇒ re-project from the
  // template; missing effects ⇒ empty list.
  statSheet?: SerializedSheet<ShipStatId>
  effects?: Effect<ShipStatId>[]
  // Phase 6.2.D — captain + crew references. EntityKey strings so the
  // round-trip survives a world reset. Both optional — pre-6.2.D saves
  // land as no-captain + empty crew, matching the trait default.
  assignedCaptainId?: string
  crewIds?: string[]
}

interface FleetBlock {
  ships: ShipBlock[]
}

// Legacy pre-6.1.5 shape — single ship, no entityKey, no templateId field
// (read off the entity's Ship trait `classId`). Identified by the
// presence of `hullCurrent` at the top level.
interface LegacyShipBlock {
  hullCurrent: number
  armorCurrent: number
  fluxCurrent: number
  crCurrent?: number
  fuelCurrent: number
  suppliesCurrent: number
  dockedAtPoiId: string
  fleetPos: { x: number; y: number }
  weapons: { mountIdx: number; weaponId: string }[]
}

function snapshotFleet(): FleetBlock | undefined {
  const w = getWorld(SHIP_SCENE_ID)
  const ships: ShipBlock[] = []
  for (const e of w.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    const key = e.get(EntityKey)!.key
    const weapons: ShipBlock['weapons'] = []
    // Per-ship weapon mounts are keyed `ship-weapon-<mountIdx>` on the
    // sole 6.1.5 flagship. When 6.2 introduces additional ships their
    // mount keys will need a per-ship namespace; until then snapshot
    // only the flagship's mounts so loadout state round-trips correctly.
    if (e.has(IsFlagshipMark)) {
      for (const we of w.query(WeaponMount, EntityKey)) {
        const wkey = we.get(EntityKey)!.key
        if (!wkey.startsWith('ship-weapon-')) continue
        const m = we.get(WeaponMount)!
        weapons.push({ mountIdx: m.mountIdx, weaponId: m.weaponId })
      }
    }
    const statSheet = e.has(ShipStatSheet) ? serializeSheet(e.get(ShipStatSheet)!.sheet) : undefined
    const effects = e.has(ShipEffectsList) ? e.get(ShipEffectsList)!.list : undefined
    ships.push({
      entityKey: key,
      templateId: s.templateId,
      isFlagship: e.has(IsFlagshipMark),
      hullCurrent: s.hullCurrent,
      armorCurrent: s.armorCurrent,
      fluxCurrent: s.fluxCurrent,
      crCurrent: s.crCurrent,
      fuelCurrent: s.fuelCurrent,
      suppliesCurrent: s.suppliesCurrent,
      dockedAtPoiId: s.dockedAtPoiId,
      fleetPos: { x: s.fleetPos.x, y: s.fleetPos.y },
      weapons,
      statSheet,
      effects: effects ? effects.map((eff) => ({ ...eff })) : undefined,
      assignedCaptainId: s.assignedCaptainId,
      crewIds: [...s.crewIds],
    })
  }
  if (ships.length === 0) return undefined
  return { ships }
}

// Cast site for the union-typed restore — the registry hands us
// unknown-shaped blobs at load time.
function isFleetBlock(blob: unknown): blob is FleetBlock {
  return !!blob && typeof blob === 'object' && Array.isArray((blob as { ships?: unknown }).ships)
}

function applyShipBlock(block: ShipBlock | LegacyShipBlock, entityKey: string): void {
  const w = getWorld(SHIP_SCENE_ID)
  let shipEnt: ReturnType<typeof w.queryFirst> | undefined
  for (const e of w.query(EntityKey)) {
    if (e.get(EntityKey)!.key === entityKey) { shipEnt = e; break }
  }
  // Phase 6.2.C2 — non-flagship ships (bought + delivered via C1's
  // shipDelivery pipeline) are not re-spawned by bootstrapShipScene, so a
  // missing entity here means we need to materialize one. Only the new
  // (`ShipBlock`) shape carries `templateId`; the legacy single-ship
  // payload is always the flagship and gets matched by EntityKey 'ship'
  // above (already spawned by bootstrap).
  const newBlock = block as ShipBlock
  if (!shipEnt && newBlock.templateId) {
    const cls = getShipClass(newBlock.templateId)
    shipEnt = w.spawn(
      Ship({
        templateId: cls.id,
        hullCurrent: cls.hullMax, hullMax: cls.hullMax,
        armorCurrent: cls.armorMax, armorMax: cls.armorMax,
        fluxMax: cls.fluxMax, fluxCurrent: 0,
        fluxDissipation: cls.fluxDissipation,
        hasShield: cls.hasShield,
        shieldEfficiency: cls.shieldEfficiency,
        topSpeed: cls.topSpeed,
        accel: cls.accel,
        decel: cls.decel,
        angularAccel: cls.angularAccel,
        maxAngVel: cls.maxAngVel,
        crCurrent: cls.crMax, crMax: cls.crMax,
        fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
        suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
        dockedAtPoiId: '',
        fleetPos: { x: 0, y: 0 },
        inCombat: false,
      }),
      EntityKey({ key: entityKey }),
    )
    if (newBlock.isFlagship) shipEnt.add(IsFlagshipMark)
    attachShipStatSheet(shipEnt)
  }
  if (!shipEnt) return
  const cur = shipEnt.get(Ship)
  if (!cur) return
  shipEnt.set(Ship, {
    ...cur,
    hullCurrent: block.hullCurrent,
    armorCurrent: block.armorCurrent,
    fluxCurrent: block.fluxCurrent,
    // Saves predating CR (block.crCurrent === undefined) restore to a
    // full gauge — old saves don't lose flight readiness on load.
    crCurrent: block.crCurrent ?? cur.crMax,
    fuelCurrent: block.fuelCurrent,
    suppliesCurrent: block.suppliesCurrent,
    dockedAtPoiId: block.dockedAtPoiId,
    fleetPos: { x: block.fleetPos.x, y: block.fleetPos.y },
    // Defense in depth: saves never write inCombat:true (manual
    // refused, autosave skipped) but force false here anyway.
    inCombat: false,
    // Phase 6.2.D — pre-6.2.D blocks omit these; defaults match the
    // trait's empty captain + empty crew shape.
    assignedCaptainId: newBlock.assignedCaptainId ?? '',
    crewIds: newBlock.crewIds ? [...newBlock.crewIds] : [],
  })

  // Phase 6.2.B — restore ShipStatSheet + ShipEffectsList. Legacy saves
  // (or any block missing statSheet) re-project from the template so
  // the sheet always lands valid post-restore.
  if (newBlock.statSheet) {
    if (!shipEnt.has(ShipStatSheet)) shipEnt.add(ShipStatSheet)
    if (!shipEnt.has(ShipEffectsList)) shipEnt.add(ShipEffectsList)
    const effects = (newBlock.effects ?? []) as Effect<ShipStatId>[]
    shipEnt.set(ShipEffectsList, { list: effects.map((e) => ({ ...e })) })
    const baseSheet = attachFormulas(SHIP_STAT_IDS, SHIP_STAT_FORMULAS, newBlock.statSheet)
    shipEnt.set(ShipStatSheet, { sheet: rebuildSheetFromEffects(baseSheet, effects) })
  } else {
    attachShipStatSheet(shipEnt)
  }
}

function restoreWeapons(weapons: ShipBlock['weapons']): void {
  const w = getWorld(SHIP_SCENE_ID)
  const byKey = new Map<string, ReturnType<typeof w.queryFirst>>()
  for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)
  for (const wpn of weapons) {
    const e = byKey.get(`ship-weapon-${wpn.mountIdx}`)
    if (!e) continue
    const cur = e.get(WeaponMount)!
    e.set(WeaponMount, {
      ...cur,
      weaponId: wpn.weaponId,
      chargeSec: 0,
      ready: false,
      targetIdx: 0,
    })
  }
}

function restoreFleet(blob: FleetBlock | LegacyShipBlock): void {
  if (isFleetBlock(blob)) {
    for (const ship of blob.ships) {
      applyShipBlock(ship, ship.entityKey)
      if (ship.isFlagship) restoreWeapons(ship.weapons)
    }
    // Phase 6.2.D — captain officer Effect reapplies after every ship
    // is back; the officer NPC lives in a city-scene world, which the
    // npc save handler restores in a separate slice. The npc handler
    // runs before this one is not guaranteed (registry order is unset),
    // but the reapply walk runs after every ship in this slice — by
    // which point npcs are restored.
    reapplyCaptainEffectsOnRestore()
    return
  }
  // Legacy pre-6.1.5 payload: single flat ShipBlock without entityKey.
  // The pre-6.1.5 bootstrap always seeded the flagship under EntityKey
  // 'ship' — apply there and migrate the loadout to the flagship's mounts.
  applyShipBlock(blob, 'ship')
  restoreWeapons(blob.weapons)
}

registerSaveHandler<FleetBlock | LegacyShipBlock>({
  id: 'ship',
  snapshot: snapshotFleet,
  restore: restoreFleet,
  // No reset — bootstrapShipScene already seeds defaults during
  // resetWorld(). Missing block ⇒ defaults stand.
})
