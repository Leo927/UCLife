import json5 from 'json5'
import raw from './ships.json5?raw'
import { isWeaponId, getWeapon } from './weapons'
import type { InteractableKind } from '../config/kinds'

// Player ship blueprints (Starsector-shape). See ships.json5 for schema.
// Validation is deliberate — silent typos here cause silent ship-fitout
// bugs at runtime, and combat balance reads off these numbers.

export type ShipClassKind = 'civilian' | 'merc' | 'military' | 'capital'

export type DoorSide = 'north' | 'south' | 'east' | 'west'

export type MountSize = 'small' | 'medium' | 'large'

// Authored kiosk inside a ship room. `offset` is in tiles, relative to
// the room's center (positive y = south, matching world axes). Default
// offset is the room center.
export interface ShipRoomInteractableDef {
  kind: InteractableKind
  label: string
  offset?: { dx: number; dy: number }
}

export interface ShipRoomDef {
  id: string
  nameZh: string
  bounds: { x: number; y: number; w: number; h: number }
  interactables?: ShipRoomInteractableDef[]
}

export interface ShipDoorDef {
  roomA: string
  roomB: string
  side: DoorSide
}

export interface ShipMountDef {
  idx: number
  size: MountSize
  arc: number       // total firing arc in radians
  facing: number    // mount center angle in radians (0 = +x)
}

export interface ShipClassDef {
  id: string
  nameZh: string
  descZh: string
  shipClass: ShipClassKind
  hullMax: number
  armorMax: number
  fluxMax: number
  fluxDissipation: number
  shieldEfficiency: number
  topSpeed: number
  maneuverability: number
  fuelMax: number
  suppliesMax: number
  crewMax: number
  mounts: ShipMountDef[]
  defaultWeapons: string[]
  priceFiat: number
  rooms: ShipRoomDef[]
  doors: ShipDoorDef[]
}

interface ShipsFile {
  ships: ShipClassDef[]
}

const parsed = json5.parse(raw) as ShipsFile

if (!Array.isArray(parsed.ships) || parsed.ships.length === 0) {
  throw new Error('ships.json5 must declare at least one ship class')
}

const VALID_CLASSES: ReadonlySet<ShipClassKind> = new Set<ShipClassKind>([
  'civilian', 'merc', 'military', 'capital',
])

const VALID_SIDES: ReadonlySet<DoorSide> = new Set<DoorSide>([
  'north', 'south', 'east', 'west',
])

const VALID_MOUNT_SIZES: ReadonlySet<MountSize> = new Set<MountSize>([
  'small', 'medium', 'large',
])

const SIZE_RANK: Record<MountSize, number> = { small: 1, medium: 2, large: 3 }

const seen = new Set<string>()
for (const ship of parsed.ships) {
  if (!ship.id) throw new Error('ships.json5: ship missing id')
  if (seen.has(ship.id)) throw new Error(`ships.json5: duplicate ship id "${ship.id}"`)
  seen.add(ship.id)

  if (!VALID_CLASSES.has(ship.shipClass)) {
    throw new Error(`ships.json5: ship "${ship.id}" invalid shipClass "${ship.shipClass}"`)
  }
  if (ship.hullMax <= 0) throw new Error(`ships.json5: ship "${ship.id}" hullMax must be > 0`)
  if (ship.armorMax < 0) throw new Error(`ships.json5: ship "${ship.id}" armorMax must be >= 0`)
  if (ship.fluxMax < 0) throw new Error(`ships.json5: ship "${ship.id}" fluxMax must be >= 0`)
  if (ship.fluxDissipation < 0) throw new Error(`ships.json5: ship "${ship.id}" fluxDissipation must be >= 0`)
  if (ship.shieldEfficiency < 0) throw new Error(`ships.json5: ship "${ship.id}" shieldEfficiency must be >= 0`)
  if (ship.topSpeed < 0) throw new Error(`ships.json5: ship "${ship.id}" topSpeed must be >= 0`)
  if (ship.maneuverability < 0 || ship.maneuverability > 2) {
    throw new Error(`ships.json5: ship "${ship.id}" maneuverability must be in [0, 2]`)
  }
  if (ship.fuelMax < 0) throw new Error(`ships.json5: ship "${ship.id}" fuelMax must be >= 0`)
  if (ship.suppliesMax < 0) throw new Error(`ships.json5: ship "${ship.id}" suppliesMax must be >= 0`)
  if (ship.crewMax <= 0) throw new Error(`ships.json5: ship "${ship.id}" crewMax must be > 0`)
  if (ship.priceFiat < 0) throw new Error(`ships.json5: ship "${ship.id}" priceFiat must be >= 0`)

  // Mounts
  const mountIdxSeen = new Set<number>()
  for (const m of ship.mounts) {
    if (mountIdxSeen.has(m.idx)) {
      throw new Error(`ships.json5: ship "${ship.id}" duplicate mount idx ${m.idx}`)
    }
    mountIdxSeen.add(m.idx)
    if (!VALID_MOUNT_SIZES.has(m.size)) {
      throw new Error(`ships.json5: ship "${ship.id}" mount ${m.idx} invalid size "${m.size}"`)
    }
    if (m.arc <= 0 || m.arc > Math.PI * 2) {
      throw new Error(`ships.json5: ship "${ship.id}" mount ${m.idx} arc must be in (0, 2π]`)
    }
  }

  // Default weapons fit under mount sizes (in declared order).
  if (ship.defaultWeapons.length > ship.mounts.length) {
    throw new Error(
      `ships.json5: ship "${ship.id}" has ${ship.defaultWeapons.length} default weapons but only ${ship.mounts.length} mounts`,
    )
  }
  ship.defaultWeapons.forEach((wId, i) => {
    if (!isWeaponId(wId)) {
      throw new Error(`ships.json5: ship "${ship.id}" defaultWeapons[${i}] unknown weapon "${wId}"`)
    }
    const w = getWeapon(wId)
    const mountSize = ship.mounts[i].size
    if (SIZE_RANK[w.size] > SIZE_RANK[mountSize]) {
      throw new Error(
        `ships.json5: ship "${ship.id}" default weapon "${wId}" (size ${w.size}) too large for mount ${i} (size ${mountSize})`,
      )
    }
  })

  // Rooms — id uniqueness + size sanity. The walkable layer is now
  // decoupled from system slots so we don't enforce coverage anymore.
  const roomIds = new Set<string>()
  for (const room of ship.rooms) {
    if (!room.id) throw new Error(`ships.json5: ship "${ship.id}" room missing id`)
    if (roomIds.has(room.id)) {
      throw new Error(`ships.json5: ship "${ship.id}" duplicate room id "${room.id}"`)
    }
    roomIds.add(room.id)
    if (room.bounds.w <= 0 || room.bounds.h <= 0) {
      throw new Error(`ships.json5: ship "${ship.id}" room "${room.id}" non-positive size`)
    }
    if (room.interactables) {
      for (const k of room.interactables) {
        if (typeof k.kind !== 'string' || !k.kind) {
          throw new Error(`ships.json5: ship "${ship.id}" room "${room.id}" interactable missing kind`)
        }
        if (typeof k.label !== 'string' || !k.label) {
          throw new Error(`ships.json5: ship "${ship.id}" room "${room.id}" interactable "${k.kind}" missing label`)
        }
        if (k.offset !== undefined) {
          if (typeof k.offset.dx !== 'number' || typeof k.offset.dy !== 'number') {
            throw new Error(`ships.json5: ship "${ship.id}" room "${room.id}" interactable "${k.kind}" offset must be {dx,dy} numbers`)
          }
        }
      }
    }
  }

  for (const door of ship.doors) {
    if (!roomIds.has(door.roomA)) {
      throw new Error(`ships.json5: ship "${ship.id}" door references unknown room "${door.roomA}"`)
    }
    if (!roomIds.has(door.roomB)) {
      throw new Error(`ships.json5: ship "${ship.id}" door references unknown room "${door.roomB}"`)
    }
    if (door.roomA === door.roomB) {
      throw new Error(`ships.json5: ship "${ship.id}" door connects "${door.roomA}" to itself`)
    }
    if (!VALID_SIDES.has(door.side)) {
      throw new Error(`ships.json5: ship "${ship.id}" door has invalid side "${door.side}"`)
    }
  }

  // Connectivity — every room reachable from the first room.
  if (ship.rooms.length > 0) {
    const adj = new Map<string, string[]>()
    for (const r of ship.rooms) adj.set(r.id, [])
    for (const d of ship.doors) {
      adj.get(d.roomA)!.push(d.roomB)
      adj.get(d.roomB)!.push(d.roomA)
    }
    const start = ship.rooms[0].id
    const visited = new Set<string>([start])
    const stack: string[] = [start]
    while (stack.length > 0) {
      const cur = stack.pop()!
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          stack.push(nb)
        }
      }
    }
    if (visited.size !== ship.rooms.length) {
      const unreached = ship.rooms.filter((r) => !visited.has(r.id)).map((r) => r.id)
      throw new Error(`ships.json5: ship "${ship.id}" unreachable rooms: ${unreached.join(', ')}`)
    }
  }
}

const byId: Record<string, ShipClassDef> = Object.fromEntries(
  parsed.ships.map((s) => [s.id, s]),
)

export const SHIP_CLASSES: Record<string, ShipClassDef> = byId

export const SHIP_CLASS_LIST: readonly ShipClassDef[] = parsed.ships

export function getShipClass(id: string): ShipClassDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown ship class id: ${id}`)
  return def
}

export function isShipClassId(id: string): boolean {
  return id in byId
}
