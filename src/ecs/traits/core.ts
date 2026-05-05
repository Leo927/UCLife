// Universal traits — used by both character entities and world entities,
// or by save/load and pathfinding to anchor entity identity and motion.

import { trait } from 'koota'

export const Position = trait({ x: 0, y: 0 })
export const MoveTarget = trait({ x: 0, y: 0 })

// `targetX/Y` is the MoveTarget the path was computed for; movement compares
// it against the current MoveTarget to detect invalidation.
export const Path = trait(() => ({
  waypoints: [] as { x: number; y: number }[],
  index: 0,
  targetX: 0,
  targetY: 0,
}))

// Stable identity for save/load. Walls/decorative interactables don't need
// keys — setupWorld rebuilds them from the world seed. Keys must be unique
// within a world.
export const EntityKey = trait({ key: '' })
