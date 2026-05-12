// Phase 6.2.B — per-hangar save block. `tier` and `slotCapacity` are
// re-attached from facility-types.json5 at spawn (deterministic from the
// building's typeId), so the round-trip only persists fields the player
// mutates — today: `repairPriorityShipKey`. Keying by the host
// building's EntityKey keeps the block stable across reseeds.

import { registerSaveHandler } from '../../save/registry'
import { SCENE_IDS, getWorld } from '../../ecs/world'
import { Building, Hangar, EntityKey } from '../../ecs/traits'

interface HangarBlock {
  buildingKey: string
  repairPriorityShipKey: string
}

interface HangarsBlock {
  hangars: HangarBlock[]
}

function snapshot(): HangarsBlock | undefined {
  const out: HangarBlock[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Building, Hangar, EntityKey)) {
      const h = e.get(Hangar)!
      // Skip cleanly-default rows so a fresh save stays compact.
      if (!h.repairPriorityShipKey) continue
      out.push({
        buildingKey: e.get(EntityKey)!.key,
        repairPriorityShipKey: h.repairPriorityShipKey,
      })
    }
  }
  if (out.length === 0) return undefined
  return { hangars: out }
}

function restore(blob: HangarsBlock): void {
  if (!blob.hangars) return
  const byKey = new Map<string, HangarBlock>()
  for (const row of blob.hangars) byKey.set(row.buildingKey, row)
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Building, Hangar, EntityKey)) {
      const key = e.get(EntityKey)!.key
      const row = byKey.get(key)
      if (!row) continue
      const cur = e.get(Hangar)!
      e.set(Hangar, { ...cur, repairPriorityShipKey: row.repairPriorityShipKey })
    }
  }
}

registerSaveHandler<HangarsBlock>({
  id: 'hangars',
  snapshot,
  restore,
  // No reset() — bootstrap re-adds the Hangar trait via spawn.ts with
  // the empty default; missing block ⇒ nothing to override.
})
