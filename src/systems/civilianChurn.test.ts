// Deterministic (RNG-independent) properties of the civilian-churn roll: it is
// disjoint from conscription (never touches a combatant-eligible named NPC) and
// idempotent (skips an already-churned name). The "churn actually happens"
// behavior is RNG-driven and covered by the seeded smoke test.

import { describe, expect, it, beforeEach } from 'vitest'
import { Character } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { spawnNPC } from '../character/spawn'
import { civilianChurnRoll } from './civilianChurn'
import { markChurned, resetCivilianChurn, isChurned } from '../sim/civilianChurnState'

const SCENE = SCENE_IDS[0]
const COMBATANT = '阿纳贝尔·加图' // combatantEligible: true → conscription's, not ours
const NONCOMBATANT = '艾米·林'    // AE receptionist — non-combatant

function resetWorlds(): void {
  for (const id of SCENE_IDS) getWorld(id).reset()
}

function liveNames(): string[] {
  return [...getWorld(SCENE).query(Character)].map((e) => e.get(Character)!.name)
}

describe('civilianChurnRoll', () => {
  beforeEach(() => {
    resetWorlds()
    resetCivilianChurn()
  })

  it('never churns a combatant-eligible named NPC (disjoint from conscription)', () => {
    spawnNPC(getWorld(SCENE), { name: COMBATANT, color: '#888', x: 0, y: 0, key: 'npc-test-combatant' })
    for (let i = 0; i < 20; i++) {
      const r = civilianChurnRoll(1, 0)
      expect(r.churned.map((c) => c.name)).not.toContain(COMBATANT)
    }
    expect(liveNames()).toContain(COMBATANT)
    expect(isChurned(COMBATANT)).toBe(false)
  })

  it('skips an already-churned non-combatant NPC (idempotent)', () => {
    markChurned(NONCOMBATANT)
    spawnNPC(getWorld(SCENE), { name: NONCOMBATANT, color: '#888', x: 0, y: 0, key: 'npc-test-amy' })
    const r = civilianChurnRoll(1, 0)
    expect(r.churned.map((c) => c.name)).not.toContain(NONCOMBATANT)
    expect(liveNames()).toContain(NONCOMBATANT) // present → not destroyed
  })
})
