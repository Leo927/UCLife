// Phase 6.2.B — per-hangar save block. `tier` and `slotCapacity` are
// re-attached from facility-types.json5 at spawn (deterministic from the
// building's typeId), so the round-trip only persists fields the player
// mutates — today: `repairPriorityShipKey`. Keying by the host
// building's EntityKey keeps the block stable across reseeds.
//
// Phase 6.2.F — extends the per-hangar block with supplyCurrent /
// fuelCurrent (mutable reserves; caps re-attach from facility-types at
// spawn) and the pending-delivery queue. Legacy blocks without these
// fields fall back to the spawn-time defaults (full reserves, no
// pending deliveries).

import { registerSaveHandler } from '../../save/registry'
import { SCENE_IDS, getWorld } from '../../ecs/world'
import { Building, Hangar, EntityKey } from '../../ecs/traits'
import type { PendingSupplyDelivery } from '../../ecs/traits'

interface HangarBlock {
  buildingKey: string
  repairPriorityShipKey: string
  // Phase 6.2.F — all optional so legacy 6.2.B blocks load cleanly.
  supplyCurrent?: number
  fuelCurrent?: number
  pendingSupplyDeliveries?: PendingSupplyDelivery[]
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
      // 6.2.F: a row is "default" iff repair-priority is unset AND
      // supply / fuel are still at max AND no pending deliveries.
      const fullSupply = h.supplyCurrent === h.supplyMax
      const fullFuel = h.fuelCurrent === h.fuelMax
      const noPending = h.pendingSupplyDeliveries.length === 0
      if (!h.repairPriorityShipKey && fullSupply && fullFuel && noPending) continue
      out.push({
        buildingKey: e.get(EntityKey)!.key,
        repairPriorityShipKey: h.repairPriorityShipKey,
        supplyCurrent: h.supplyCurrent,
        fuelCurrent: h.fuelCurrent,
        pendingSupplyDeliveries: h.pendingSupplyDeliveries.map((d) => ({ ...d })),
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
      e.set(Hangar, {
        ...cur,
        repairPriorityShipKey: row.repairPriorityShipKey,
        // Clamp under the spawn-projected max in case the data grew tighter
        // between the save and the load.
        supplyCurrent: row.supplyCurrent !== undefined
          ? Math.min(row.supplyCurrent, cur.supplyMax)
          : cur.supplyCurrent,
        fuelCurrent: row.fuelCurrent !== undefined
          ? Math.min(row.fuelCurrent, cur.fuelMax)
          : cur.fuelCurrent,
        pendingSupplyDeliveries: row.pendingSupplyDeliveries
          ? row.pendingSupplyDeliveries.map((d) => ({ ...d }))
          : cur.pendingSupplyDeliveries,
      })
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
