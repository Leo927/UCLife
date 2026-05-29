// Phase 6.2.5.C — stranded-MS recovery tug.
//
// Comm-panel verb spawns a tug from the parent ship: it travels at
// `tugSpeedUnitsPerSec` to the stranded MS, grapples within
// `tugGrappleRadiusPx`, drags the MS back toward the dispatching ship,
// and on hitting `tugHandoffRadiusPx` of the chosen door hands off to
// the dock state machine. The MS then enters ResupplyState the same
// way a normal docked MS would.
//
// The tug occupies a hangar door for the duration via
// `reserveDoorForTug` / `releaseDoorOccupant`. Skill gate (`computers +
// mechanics`) is enforced at dispatch time; in-flight tug travel is
// pure physics.

import type { Entity } from 'koota'
import {
  Ship, CombatShipState, Ms, RecoveryTugState, EntityKey, IsFlagshipMark,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { sortieConfig } from '../config'
import { Character } from '../ecs/traits'
import { getSkillXp } from '../character/skills'
import {
  pickDoorForLaunch, reserveDoorForTug, releaseDoorOccupant,
  launchPointAndVelocity, sortieStats,
} from './hangarDoors'
import { routeDockedMsToResupply } from './sortieResupply'
import { pushCombatLog } from './combatLog'
import { getShipClass } from '../data/ship-classes'

const SHIP_SCENE_ID = 'playerShipInterior'

// Track which doors are currently held by a tug, keyed by tug entity key.
// Used by tickTugs to know which door to release on handoff. (Trivial
// indirection — the RecoveryTugState already carries it; the index
// here is just to keep tug-key lookups O(1) inside the tick.)

let tugCounter = 0
function nextTugKey(): string {
  tugCounter += 1
  return `tug-${tugCounter}`
}

export function resetTugCounter(): void {
  tugCounter = 0
}

// Find a Character entity by EntityKey across all scenes (NPCs live in
// different worlds than the ship roster). Returns null if not found.
function findCharacterByKey(npcKey: string): Entity | null {
  if (!npcKey) return null
  for (const id of SCENE_IDS) {
    const w = getWorld(id)
    for (const ent of w.query(Character, EntityKey)) {
      if (ent.get(EntityKey)!.key === npcKey) return ent
    }
  }
  return null
}

// Skill gate: the dispatching crew member must have computers + mechanics
// totalling at least `tugSkillThreshold` XP. For the flagship's currently
// assigned captain, we sum their skill XP (Design/sortie.md "computers +
// mechanics check on a crew member"). Returns `{ ok }` on pass, or
// `{ ok: false, reasonZh }` on fail.
function checkTugSkillGate(shipKey: string): { ok: true } | { ok: false; reasonZh: string } {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ship, EntityKey)) {
    if (ent.get(EntityKey)!.key !== shipKey) continue
    const s = ent.get(Ship)!
    // Try the assigned captain first (highest-skill member by design).
    const captain = findCharacterByKey(s.assignedCaptainId)
    if (captain) {
      const total = getSkillXp(captain, 'computers') + getSkillXp(captain, 'mechanics')
      if (total >= sortieConfig.tugSkillThreshold) return { ok: true }
    }
    // Fall back to scanning crew members; the highest crew member needs
    // to clear the gate alone (the comm-panel verb dispatches *a* crew
    // member, not the whole roster). 6.2.5.D will surface the picker;
    // this slice picks the highest qualifying crew or refuses.
    let bestTotal = 0
    for (const cKey of s.crewIds) {
      const c = findCharacterByKey(cKey)
      if (!c) continue
      const total = getSkillXp(c, 'computers') + getSkillXp(c, 'mechanics')
      if (total > bestTotal) bestTotal = total
    }
    if (bestTotal >= sortieConfig.tugSkillThreshold) return { ok: true }
    return {
      ok: false,
      reasonZh: `船员 computers+mechanics 技能不足 (需 ${sortieConfig.tugSkillThreshold})`,
    }
  }
  return { ok: false, reasonZh: '舰体不存在' }
}

// Public verb: dispatch a recovery tug for a stranded MS. Caller is the
// CommPanelDialog tactical-time button. Returns `{ ok }` or
// `{ ok:false, reasonZh }`.
//
// `viaShipKey` defaults to the flagship; future captain-of-non-flagship
// flows pass the dispatcher's ship key.
export function dispatchRecoveryTug(
  strandedMsKey: string,
  viaShipKey?: string,
): { ok: true; tugKey: string } | { ok: false; reasonZh: string } {
  const w = getWorld(SHIP_SCENE_ID)

  let shipKey = viaShipKey ?? ''
  if (!shipKey) {
    const flag = w.queryFirst(Ship, IsFlagshipMark, EntityKey)
    if (!flag) return { ok: false, reasonZh: '旗舰不存在' }
    shipKey = flag.get(EntityKey)!.key
  }

  // Stranded MS must exist and actually be stranded (propellant 0).
  // strandedMsKey is the *Ms entity* key (persistent), not the deployed
  // CombatShipState key. Look up the Ms first; the deployed row is
  // found by the `pilotedByPlayer && isMs` discriminator (there is at
  // most one deployed player MS at a time per Phase 6.1+ design).
  let strandedEnt: Entity | null = null
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key !== strandedMsKey) continue
    strandedEnt = ent
    break
  }
  if (!strandedEnt) return { ok: false, reasonZh: '目标 MS 不存在' }
  const strandedMs = strandedEnt.get(Ms)!
  if (strandedMs.currentPropellant > 0) {
    return { ok: false, reasonZh: '目标 MS 仍可自主推进 · 不需回收艇' }
  }

  // Find the deployed CombatShipState row (player-piloted MS).
  let strandedCs: Entity | null = null
  let deployedRuntimeKey = ''
  for (const ent of w.query(CombatShipState, EntityKey)) {
    const cs = ent.get(CombatShipState)!
    if (cs.isMs && cs.pilotedByPlayer) {
      strandedCs = ent
      deployedRuntimeKey = ent.get(EntityKey)!.key
      break
    }
  }
  if (!strandedCs) return { ok: false, reasonZh: '目标 MS 不在战术场景' }

  // Skill gate.
  const gate = checkTugSkillGate(shipKey)
  if (!gate.ok) return { ok: false, reasonZh: gate.reasonZh }

  // Pick a door. Reuse the launch-pick: free idle door wins; otherwise
  // the shortest queue. Tug claims the door (state stays idle, but
  // occupiedByMsKey set to the tug's key — launches refuse it.)
  const pick = pickDoorForLaunch(shipKey)
  if (!pick) return { ok: false, reasonZh: '舰体未授权机库门' }

  const tugKey = nextTugKey()
  const reserved = reserveDoorForTug(shipKey, pick.doorId, tugKey)
  if (!reserved) {
    return { ok: false, reasonZh: `舱门 ${pick.doorId} 暂时被占用` }
  }

  // Spawn the tug at the door's launch point with the parent ship's
  // current tactical pos / heading. The parent ship is the flagship
  // (CombatShipState with isFlagship).
  let parentPos = { x: 0, y: 0 }
  let parentHeading = 0
  for (const ent of w.query(CombatShipState)) {
    const cs = ent.get(CombatShipState)!
    if (cs.isFlagship) { parentPos = cs.pos; parentHeading = cs.heading; break }
  }
  const launch = launchPointAndVelocity(pick.door, parentPos, parentHeading, 0)
  const tugEnt = w.spawn(
    RecoveryTugState({
      shipKey,
      bayDoorId: pick.doorId,
      targetMsKey: strandedMsKey,
      targetCsKey: deployedRuntimeKey,
      phase: 'outbound',
      pos: launch.pos,
    }),
    EntityKey({ key: tugKey }),
  )
  void tugEnt

  pushCombatLog(`派遣回收艇 · 目标 ${strandedMs.name}`, 'info')
  return { ok: true, tugKey }
}

// Per-tick tug motion. Outbound → grapple → returning → handoff →
// despawn. Returns the list of tug keys that completed (handoff) this
// tick.
export function tickTugs(dtSec: number): string[] {
  const w = getWorld(SHIP_SCENE_ID)
  const t0 = sortieStats.enabled ? performance.now() : 0
  const completed: string[] = []
  for (const tugEnt of w.query(RecoveryTugState, EntityKey)) {
    const tug = tugEnt.get(RecoveryTugState)!
    const tugKey = tugEnt.get(EntityKey)!.key

    // Target position is either the stranded MS (outbound) or the
    // parent ship's door (returning). Look up live each tick — the
    // parent ship moves under the AI.
    let targetPos: { x: number; y: number } | null = null
    if (tug.phase === 'outbound' || tug.phase === 'grappled') {
      // Outbound: chase the stranded MS. Grappled: same target pos
      // but the MS sits at the tug's pos (we move both together below).
      for (const ent of w.query(CombatShipState, EntityKey)) {
        if (ent.get(EntityKey)!.key !== tug.targetCsKey) continue
        targetPos = ent.get(CombatShipState)!.pos
        break
      }
    } else {
      // Returning: head back to the parent ship's authored door.
      const cls = (() => {
        for (const ent of w.query(Ship, EntityKey)) {
          if (ent.get(EntityKey)!.key !== tug.shipKey) continue
          return getShipClass(ent.get(Ship)!.templateId)
        }
        return null
      })()
      const door = cls?.hangarDoors?.find((d) => d.id === tug.bayDoorId)
      if (cls && door) {
        for (const ent of w.query(CombatShipState)) {
          const cs = ent.get(CombatShipState)!
          if (!cs.isFlagship) continue
          // Same geometry as launchPointAndVelocity, just need the pos.
          const cosH = Math.cos(cs.heading)
          const sinH = Math.sin(cs.heading)
          targetPos = {
            x: cs.pos.x + door.position.x * cosH - door.position.y * sinH,
            y: cs.pos.y + door.position.x * sinH + door.position.y * cosH,
          }
          break
        }
      }
    }

    if (!targetPos) {
      // Target gone — abort the tug. Release the door and despawn.
      releaseDoorOccupant(tug.shipKey, tug.bayDoorId)
      tugEnt.destroy()
      continue
    }

    // Step the tug toward the target.
    const dx = targetPos.x - tug.pos.x
    const dy = targetPos.y - tug.pos.y
    const dist = Math.hypot(dx, dy)
    const step = sortieConfig.tugSpeedUnitsPerSec * dtSec
    const nextPos = (dist <= step || dist === 0)
      ? { x: targetPos.x, y: targetPos.y }
      : { x: tug.pos.x + (dx / dist) * step, y: tug.pos.y + (dy / dist) * step }

    let nextPhase = tug.phase
    let consume = false

    if (tug.phase === 'outbound' && dist <= sortieConfig.tugGrappleRadiusPx) {
      nextPhase = 'returning'
      pushCombatLog('回收艇已抓取目标 · 返航中', 'info')
    } else if (tug.phase === 'returning' && dist <= sortieConfig.tugHandoffRadiusPx) {
      nextPhase = 'handoff'
      consume = true
    }

    // If grappled or returning, drag the MS along — write its
    // CombatShipState pos to the tug pos so the visual stays consistent.
    if (nextPhase === 'returning' || tug.phase === 'returning') {
      for (const ent of w.query(CombatShipState, EntityKey)) {
        if (ent.get(EntityKey)!.key !== tug.targetCsKey) continue
        const cs = ent.get(CombatShipState)!
        ent.set(CombatShipState, { ...cs, pos: nextPos, vel: { x: 0, y: 0 } })
        break
      }
    }

    tugEnt.set(RecoveryTugState, { ...tug, phase: nextPhase, pos: nextPos })

    if (consume) {
      // Hand off: free the door, route the MS to the resupply queue,
      // despawn the tug.
      releaseDoorOccupant(tug.shipKey, tug.bayDoorId)
      // Despawn the MS's CombatShipState so it's back inside the bay.
      for (const ent of w.query(CombatShipState, EntityKey)) {
        if (ent.get(EntityKey)!.key !== tug.targetCsKey) continue
        ent.destroy()
        break
      }
      // Mark the Ms as stored aboard the ship + clear depot state.
      for (const ent of w.query(Ms, EntityKey)) {
        if (ent.get(EntityKey)!.key !== tug.targetMsKey) continue
        const m = ent.get(Ms)!
        ent.set(Ms, { ...m, storedOnShipKey: tug.shipKey })
        break
      }
      routeDockedMsToResupply(tug.targetMsKey, tug.shipKey, tug.bayDoorId)
      tugEnt.destroy()
      completed.push(tugKey)
    }
  }
  if (sortieStats.enabled) sortieStats.tugTickMs += performance.now() - t0
  return completed
}

// Test/debug helper — snapshot tug state for the smoke.
export function getRecoveryTugs(): Array<{
  tugKey: string
  shipKey: string
  bayDoorId: string
  targetMsKey: string
  targetCsKey: string
  phase: 'outbound' | 'grappled' | 'returning' | 'handoff'
  pos: { x: number; y: number }
}> {
  const w = getWorld(SHIP_SCENE_ID)
  const out: Array<{
    tugKey: string; shipKey: string; bayDoorId: string;
    targetMsKey: string; targetCsKey: string;
    phase: 'outbound' | 'grappled' | 'returning' | 'handoff';
    pos: { x: number; y: number }
  }> = []
  for (const ent of w.query(RecoveryTugState, EntityKey)) {
    const tug = ent.get(RecoveryTugState)!
    out.push({
      tugKey: ent.get(EntityKey)!.key,
      shipKey: tug.shipKey,
      bayDoorId: tug.bayDoorId,
      targetMsKey: tug.targetMsKey,
      targetCsKey: tug.targetCsKey,
      phase: tug.phase,
      pos: { ...tug.pos },
    })
  }
  return out
}
