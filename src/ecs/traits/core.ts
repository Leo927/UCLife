// Universal traits — used by both character entities and world entities,
// or by save/load and pathfinding to anchor entity identity and motion.

import { trait } from 'koota'

export const Position = trait({ x: 0, y: 0 })
export const MoveTarget = trait({ x: 0, y: 0 })

// A path waypoint. `portal: true` marks the far end of an NPC-only transit
// edge (a transit-terminal or orbital-lift kiosk hop): movement teleports the
// entity onto it once the entity reaches the preceding kiosk waypoint, rather
// than walking the straight line between the two kiosks. See systems/transitNav.ts.
export interface Waypoint { x: number; y: number; portal?: boolean }

// `targetX/Y` is the MoveTarget the path was computed for; movement compares
// it against the current MoveTarget to detect invalidation.
export const Path = trait(() => ({
  waypoints: [] as Waypoint[],
  index: 0,
  targetX: 0,
  targetY: 0,
}))

// Stable identity for save/load. Walls/decorative interactables don't need
// keys — setupWorld rebuilds them from the world seed. Keys must be unique
// within a world.
export const EntityKey = trait({ key: '' })
