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
// Transient combat state (charge, projectiles, CombatShipState) is never
// persisted; combat-time saves are refused at the saveGame level.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import { Ship, WeaponMount, EntityKey, IsFlagshipMark } from '../../ecs/traits'

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
  })
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
