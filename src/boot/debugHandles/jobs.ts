// Debug handle for job/workstation management. Lets smoke tests guarantee
// that every needed workstation has an active worker without depending on
// procgen building placement or BT scheduling.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import type { Entity, World } from 'koota'
import { world, getWorld, SCENE_IDS, getActiveSceneId } from '../../ecs/world'
import { Workstation, Action } from '../../ecs/traits'
import { spawnNPC } from '../../character/spawn'
import { pickFreshName, pickRandomColor } from '../../character/nameGen'
import { claimJob } from '../../systems/market'

// Large enough that the action stays 'working' for the entire smoke-test run;
// the BT won't tick it to zero before the assertion fires.
const WORK_FOREVER = 999_999_999

function ensureWorkerForSpec(specId: string): boolean {
  // Phase 6.2.C2 — workstation lookup checks the active scene first so
  // smokes that swap scenes (e.g. ride the orbital lift to Granada
  // drydock then fillJobVacancies(['hangar_manager'])) seat the manager
  // in the *current* scene, not whichever scene comes first in
  // SCENE_IDS. Falls back to other scenes when the active scene has no
  // matching workstation — that's how a smoke can seat a workstation
  // in another scene without first migrating the player there.
  let ws: Entity | null = null
  let wsWorld: World | null = null
  let fallbackWs: Entity | null = null
  let fallbackWorld: World | null = null
  const activeId = getActiveSceneId()
  const ordered = [activeId, ...SCENE_IDS.filter((id) => id !== activeId)]
  for (const sceneId of ordered) {
    const sw = getWorld(sceneId)
    for (const e of sw.query(Workstation)) {
      const w = e.get(Workstation)
      if (w?.specId !== specId) continue
      if (!fallbackWs) { fallbackWs = e; fallbackWorld = sw }
      if (w.occupant === null) { ws = e; wsWorld = sw; break }
    }
    if (ws) break
  }
  if (!ws) { ws = fallbackWs; wsWorld = fallbackWorld }

  if (!ws) {
    ws = world.spawn(Workstation({ specId, occupant: null, managerStation: null }))
    wsWorld = world
  }

  const w = ws.get(Workstation)!
  let npc = w.occupant

  if (!npc) {
    npc = spawnNPC(wsWorld!, {
      name: pickFreshName(wsWorld!),
      color: pickRandomColor(),
      x: 0,
      y: 0,
    })
    claimJob(wsWorld!, npc, ws)
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
