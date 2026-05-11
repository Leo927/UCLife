import { world } from '../ecs/world'
import { Wall, Door, Position } from '../ecs/traits'
import { worldConfig } from '../config'
import type { ShipClassDef, ShipRoomDef, ShipDoorDef, DoorSide } from '../data/ship-classes'

// Translate a ShipClassDef's authored room+door layout into Wall + Door
// entities in the active scene world. Mirrors the `enclose` idiom in
// spawn.ts: per-side wall emission with door cuts subtracted from the
// run, but extended to handle interior shared edges between adjacent
// rooms (each shared edge emitted exactly once, never double-walled).

type Rect = { x: number; y: number; w: number; h: number }

// A planned door tagged with the two rooms it bridges and the
// pixel-space cut location, so the per-side wall builder can subtract it.
type PlannedDoor = {
  doorDef: ShipDoorDef
  rect: Rect
  orient: 'h' | 'v'
}

export function layoutShipInterior(cls: ShipClassDef): void {
  const TILE = worldConfig.tilePx
  const WALL_T = worldConfig.wallThicknessPx

  if (cls.rooms.length === 0) return

  // 1) Pixel-space rects per room.
  const roomRectPx = new Map<string, Rect>()
  const roomDefById = new Map<string, ShipRoomDef>()
  for (const r of cls.rooms) {
    roomDefById.set(r.id, r)
    roomRectPx.set(r.id, {
      x: r.bounds.x * TILE,
      y: r.bounds.y * TILE,
      w: r.bounds.w * TILE,
      h: r.bounds.h * TILE,
    })
  }

  // 2) Outer hull bounding rect.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of roomRectPx.values()) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }

  // 3) Plan all doors. Validates geometric adjacency: throws if a door
  //    references rooms that don't share an edge on the declared side.
  const plannedDoors: PlannedDoor[] = []
  for (const door of cls.doors) {
    const a = roomRectPx.get(door.roomA)
    const b = roomRectPx.get(door.roomB)
    if (!a || !b) {
      throw new Error(
        `layoutShipInterior: ship "${cls.id}" door references unknown room ` +
        `"${a ? door.roomB : door.roomA}"`,
      )
    }
    plannedDoors.push(planDoor(cls.id, door, a, b, TILE, WALL_T))
  }

  // 4) For each room side, build a list of cuts coming from:
  //    (a) doors on that side
  //    (b) shared edges with sibling rooms (interior wall coverage —
  //        these cuts are also subtracted, but the wall segment is
  //        emitted by the partner room to avoid double-walling).
  //
  // The "owning" room of an interior shared segment is the one whose
  // id sorts first alphabetically — deterministic and side-agnostic.

  // Spawn doors first (one entity per ShipDoorDef, shared between rooms).
  for (const pd of plannedDoors) {
    world.spawn(
      Position({ x: pd.rect.x + pd.rect.w / 2, y: pd.rect.y + pd.rect.h / 2 }),
      Door({ x: pd.rect.x, y: pd.rect.y, w: pd.rect.w, h: pd.rect.h, orient: pd.orient }),
    )
  }

  // 5) Walls. For each room, walk its 4 sides; for each side, build a
  // sorted list of [from, to] sub-intervals along the edge, marking
  // each interval as exterior, interior-owned (emit), interior-foreign
  // (skip), or door (skip — already spawned above).
  for (const room of cls.rooms) {
    const rect = roomRectPx.get(room.id)!

    for (const side of (['n', 's', 'e', 'w'] as const)) {
      const horiz = side === 'n' || side === 's'
      const length = horiz ? rect.w : rect.h
      const sideOrigin = horiz ? rect.x : rect.y

      // Each entry: [from, to, kind]
      type SegKind = 'wall' | 'skip'
      const intervals: Array<{ from: number; to: number; kind: SegKind }> = []

      // Start as one big "wall" interval, then carve cuts into it.
      intervals.push({ from: 0, to: length, kind: 'wall' })

      const cuts: Array<{ from: number; to: number; emit: boolean }> = []

      // 5a) Door cuts on this side.
      for (const pd of plannedDoors) {
        const cut = doorCutOnSide(pd, room.id, side, sideOrigin)
        if (cut) cuts.push({ from: cut.from, to: cut.to, emit: false })
      }

      // 5b) Interior shared-edge cuts. For each sibling room sharing
      //     this side, the overlap is either covered by an existing
      //     door (already cut above) or solid wall. We emit it iff
      //     this room "owns" the shared edge.
      for (const other of cls.rooms) {
        if (other.id === room.id) continue
        const otherRect = roomRectPx.get(other.id)!
        const overlap = sharedEdgeOverlap(rect, otherRect, side)
        if (!overlap) continue

        const overlapLocal = {
          from: (horiz ? overlap.from - rect.x : overlap.from - rect.y),
          to:   (horiz ? overlap.to   - rect.x : overlap.to   - rect.y),
        }

        // Pick a deterministic owner — alphabetically smaller id wins.
        const owns = room.id < other.id

        // Subtract any door overlapping this shared edge from the wall
        // segment we'd emit; the rest is solid interior wall.
        const doorCutsHere: Array<{ from: number; to: number }> = []
        for (const pd of plannedDoors) {
          if (
            (pd.doorDef.roomA === room.id && pd.doorDef.roomB === other.id) ||
            (pd.doorDef.roomA === other.id && pd.doorDef.roomB === room.id)
          ) {
            const cut = doorCutOnSide(pd, room.id, side, sideOrigin)
            if (cut) doorCutsHere.push(cut)
          }
        }

        // Build sub-segments from overlapLocal minus doorCutsHere; mark
        // them emit=owns. Segments inside cuts (doors) are not emitted
        // here — the door entity already covers them.
        const sortedDoorCuts = doorCutsHere.slice().sort((a, b) => a.from - b.from)
        let cursor = overlapLocal.from
        for (const dc of sortedDoorCuts) {
          if (dc.from > cursor) {
            cuts.push({ from: cursor, to: Math.min(dc.from, overlapLocal.to), emit: owns })
          }
          cursor = Math.max(cursor, dc.to)
        }
        if (cursor < overlapLocal.to) {
          cuts.push({ from: cursor, to: overlapLocal.to, emit: owns })
        }
      }

      // 5c) Apply cuts to intervals. Each cut is either emit=true
      //     (replace the wall sub-segment with a wall sub-segment of
      //     identical extent — i.e. keep it) or emit=false (remove it
      //     from the wall list because it's a door or a foreign room's
      //     wall responsibility).
      const sortedCuts = cuts.slice().sort((a, b) => a.from - b.from)
      let cursor = 0
      const wallSegs: Array<[number, number]> = []
      for (const c of sortedCuts) {
        if (c.from > cursor) wallSegs.push([cursor, c.from])
        if (c.emit && c.to > c.from) wallSegs.push([c.from, c.to])
        cursor = Math.max(cursor, c.to)
      }
      if (cursor < length) wallSegs.push([cursor, length])

      // 5d) Emit each wall segment.
      for (const [a, b] of wallSegs) {
        const len = b - a
        if (len <= 0) continue
        let wx: number, wy: number, ww: number, wh: number
        if (side === 'n')      { wx = rect.x + a;            wy = rect.y;                    ww = len;     wh = WALL_T }
        else if (side === 's') { wx = rect.x + a;            wy = rect.y + rect.h - WALL_T;  ww = len;     wh = WALL_T }
        else if (side === 'w') { wx = rect.x;                wy = rect.y + a;                ww = WALL_T;  wh = len }
        else                   { wx = rect.x + rect.w - WALL_T; wy = rect.y + a;             ww = WALL_T;  wh = len }
        world.spawn(Wall({ x: wx, y: wy, w: ww, h: wh }))
      }
    }
  }

  // Suppress unused-binding lint for outer hull tracking — bounding rect
  // is implicit in per-room exterior wall emission, since any side
  // touching the bounding rect's border has no sibling overlap and gets
  // emitted as a plain wall by the loop above.
  void minX; void minY; void maxX; void maxY
}

// ── helpers ─────────────────────────────────────────────────────────────────

function planDoor(
  shipId: string,
  door: ShipDoorDef,
  a: Rect,
  b: Rect,
  TILE: number,
  WALL_T: number,
): PlannedDoor {
  const side: DoorSide = door.side
  // From roomA's perspective: side = direction roomB lies in.
  // Verify geometric adjacency and compute the shared overlap on that side.
  let sharedAxis: number
  let overlapFrom: number
  let overlapTo: number
  let orient: 'h' | 'v'
  let dx: number, dy: number, dw: number, dh: number

  if (side === 'east') {
    if (a.x + a.w !== b.x) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=east but A.right (${a.x + a.w}) !== B.left (${b.x})`,
      )
    }
    overlapFrom = Math.max(a.y, b.y)
    overlapTo   = Math.min(a.y + a.h, b.y + b.h)
    if (overlapTo <= overlapFrom) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=east has no y-overlap`,
      )
    }
    sharedAxis = a.x + a.w
    orient = 'v'
    const mid = (overlapFrom + overlapTo) / 2
    dx = sharedAxis - WALL_T / 2
    dy = mid - TILE / 2
    dw = WALL_T
    dh = TILE
  } else if (side === 'west') {
    if (a.x !== b.x + b.w) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=west but A.left (${a.x}) !== B.right (${b.x + b.w})`,
      )
    }
    overlapFrom = Math.max(a.y, b.y)
    overlapTo   = Math.min(a.y + a.h, b.y + b.h)
    if (overlapTo <= overlapFrom) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=west has no y-overlap`,
      )
    }
    sharedAxis = a.x
    orient = 'v'
    const mid = (overlapFrom + overlapTo) / 2
    dx = sharedAxis - WALL_T / 2
    dy = mid - TILE / 2
    dw = WALL_T
    dh = TILE
  } else if (side === 'south') {
    if (a.y + a.h !== b.y) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=south but A.bottom (${a.y + a.h}) !== B.top (${b.y})`,
      )
    }
    overlapFrom = Math.max(a.x, b.x)
    overlapTo   = Math.min(a.x + a.w, b.x + b.w)
    if (overlapTo <= overlapFrom) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=south has no x-overlap`,
      )
    }
    sharedAxis = a.y + a.h
    orient = 'h'
    const mid = (overlapFrom + overlapTo) / 2
    dx = mid - TILE / 2
    dy = sharedAxis - WALL_T / 2
    dw = TILE
    dh = WALL_T
  } else { // north
    if (a.y !== b.y + b.h) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=north but A.top (${a.y}) !== B.bottom (${b.y + b.h})`,
      )
    }
    overlapFrom = Math.max(a.x, b.x)
    overlapTo   = Math.min(a.x + a.w, b.x + b.w)
    if (overlapTo <= overlapFrom) {
      throw new Error(
        `layoutShipInterior: ship "${shipId}" door ${door.roomA}->${door.roomB} ` +
        `side=north has no x-overlap`,
      )
    }
    sharedAxis = a.y
    orient = 'h'
    const mid = (overlapFrom + overlapTo) / 2
    dx = mid - TILE / 2
    dy = sharedAxis - WALL_T / 2
    dw = TILE
    dh = WALL_T
  }

  return {
    doorDef: door,
    rect: { x: dx, y: dy, w: dw, h: dh },
    orient,
  }
}

// Compute the [from, to] cut a planned door makes on `room`'s `side`,
// in side-local coordinates (from sideOrigin along the side's axis).
// Returns null if the door is not on this side of this room.
function doorCutOnSide(
  pd: PlannedDoor,
  roomId: string,
  side: 'n' | 's' | 'e' | 'w',
  sideOrigin: number,
): { from: number; to: number } | null {
  const { doorDef, rect: dr } = pd
  if (doorDef.roomA !== roomId && doorDef.roomB !== roomId) return null

  // The door is on side X of `room` iff it sits on `room`'s X edge.
  // If room is doorDef.roomA, the door is on side `doorDef.side`
  // (translated to compass). If room is doorDef.roomB, the door is on
  // the opposite side of `room`.
  const compass = sideToCompass(side)
  const expected: DoorSide =
    doorDef.roomA === roomId ? doorDef.side : oppositeSide(doorDef.side)
  if (expected !== compass) return null

  // The cut runs along the door's parallel-to-edge dimension.
  const horiz = side === 'n' || side === 's'
  if (horiz) {
    const from = dr.x - sideOrigin
    return { from, to: from + dr.w }
  } else {
    const from = dr.y - sideOrigin
    return { from, to: from + dr.h }
  }
}

// Returns the pixel-space overlap of `a`'s `side` edge with `b`'s
// touching edge, or null if `b` is not flush against `a` on that side.
function sharedEdgeOverlap(
  a: Rect,
  b: Rect,
  side: 'n' | 's' | 'e' | 'w',
): { from: number; to: number } | null {
  if (side === 'n') {
    if (a.y !== b.y + b.h) return null
    const from = Math.max(a.x, b.x)
    const to   = Math.min(a.x + a.w, b.x + b.w)
    return to > from ? { from, to } : null
  } else if (side === 's') {
    if (a.y + a.h !== b.y) return null
    const from = Math.max(a.x, b.x)
    const to   = Math.min(a.x + a.w, b.x + b.w)
    return to > from ? { from, to } : null
  } else if (side === 'w') {
    if (a.x !== b.x + b.w) return null
    const from = Math.max(a.y, b.y)
    const to   = Math.min(a.y + a.h, b.y + b.h)
    return to > from ? { from, to } : null
  } else {
    if (a.x + a.w !== b.x) return null
    const from = Math.max(a.y, b.y)
    const to   = Math.min(a.y + a.h, b.y + b.h)
    return to > from ? { from, to } : null
  }
}

function sideToCompass(s: 'n' | 's' | 'e' | 'w'): DoorSide {
  return s === 'n' ? 'north' : s === 's' ? 'south' : s === 'e' ? 'east' : 'west'
}

function oppositeSide(s: DoorSide): DoorSide {
  return s === 'north' ? 'south' : s === 'south' ? 'north' : s === 'east' ? 'west' : 'east'
}
