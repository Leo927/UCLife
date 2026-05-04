// Long-arc ship state — Starsector-shape stat block + hardpoint
// loadout. Reads/writes the playerShipInterior world directly (not the
// active-scene `world` proxy), so the snapshot captures the ship even
// when the player is currently in a city scene.
//
// Transient combat state (charge, projectiles, EnemyShipState) is never
// persisted; combat-time saves are refused at the saveGame level.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import { Ship, WeaponMount, EntityKey } from '../../ecs/traits'

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'

interface ShipBlock {
  hullCurrent: number
  armorCurrent: number
  fluxCurrent: number
  fuelCurrent: number
  suppliesCurrent: number
  dockedAtPoiId: string
  fleetPos: { x: number; y: number }
  weapons: { mountIdx: number; weaponId: string }[]
}

function snapshotShip(): ShipBlock | undefined {
  const w = getWorld(SHIP_SCENE_ID)
  const shipEnt = w.queryFirst(Ship)
  if (!shipEnt) return undefined
  const s = shipEnt.get(Ship)!

  const weapons: ShipBlock['weapons'] = []
  for (const e of w.query(WeaponMount, EntityKey)) {
    const key = e.get(EntityKey)!.key
    if (!key.startsWith('ship-weapon-')) continue
    const m = e.get(WeaponMount)!
    weapons.push({ mountIdx: m.mountIdx, weaponId: m.weaponId })
  }

  return {
    hullCurrent: s.hullCurrent,
    armorCurrent: s.armorCurrent,
    fluxCurrent: s.fluxCurrent,
    fuelCurrent: s.fuelCurrent,
    suppliesCurrent: s.suppliesCurrent,
    dockedAtPoiId: s.dockedAtPoiId,
    fleetPos: { x: s.fleetPos.x, y: s.fleetPos.y },
    weapons,
  }
}

function restoreShip(block: ShipBlock): void {
  const w = getWorld(SHIP_SCENE_ID)
  const byKey = new Map<string, ReturnType<typeof w.queryFirst>>()
  for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)

  const shipEnt = byKey.get('ship')
  if (shipEnt) {
    const cur = shipEnt.get(Ship)!
    shipEnt.set(Ship, {
      ...cur,
      hullCurrent: block.hullCurrent,
      armorCurrent: block.armorCurrent,
      fluxCurrent: block.fluxCurrent,
      fuelCurrent: block.fuelCurrent,
      suppliesCurrent: block.suppliesCurrent,
      dockedAtPoiId: block.dockedAtPoiId,
      fleetPos: { x: block.fleetPos.x, y: block.fleetPos.y },
      // Defense in depth: saves never write inCombat:true (manual
      // refused, autosave skipped) but force false here anyway.
      inCombat: false,
    })
  }

  for (const wpn of block.weapons) {
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

registerSaveHandler<ShipBlock>({
  id: 'ship',
  snapshot: snapshotShip,
  restore: restoreShip,
  // No reset — bootstrapShipScene already seeds defaults during
  // resetWorld(). Missing block ⇒ defaults stand.
})
