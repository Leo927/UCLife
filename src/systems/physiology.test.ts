// Phase machine + banded reconciler — pure ECS-driven coverage. Builds
// a fresh world, spawns one player + one NPC, force-onsets a condition,
// advances days, and verifies severity / phase / Effects emission /
// modifier presence on the StatSheet at each step.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createWorld } from 'koota'
import { spawnPlayer, spawnNPC } from '../character/spawn'
import {
  Conditions, Effects, Attributes, IsPlayer,
} from '../ecs/traits'
import {
  forceOnset, physiologySystem, diagnoseCondition, commitTreatment,
} from './physiology'
import { getStat } from '../stats/sheet'

// Koota caps active worlds at 16. Track every world setup() creates and
// destroy them after each test so the suite can grow past that bound.
const worlds: ReturnType<typeof createWorld>[] = []

function setup() {
  const world = createWorld()
  worlds.push(world)
  const player = spawnPlayer(world, { x: 0, y: 0 })
  const npc = spawnNPC(world, { name: '李明', color: '#888', x: 0, y: 0, key: 'npc-test-1' })
  return { world, player, npc }
}

afterEach(() => {
  while (worlds.length) worlds.pop()!.destroy()
})

describe('physiology — onset + spawn', () => {
  let world: ReturnType<typeof setup>['world']
  let player: ReturnType<typeof setup>['player']

  beforeEach(() => {
    ;({ world, player } = setup())
  })

  it('onsets the cold and seeds a Conditions instance', () => {
    const inst = forceOnset(player, 'cold_common', '测试', 1)
    expect(inst).not.toBeNull()
    const list = player.get(Conditions)!.list
    expect(list).toHaveLength(1)
    expect(list[0].templateId).toBe('cold_common')
    expect(list[0].phase).toBe('incubating')
  })

  it('refuses to onset the same systemic condition twice', () => {
    expect(forceOnset(player, 'cold_common', 'a', 1)).not.toBeNull()
    expect(forceOnset(player, 'cold_common', 'b', 1)).toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(1)
  })

  it('NPCs and players can both carry conditions', () => {
    const npc = world.queryFirst(Conditions)!
    void npc  // satisfy used-but-unused
    const { player: p2, npc: n2 } = setup()
    forceOnset(p2, 'cold_common', 'a', 1)
    forceOnset(n2, 'cold_common', 'b', 1)
    expect(p2.get(Conditions)!.list).toHaveLength(1)
    expect(n2.get(Conditions)!.list).toHaveLength(1)
  })
})

describe('physiology — phase transitions', () => {
  it('cold_common cycles incubating → rising → peak → recovering → resolved', () => {
    const { world, player } = setup()
    forceOnset(player, 'cold_common', '测试', 1)

    // Cold has incubation [1,2], rise [1,2], peakSeverity [35,55], peakDays 1.
    // Walk up to ~12 days; treatmentTier 0 satisfies cold's requiredTier 0.
    const phasesSeen = new Set<string>()
    for (let day = 2; day <= 14; day++) {
      physiologySystem(world, day)
      const list = player.get(Conditions)!.list
      if (list.length === 0) {
        phasesSeen.add('resolved')
        break
      }
      phasesSeen.add(list[0].phase)
    }
    expect(phasesSeen.has('rising')).toBe(true)
    expect(phasesSeen.has('peak')).toBe(true)
    expect(phasesSeen.has('recovering')).toBe(true)
    expect(phasesSeen.has('resolved')).toBe(true)
  })

  it('food_poisoning stalls untreated (requiredTier 1, default tier 0)', () => {
    const { world, player } = setup()
    forceOnset(player, 'food_poisoning', '翻找垃圾桶', 1)
    let stalled = false
    for (let day = 2; day <= 12; day++) {
      physiologySystem(world, day)
      const list = player.get(Conditions)!.list
      if (list.length === 0) break
      if (list[0].phase === 'stalled') {
        stalled = true
        break
      }
    }
    expect(stalled).toBe(true)
    // Severity holds while stalled — modifiers stay live.
    expect(player.get(Conditions)!.list[0].severity).toBeGreaterThan(0)
  })

  it('treatment commit flips a stalled instance back to recovering', () => {
    const { world, player } = setup()
    const inst = forceOnset(player, 'food_poisoning', '测试', 1)!
    for (let day = 2; day <= 6; day++) physiologySystem(world, day)
    expect(player.get(Conditions)!.list[0].phase).toBe('stalled')
    commitTreatment(player, inst.instanceId, 1, null)  // pharmacy
    physiologySystem(world, 7)
    const after = player.get(Conditions)!.list[0]
    expect(['recovering', 'peak']).toContain(after.phase)
  })

  it('treatment expires on the configured day and reverts to untreated', () => {
    const { world, player } = setup()
    const inst = forceOnset(player, 'food_poisoning', '测试', 1)!
    for (let day = 2; day <= 6; day++) physiologySystem(world, day)
    // Stalled at peak; commit pharmacy with a 2-day window.
    commitTreatment(player, inst.instanceId, 1, /* expiresDay */ 8)
    expect(player.get(Conditions)!.list[0].currentTreatmentTier).toBe(1)
    physiologySystem(world, 7)  // still treated
    expect(player.get(Conditions)!.list[0].currentTreatmentTier).toBe(1)
    physiologySystem(world, 9)  // past expiry → tier resets to 0
    const expired = player.get(Conditions)!.list[0]
    expect(expired.currentTreatmentTier).toBe(0)
    expect(expired.treatmentExpiresDay).toBeNull()
  })
})

describe('physiology — banded reconciler emits Effects', () => {
  it('cold mild band attaches at severity ≥ 20 and detaches on resolve', () => {
    const { world, player } = setup()
    forceOnset(player, 'cold_common', '测试', 1)
    let mildSeen = false
    for (let day = 2; day <= 14; day++) {
      physiologySystem(world, day)
      const eff = player.get(Effects)!.list
      if (eff.some((e) => e.family === 'condition' && e.nameZh === '感冒（轻症）')) {
        mildSeen = true
      }
      if (player.get(Conditions)!.list.length === 0) break
    }
    expect(mildSeen).toBe(true)
    // Resolved instance: no condition Effects left.
    const finalEff = player.get(Effects)!.list.filter((e) => e.family === 'condition')
    expect(finalEff).toHaveLength(0)
  })

  it('overlapping bands stack their modifiers on the StatSheet', () => {
    const { world, player } = setup()
    // Force onset and step the instance to rising/peak so both [20,100]
    // and [60,100] cold bands could be active at peak. Not all rolls
    // produce severity ≥ 60, so we drive food_poisoning instead which
    // has peakSeverity [55,75] and a [55,100] severe band — guaranteed
    // both bands active at peak.
    forceOnset(player, 'food_poisoning', '测试', 1)
    let bothBandsSeen = false
    for (let day = 2; day <= 8; day++) {
      physiologySystem(world, day)
      const eff = player.get(Effects)!.list
      const a = eff.find((e) => e.nameZh === '食物中毒（恶心）')
      const b = eff.find((e) => e.nameZh === '食物中毒（脱水）')
      if (a && b) {
        bothBandsSeen = true
        // workPerfMul stacked: -0.30 from band-a only (band-b doesn't carry it)
        const sheet = player.get(Attributes)!.sheet
        expect(getStat(sheet, 'workPerfMul')).toBeCloseTo(0.7, 4)
        // strength is capped at 30 by band-b
        expect(getStat(sheet, 'strength')).toBeLessThanOrEqual(30)
        break
      }
    }
    expect(bothBandsSeen).toBe(true)
  })

  it('multi-condition stacking — cold + food_poisoning together', () => {
    const { world, player } = setup()
    forceOnset(player, 'cold_common', '测试', 1)
    forceOnset(player, 'food_poisoning', '测试', 1)
    expect(player.get(Conditions)!.list).toHaveLength(2)
    // Step until both are out of incubation and have at least one band each.
    let multiActive = false
    for (let day = 2; day <= 8; day++) {
      physiologySystem(world, day)
      const cond = player.get(Conditions)!.list
      if (cond.length < 2) break
      const eff = player.get(Effects)!.list.filter((e) => e.family === 'condition')
      const cold = eff.some((e) => e.nameZh?.startsWith('感冒') ?? false)
      const fp = eff.some((e) => e.nameZh?.startsWith('食物中毒') ?? false)
      if (cold && fp) {
        multiActive = true
        // workPerfMul stacks multiplicatively: cold's mild band -0.20,
        // food_poisoning band-a -0.30 → product 0.8 * 0.7 = 0.56.
        const sheet = player.get(Attributes)!.sheet
        const wpm = getStat(sheet, 'workPerfMul')
        expect(wpm).toBeLessThan(0.7)
        break
      }
    }
    expect(multiActive).toBe(true)
  })
})

describe('physiology — body-part scope (Phase 4.1)', () => {
  it('body-part-scoped onset accepts a bodyPart and tags the instance', () => {
    const { player } = setup()
    const inst = forceOnset(player, 'sprain', '滑倒', 1, 'left-ankle')
    expect(inst).not.toBeNull()
    expect(inst!.bodyPart).toBe('left-ankle')
  })

  it('same body-part-scoped template on different parts both succeed', () => {
    const { player } = setup()
    expect(forceOnset(player, 'sprain', 'a', 1, 'left-ankle')).not.toBeNull()
    expect(forceOnset(player, 'sprain', 'b', 1, 'right-ankle')).not.toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(2)
  })

  it('same body-part-scoped template on same part refused', () => {
    const { player } = setup()
    expect(forceOnset(player, 'sprain', 'a', 1, 'left-ankle')).not.toBeNull()
    expect(forceOnset(player, 'sprain', 'b', 1, 'left-ankle')).toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(1)
  })

  it('body-part-scoped template without a bodyPart is refused', () => {
    const { player } = setup()
    expect(forceOnset(player, 'sprain', '?', 1)).toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(0)
  })

  it('systemic template with a bodyPart is refused', () => {
    const { player } = setup()
    expect(forceOnset(player, 'cold_common', '?', 1, 'head')).toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(0)
  })

  it('unknown bodyPart id is refused', () => {
    const { player } = setup()
    expect(forceOnset(player, 'sprain', '?', 1, 'tail')).toBeNull()
    expect(player.get(Conditions)!.list).toHaveLength(0)
  })
})

describe('physiology — chronic stubs (Phase 4.1)', () => {
  const stubs: Array<[id: string, bodyPart: string]> = [
    ['chronic_weak_joint',         'left-ankle'],
    ['chronic_scar_skin',          'left-arm'],
    ['chronic_recurring_headache', 'head'],
  ]
  for (const [id, bodyPart] of stubs) {
    it(`${id} spawns and never resolves`, () => {
      const { world, player } = setup()
      const inst = forceOnset(player, id, '旧伤', 1, bodyPart)
      expect(inst, `${id} should load + spawn`).not.toBeNull()
      const startSev = inst!.peakSeverity
      // Advance 60 game-days; chronic stub must never disappear.
      for (let day = 2; day <= 60; day++) physiologySystem(world, day)
      const list = player.get(Conditions)!.list
      expect(list, `${id} resolved instead of staying chronic`).toHaveLength(1)
      // Severity holds at peak; should not climb above the authored peak.
      expect(list[0].severity).toBeLessThanOrEqual(startSev + 0.01)
      expect(list[0].severity).toBeGreaterThan(0)
    })
  }

  it('chronic_weak_joint emits a permanent band Effect', () => {
    const { world, player } = setup()
    forceOnset(player, 'chronic_weak_joint', '旧伤', 1, 'left-ankle')
    for (let day = 2; day <= 5; day++) physiologySystem(world, day)
    const eff = player.get(Effects)!.list.filter((e) => e.family === 'condition')
    expect(eff.length).toBeGreaterThan(0)
  })
})

describe('physiology — injury catalog (Phase 4.1)', () => {
  // Every authored injury template must spawn on at least one body
  // part. concussion is head-only; everything else routes through a
  // limb part the catalog supports.
  const cases: Array<[id: string, bodyPart: string]> = [
    ['sprain',     'left-ankle'],
    ['cut',        'left-hand'],
    ['burn',       'right-arm'],
    ['fracture',   'left-arm'],
    ['concussion', 'head'],
  ]
  for (const [id, bodyPart] of cases) {
    it(`onsets ${id} on ${bodyPart}`, () => {
      const { player } = setup()
      const inst = forceOnset(player, id, 'env', 1, bodyPart)
      expect(inst, `${id} should load and spawn`).not.toBeNull()
      expect(inst!.bodyPart).toBe(bodyPart)
      expect(inst!.templateId).toBe(id)
    })
  }
})

describe('physiology — diagnosis flag', () => {
  it('diagnoseCondition flips diagnosed=true and re-emits Effects with hidden=false', () => {
    const { world, player } = setup()
    const inst = forceOnset(player, 'cold_common', '测试', 1)!
    for (let day = 2; day <= 4; day++) physiologySystem(world, day)
    // Pre-diagnosis: every condition Effect on the player is hidden.
    const before = player.get(Effects)!.list.filter((e) => e.family === 'condition')
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((e) => e.hidden === true)).toBe(true)
    expect(player.has(IsPlayer)).toBe(true)

    diagnoseCondition(player, inst.instanceId, 5)

    const after = player.get(Effects)!.list.filter((e) => e.family === 'condition')
    expect(after.every((e) => e.hidden === false)).toBe(true)
    expect(player.get(Conditions)!.list[0].diagnosed).toBe(true)
  })
})
