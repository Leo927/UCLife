import json5 from 'json5'
import raw from './ships.json5?raw'
import { SHIP_SYSTEMS, isSystemId, type SystemId } from './shipSystems'
import { isWeaponId } from './weapons'

export type ShipClassKind = 'civilian' | 'merc' | 'military' | 'capital'

export type DoorSide = 'north' | 'south' | 'east' | 'west'

export interface ShipRoomDef {
  id: string
  nameZh: string
  bounds: { x: number; y: number; w: number; h: number }
  // null when the room is pure walking space (corridor / quarters with
  // no installed system). Phase 6.0 spine fills every room with a
  // system; null is reserved for Phase 6.1+ ship classes.
  system: SystemId | null
}

export interface ShipDoorDef {
  roomA: string
  roomB: string
  side: DoorSide
}

export interface ShipClassDef {
  id: string
  nameZh: string
  descZh: string
  shipClass: ShipClassKind
  hullMax: number
  reactorMax: number
  fuelMax: number
  crewMax: number
  systemSlots: SystemId[]
  defaultSystems: Partial<Record<SystemId, number>>
  weaponMounts: number
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
  'civilian',
  'merc',
  'military',
  'capital',
])

const VALID_SIDES: ReadonlySet<DoorSide> = new Set<DoorSide>([
  'north',
  'south',
  'east',
  'west',
])

const seen = new Set<string>()
for (const ship of parsed.ships) {
  if (!ship.id) throw new Error('ships.json5: ship missing id')
  if (seen.has(ship.id)) throw new Error(`ships.json5: duplicate ship id "${ship.id}"`)
  seen.add(ship.id)

  if (!VALID_CLASSES.has(ship.shipClass)) {
    throw new Error(
      `ships.json5: ship "${ship.id}" has invalid shipClass "${ship.shipClass}"`,
    )
  }
  if (ship.hullMax <= 0) {
    throw new Error(`ships.json5: ship "${ship.id}" hullMax must be > 0`)
  }
  if (ship.reactorMax < 0) {
    throw new Error(`ships.json5: ship "${ship.id}" reactorMax must be >= 0`)
  }
  if (ship.fuelMax < 0) {
    throw new Error(`ships.json5: ship "${ship.id}" fuelMax must be >= 0`)
  }
  if (ship.crewMax <= 0) {
    throw new Error(`ships.json5: ship "${ship.id}" crewMax must be > 0`)
  }
  if (ship.weaponMounts < 0) {
    throw new Error(`ships.json5: ship "${ship.id}" weaponMounts must be >= 0`)
  }
  if (ship.priceFiat < 0) {
    throw new Error(`ships.json5: ship "${ship.id}" priceFiat must be >= 0`)
  }

  // Validate system slots against the system catalog.
  const slotSet = new Set<SystemId>()
  for (const slotId of ship.systemSlots) {
    if (!isSystemId(slotId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" systemSlots references unknown system "${slotId}"`,
      )
    }
    if (slotSet.has(slotId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" systemSlots has duplicate "${slotId}"`,
      )
    }
    slotSet.add(slotId)
  }

  // Default-system levels must reference an installed slot and respect
  // the system's maxLevel.
  for (const [sysId, level] of Object.entries(ship.defaultSystems)) {
    if (!isSystemId(sysId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" defaultSystems references unknown system "${sysId}"`,
      )
    }
    if (!slotSet.has(sysId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" defaultSystems for "${sysId}" but slot not installed`,
      )
    }
    const lvl = level ?? 0
    if (lvl < 0) {
      throw new Error(
        `ships.json5: ship "${ship.id}" defaultSystems."${sysId}" must be >= 0 (got ${lvl})`,
      )
    }
    const maxLvl = SHIP_SYSTEMS[sysId].maxLevel
    if (lvl > maxLvl) {
      throw new Error(
        `ships.json5: ship "${ship.id}" defaultSystems."${sysId}"=${lvl} exceeds maxLevel ${maxLvl}`,
      )
    }
  }

  // Weapons: every default weapon must exist and we can't ship more
  // defaults than mounts.
  if (ship.defaultWeapons.length > ship.weaponMounts) {
    throw new Error(
      `ships.json5: ship "${ship.id}" has ${ship.defaultWeapons.length} default weapons but only ${ship.weaponMounts} mounts`,
    )
  }
  for (const wId of ship.defaultWeapons) {
    if (!isWeaponId(wId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" defaultWeapons references unknown weapon "${wId}"`,
      )
    }
  }

  // Rooms: ids unique, system references valid, every system in
  // systemSlots is fulfilled by exactly one room.
  const roomIds = new Set<string>()
  const fulfilledSystems = new Set<SystemId>()
  for (const room of ship.rooms) {
    if (!room.id) throw new Error(`ships.json5: ship "${ship.id}" has room without id`)
    if (roomIds.has(room.id)) {
      throw new Error(`ships.json5: ship "${ship.id}" duplicate room id "${room.id}"`)
    }
    roomIds.add(room.id)
    if (room.bounds.w <= 0 || room.bounds.h <= 0) {
      throw new Error(
        `ships.json5: ship "${ship.id}" room "${room.id}" has non-positive size`,
      )
    }
    if (room.system !== null) {
      if (!isSystemId(room.system)) {
        throw new Error(
          `ships.json5: ship "${ship.id}" room "${room.id}" references unknown system "${room.system}"`,
        )
      }
      if (!slotSet.has(room.system)) {
        throw new Error(
          `ships.json5: ship "${ship.id}" room "${room.id}" hosts system "${room.system}" not in systemSlots`,
        )
      }
      if (fulfilledSystems.has(room.system)) {
        throw new Error(
          `ships.json5: ship "${ship.id}" system "${room.system}" assigned to multiple rooms`,
        )
      }
      fulfilledSystems.add(room.system)
    }
  }
  for (const slotId of ship.systemSlots) {
    if (!fulfilledSystems.has(slotId)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" system "${slotId}" in systemSlots has no room`,
      )
    }
  }

  // Doors: both endpoints must be known rooms.
  for (const door of ship.doors) {
    if (!roomIds.has(door.roomA)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" door references unknown room "${door.roomA}"`,
      )
    }
    if (!roomIds.has(door.roomB)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" door references unknown room "${door.roomB}"`,
      )
    }
    if (door.roomA === door.roomB) {
      throw new Error(
        `ships.json5: ship "${ship.id}" door connects room "${door.roomA}" to itself`,
      )
    }
    if (!VALID_SIDES.has(door.side)) {
      throw new Error(
        `ships.json5: ship "${ship.id}" door has invalid side "${door.side}"`,
      )
    }
  }

  // Connectivity: every room must be reachable from the first room
  // through the door graph. Ensures the player can walk anywhere.
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
      throw new Error(
        `ships.json5: ship "${ship.id}" has unreachable rooms: ${unreached.join(', ')}`,
      )
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
