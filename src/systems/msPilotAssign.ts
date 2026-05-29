// Phase 6.2.5.B — pilot auto-assignment.
//
// On MS delivery (and on pilot death — death handler not in this slice),
// the highest-piloting idle EmployedAsPilot is moved onto the new MS.
// The system is fired *manually* from the receive-MS-delivery click path
// (cheap; one walk per delivery). A daily reconciliation pass is not
// needed because pilot churn only happens at hire/fire/death and those
// callers explicitly invoke this.
//
// "Best" pilot today = highest `piloting` skill XP. Ties broken by stable
// EntityKey ordering so save/load preserves the same assignment.

import type { Entity } from 'koota'
import { Character, EmployedAsPilot, EntityKey, Ms } from '../ecs/traits'
import { getSkillXp } from '../character/skills'
import { getWorld, SCENE_IDS } from '../ecs/world'

const SHIP_SCENE_ID = 'playerShipInterior' as const

interface IdlePilotCandidate {
  npc: Entity
  npcKey: string
  pilotingXp: number
}

function listIdlePilots(): IdlePilotCandidate[] {
  const out: IdlePilotCandidate[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EmployedAsPilot)) {
      const employed = npc.get(EmployedAsPilot)!
      if (employed.msKey !== '') continue
      const key = npc.get(EntityKey)?.key ?? ''
      const xp = getSkillXp(npc, 'piloting')
      out.push({ npc, npcKey: key, pilotingXp: xp })
    }
  }
  // Best-first; stable tiebreak.
  out.sort((a, b) => {
    if (b.pilotingXp !== a.pilotingXp) return b.pilotingXp - a.pilotingXp
    return a.npcKey.localeCompare(b.npcKey)
  })
  return out
}

// Try to auto-assign the highest-piloting idle pilot to the given MS.
// No-op if the MS already has a pilot or no idle pilots exist. Returns
// the pilot's EntityKey when an assignment was made, or null.
export function autoAssignPilotForMs(msKey: string): string | null {
  if (!msKey) return null
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let msEnt: Entity | null = null
  for (const e of shipWorld.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key === msKey) { msEnt = e; break }
  }
  if (!msEnt) return null
  const ms = msEnt.get(Ms)!
  if (ms.pilotId) return null

  const candidates = listIdlePilots()
  if (candidates.length === 0) return null
  const pick = candidates[0]
  msEnt.set(Ms, { ...ms, pilotId: pick.npcKey })
  pick.npc.set(EmployedAsPilot, { msKey })
  return pick.npcKey
}

// Manual reassign (Issue #65 — pilot roster panel). Moves a specific
// pilot onto a specific MS, releasing both sides through
// `clearPilotAssignment` first so the trait stays single-source-of-truth
// (the same Ms.pilotId + EmployedAsPilot.msKey pair auto-assign writes).
// Returns false if the MS or pilot can't be found.
export function assignPilotToMs(npcKey: string, msKey: string): boolean {
  if (!npcKey || !msKey) return false
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let msEnt: Entity | null = null
  for (const e of shipWorld.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key === msKey) { msEnt = e; break }
  }
  if (!msEnt) return false

  // Release the seat the target MS currently holds (if any other pilot).
  const ms = msEnt.get(Ms)!
  if (ms.pilotId && ms.pilotId !== npcKey) clearPilotAssignment(msKey)

  // Locate the pilot NPC across every scene (pilots can idle in any city).
  let pilot: Entity | null = null
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EmployedAsPilot, EntityKey)) {
      if (npc.get(EntityKey)!.key === npcKey) { pilot = npc; break }
    }
    if (pilot) break
  }
  if (!pilot) return false

  // Release the MS the pilot was flying (if a different one).
  const employed = pilot.get(EmployedAsPilot)!
  if (employed.msKey && employed.msKey !== msKey) clearPilotAssignment(employed.msKey)

  // Re-read the MS (clearPilotAssignment above may have rewritten it) and
  // stamp the new pair.
  const msNow = msEnt.get(Ms)!
  msEnt.set(Ms, { ...msNow, pilotId: npcKey })
  pilot.set(EmployedAsPilot, { msKey })
  return true
}

// Reverse: clear the assignment when a pilot is moved off an MS.
// Reassign-from-terminal calls this before stamping the new msKey, so the
// trait reads as consistent at every step.
export function clearPilotAssignment(msKey: string): void {
  if (!msKey) return
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const e of shipWorld.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key !== msKey) continue
    const ms = e.get(Ms)!
    if (!ms.pilotId) return
    const prevPilotKey = ms.pilotId
    e.set(Ms, { ...ms, pilotId: '' })
    // Walk every scene for the NPC carrying that pilotKey; the BT skip is
    // role-keyed, not scene-bound.
    for (const sceneId of SCENE_IDS) {
      const w = getWorld(sceneId)
      for (const npc of w.query(Character, EmployedAsPilot, EntityKey)) {
        if (npc.get(EntityKey)!.key !== prevPilotKey) continue
        const employed = npc.get(EmployedAsPilot)!
        if (employed.msKey === msKey) {
          npc.set(EmployedAsPilot, { msKey: '' })
        }
      }
    }
    return
  }
}
