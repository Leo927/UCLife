// Civilian war — non-combatant churn (Phase 7.0.E.2). Once wartime, a periodic
// seeded roll removes the NON-combatant named NPCs the player knows: regulars
// they drank with who are suddenly gone — fled the colony or killed offscreen.
// This is the diegetic "the war is everywhere even if you never bought a ship"
// texture (Design/combat.md § Civilian war).
//
// Disjoint from 7.0.C conscription by construction: conscription churns the
// `combatantEligible` named NPCs (drafted to the front); this path churns the
// rest. The two filters partition the named roster, so a given NPC leaves
// exactly once. Subscribes to day:rollover:settled (boot/civilianChurnTick.ts),
// gated on isWartime() + the configured cadence. Seeded for determinism.
//
// Perf: O(named NPCs across scenes) once per cadence interval on the daily
// tick. No per-frame scan. Target N: the named-NPC roster (tens).

import type { Entity } from 'koota'
import { IsPlayer, Character } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { specialNpcs } from '../character/specialNpcs'
import { getSimRng } from '../sim/rng'
import { emitSim } from '../sim/events'
import { isWartime } from '../sim/warState'
import { isChurned, markChurned, getChurnLastRollDay, markChurnRollDay } from '../sim/civilianChurnState'
import { civilianChurnConfig } from '../config'

export type ChurnFate = 'fled' | 'killed'

export interface ChurnedNpc {
  name: string
  fate: ChurnFate
}

export interface CivilianChurnResult {
  churned: ChurnedNpc[]
}

// The non-combatant named roster: every special NPC that is NOT
// combatant-eligible (those are conscription's to churn).
function nonCombatantNames(): Set<string> {
  return new Set(specialNpcs.filter((n) => !n.combatantEligible).map((n) => n.name))
}

// One churn roll, independent of cadence (so a debug force-tick can drive it
// without advancing many days). Removes a seeded subset of the live
// non-combatant named NPCs, records each fate, and logs it.
export function civilianChurnRoll(_gameDay: number, gameMs: number): CivilianChurnResult {
  const eligible = nonCombatantNames()
  if (eligible.size === 0) return { churned: [] }

  const rng = getSimRng()
  const picked: { entity: Entity; name: string }[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Character)) {
      if (e.has(IsPlayer)) continue
      const name = e.get(Character)!.name
      if (!eligible.has(name)) continue
      if (isChurned(name)) continue
      if (rng.next() < civilianChurnConfig.npcChurnChance) picked.push({ entity: e, name })
    }
  }

  const churned: ChurnedNpc[] = []
  for (const p of picked) {
    const fate: ChurnFate = rng.next() < civilianChurnConfig.fledChance ? 'fled' : 'killed'
    p.entity.destroy()
    markChurned(p.name)
    emitSim('log', { textZh: churnLogZh(p.name, fate), atMs: gameMs })
    churned.push({ name: p.name, fate })
  }
  return { churned }
}

function churnLogZh(name: string, fate: ChurnFate): string {
  return fate === 'fled'
    ? `战乱之下，${name} 收拾行装离开了冯·布劳恩。`
    : `噩耗传来，${name} 在前线外的混乱中丧生。`
}

// Cadence-gated daily entry point (boot/civilianChurnTick.ts).
export function civilianChurnTick(gameDay: number, gameMs: number): void {
  if (!isWartime()) return
  if (gameDay - getChurnLastRollDay() < civilianChurnConfig.rollCadenceDays) return
  markChurnRollDay(gameDay)
  civilianChurnRoll(gameDay, gameMs)
}
