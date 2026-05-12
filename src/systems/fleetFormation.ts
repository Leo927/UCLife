// Phase 6.2.E2 — formation flying.
//
// Two surfaces, one each for campaign space and tactical combat:
//
//   1. `formationOffsetForSlot(slotIdx)` — pure lookup against
//      fleet.json5's `formationSlotOffsets`. Returns the (dx, dy) the
//      escort holds relative to the flagship's current heading-0 frame.
//   2. `fleetFormationSystem(space, dt)` — per-tick driver in the
//      spaceCampaign world. Reads the player ship's pos, walks every
//      FleetEscort entity, sets its Position to flagship.pos + offset.
//      The escorts have Velocity / Thrust traits for the integrator's
//      sake (so the existing space sim doesn't error on missing trait),
//      but they're hard-snapped: station-keeping is a position write,
//      not a thrust controller. Justification: at the 6.2.E2 scale (4-6
//      escorts) the simpler model is testable; the moment we want
//      lead-time / cohesion / formation breaks the controller can land.
//
// The non-flagship CombatShipState spawn at startCombat reuses
// `formationOffsetForSlot` so the tactical arena seeds escorts in the
// same topology as the war-room grid.

import type { World, Entity } from 'koota'
import {
  IsPlayer, ShipBody, Position, Velocity, FleetEscort, Ship, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { fleetConfig } from '../config'

const SHIP_SCENE_ID = 'playerShipInterior' as const

// Lookup a formation slot's (dx, dy) offset in arena/campaign units.
// Returns null for unknown slots (e.g. `-1` reserve sentinel) so the
// caller can skip with a clean signal. The flagship's anchor slot
// (config: `activeFleetGrid.flagshipSlot`) resolves to (0, 0).
export function formationOffsetForSlot(slotIdx: number): { dx: number; dy: number } | null {
  if (slotIdx < 0) return null
  const off = fleetConfig.formationSlotOffsets[String(slotIdx)]
  if (!off) return null
  return { dx: off.dx, dy: off.dy }
}

// Per-frame formation update for spaceCampaign. Each FleetEscort entity
// is snapped to the flagship's pos + its slot offset; velocity is left
// at zero so the renderer doesn't draw stale motion vectors.
export function fleetFormationSystem(space: World): void {
  const player = space.queryFirst(IsPlayer, ShipBody, Position)
  if (!player) return
  const flagshipPos = player.get(Position)!

  // Cross-world lookup: each FleetEscort's `shipKey` points at the Ship
  // entity in the playerShipInterior world. Read its `formationSlot` to
  // resolve the offset.
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const slotByKey = new Map<string, number>()
  for (const e of shipWorld.query(Ship, EntityKey)) {
    slotByKey.set(e.get(EntityKey)!.key, e.get(Ship)!.formationSlot)
  }

  for (const ent of space.query(FleetEscort, Position, Velocity)) {
    const esc = ent.get(FleetEscort)!
    const slot = slotByKey.get(esc.shipKey) ?? -1
    const off = formationOffsetForSlot(slot)
    if (!off) continue
    ent.set(Position, { x: flagshipPos.x + off.dx, y: flagshipPos.y + off.dy })
    ent.set(Velocity, { vx: 0, vy: 0 })
  }
}

// Find a FleetEscort entity in the spaceCampaign world by its bound
// shipKey. Returns null if none — used by the undock path to avoid
// spawning a second escort body for a ship that already has one.
export function findEscortBodyByShipKey(shipKey: string): Entity | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(FleetEscort)) {
    if (e.get(FleetEscort)!.shipKey === shipKey) return e
  }
  return null
}
