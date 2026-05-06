// Debug handle for job/workstation management. Lets smoke tests guarantee
// that every needed workstation has an active worker without depending on
// procgen building placement or BT scheduling.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { Workstation, Action } from '../../ecs/traits'
import { spawnNPC } from '../../character/spawn'
import { pickFreshName, pickRandomColor } from '../../character/nameGen'
import { claimJob } from '../../systems/market'

// Large enough that the action stays 'working' for the entire smoke-test run;
// the BT won't tick it to zero before the assertion fires.
const WORK_FOREVER = 999_999_999

function ensureWorkerForSpec(specId: string): boolean {
  let ws = null
  for (const e of world.query(Workstation)) {
    const w = e.get(Workstation)
    if (w?.specId === specId) {
      ws = e
      break
    }
  }

  // If no building was placed for this specId, create a synthetic workstation
  // entity. uclifePinClerk only queries Workstation — it doesn't require a
  // Building or Position sibling.
  if (!ws) {
    ws = world.spawn(Workstation({ specId, occupant: null, managerStation: null }))
  }

  const w = ws.get(Workstation)!
  let npc = w.occupant

  if (!npc) {
    npc = spawnNPC(world, {
      name: pickFreshName(world),
      color: pickRandomColor(),
      x: 0,
      y: 0,
    })
    claimJob(world, npc, ws)
  }

  // Force-set the working action so the NPC stays on shift regardless of BT
  // drive state or current game time.
  npc.set(Action, { kind: 'working', remaining: WORK_FOREVER, total: WORK_FOREVER })

  return true
}

/**
 * Ensure every listed specId has a workstation with an active worker.
 * If specIds is omitted, fills all currently-vacant workstations.
 * Returns one result entry per specId processed.
 *
 * Smoke tests call this once at setup so portrait fixtures and clerk-lookup
 * code find deterministic state regardless of procgen outcomes.
 */
registerDebugHandle('fillJobVacancies', (specIds?: string[]) => {
  if (specIds && specIds.length > 0) {
    return specIds.map((id) => ({ specId: id, ok: ensureWorkerForSpec(id) }))
  }
  const results: Array<{ specId: string; ok: boolean }> = []
  for (const e of world.query(Workstation)) {
    const w = e.get(Workstation)
    if (!w || w.occupant !== null) continue
    results.push({ specId: w.specId, ok: ensureWorkerForSpec(w.specId) })
  }
  return results
})
