// Phase 6.2.A hangar debug handles. Lets the smoke suite locate the
// state-rental hangar, inspect its facility shape (tier, slotCapacity),
// and resolve the manager NPC entity for the talk-verb assertion.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  Building, Character, EntityKey, Hangar, Owner, Position, Workstation,
  type HangarSlotClass, type HangarTier,
} from '../../ecs/traits'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

interface HangarSnapshot {
  buildingKey: string
  typeId: string
  ownerKind: 'state' | 'faction' | 'character'
  tier: HangarTier
  slotCapacity: Partial<Record<HangarSlotClass, number>>
  rectTile: { x: number; y: number; w: number; h: number }
  manager: {
    specId: string
    occupantName: string | null
    posTile: { x: number; y: number } | null
  } | null
  workerCount: number
  workersSeated: number
}

function buildingContains(bld: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
  return p.x >= bld.x && p.x < bld.x + bld.w && p.y >= bld.y && p.y < bld.y + bld.h
}

function snapshotHangar(b: ReturnType<typeof world.query>[number]): HangarSnapshot {
  const bld = b.get(Building)!
  const key = b.get(EntityKey)?.key ?? ''
  const h = b.get(Hangar)!
  const o = b.get(Owner)!

  let manager: HangarSnapshot['manager'] = null
  let workerCount = 0
  let workersSeated = 0
  for (const ws of world.query(Workstation, Position)) {
    const w = ws.get(Workstation)!
    const wp = ws.get(Position)!
    if (!buildingContains(bld, wp)) continue
    if (w.specId === 'hangar_manager') {
      const occ = w.occupant
      manager = {
        specId: w.specId,
        occupantName: occ?.get(Character)?.name ?? null,
        posTile: { x: Math.round(wp.x / TILE), y: Math.round(wp.y / TILE) },
      }
    } else if (w.specId === 'hangar_worker') {
      workerCount += 1
      if (w.occupant) workersSeated += 1
    }
  }

  return {
    buildingKey: key,
    typeId: bld.typeId,
    ownerKind: o.kind,
    tier: h.tier,
    slotCapacity: h.slotCapacity,
    rectTile: {
      x: Math.round(bld.x / TILE),
      y: Math.round(bld.y / TILE),
      w: Math.round(bld.w / TILE),
      h: Math.round(bld.h / TILE),
    },
    manager,
    workerCount,
    workersSeated,
  }
}

registerDebugHandle('listHangars', (): HangarSnapshot[] => {
  const out: HangarSnapshot[] = []
  for (const b of world.query(Building, Hangar, Owner, EntityKey)) {
    out.push(snapshotHangar(b))
  }
  return out
})

// Returns the hangar manager NPC entity by buildingKey, or null if no
// occupant. Smoke tests drive setDialogNPC(manager) with this.
registerDebugHandle('hangarManagerEntity', (buildingKey: string) => {
  for (const b of world.query(Building, Hangar, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    const bld = b.get(Building)!
    for (const ws of world.query(Workstation, Position)) {
      const w = ws.get(Workstation)!
      const wp = ws.get(Position)!
      if (!buildingContains(bld, wp)) continue
      if (w.specId !== 'hangar_manager') continue
      return w.occupant ?? null
    }
  }
  return null
})
