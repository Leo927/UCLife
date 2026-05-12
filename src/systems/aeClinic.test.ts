// Phase 4.2 — AE-clinic faction-perk treatment.
//
// Covers two sidecars stamped onto a ConditionInstance by
// commitTreatment(..., perks): peakReductionBonus and
// scarThresholdOverride. The bonus reads in advanceInstance's rising
// arm (lower effective peak); the override swaps template.scarThreshold
// for that one instance (stub spawns gated harder on resolve).

import { describe, expect, it, afterEach } from 'vitest'
import { createWorld, type Entity } from 'koota'
import { spawnPlayer } from '../character/spawn'
import { Conditions } from '../ecs/traits'
import { forceOnset, commitTreatment, physiologySystem } from './physiology'

const worlds: ReturnType<typeof createWorld>[] = []

afterEach(() => {
  while (worlds.length) worlds.pop()!.destroy()
})

function setup() {
  const world = createWorld()
  worlds.push(world)
  const player = spawnPlayer(world, { x: 0, y: 0 })
  return { world, player }
}

// Direct trait write — bypass the phase machine to put an instance in
// the exact shape the scar test needs (recovering, near-zero severity,
// peakTracking pinned to a chosen value).
function patchInstance(player: Entity, instanceId: string, patch: Record<string, unknown>): void {
  const cond = player.get(Conditions)!
  const list = cond.list.map((c) =>
    c.instanceId === instanceId ? { ...c, activeBands: [...c.activeBands], ...patch } : c,
  )
  player.set(Conditions, { list })
}

function fluInstance(player: Entity) {
  return player.get(Conditions)!.list.find((c) => c.templateId === 'flu')!
}

describe('aeClinic — peak reduction bonus', () => {
  it('commitTreatment stamps peakReductionBonus onto the instance', () => {
    const { player } = setup()
    const inst = forceOnset(player, 'flu', '调试', 1)
    expect(inst).not.toBeNull()
    commitTreatment(player, inst!.instanceId, 2, 6, { peakReductionBonus: 10 })
    expect(fluInstance(player).peakReductionBonus).toBe(10)
  })

  it('rising arm reduces effective peak by (tier base + bonus)', () => {
    // Pin the rising-arm math against an exact peakSeverity so the
    // assertion doesn't sit on top of the seeded onset roll (which
    // varies by entity key + day) and the peakSeverityFloor clip
    // (which masks the bonus when peakSeverity is low). Setup:
    //   peakSeverity = 75, riseDays = 1 → one phase tick from
    //   severity 0 lands the rising arm at peak.
    function risePeak(bonus: number): number {
      const { world, player } = setup()
      const inst = forceOnset(player, 'flu', '调试', 1)!
      patchInstance(player, inst.instanceId, {
        phase: 'rising',
        severity: 0,
        peakSeverity: 75,
        riseDays: 1,
      })
      commitTreatment(player, inst.instanceId, 2, 30, { peakReductionBonus: bonus })
      physiologySystem(world, 2)
      return fluInstance(player).severity
    }
    // Baseline: tier-2 base reduction 25 → peak 75 - 25 = 50.
    // Perked:   tier-2 + bonus 10 → peak 75 - 35 = 40.
    // peakSeverityFloor = 35 doesn't clip either case.
    const baseline = risePeak(0)
    const perked = risePeak(10)
    expect(baseline).toBeCloseTo(50, 1)
    expect(perked).toBeCloseTo(40, 1)
    expect(baseline - perked).toBeCloseTo(10, 1)
  })
})

describe('aeClinic — scar threshold override', () => {
  it('commitTreatment stamps scarThresholdOverride onto the instance', () => {
    const { player } = setup()
    const inst = forceOnset(player, 'sprain', '滑倒', 1, 'left-ankle')!
    commitTreatment(player, inst.instanceId, 2, 6, { scarThresholdOverride: 95 })
    const live = player.get(Conditions)!.list.find((c) => c.instanceId === inst.instanceId)!
    expect(live.scarThresholdOverride).toBe(95)
  })

  it('raised scar threshold blocks the chronic stub on resolve', () => {
    // Sprain authors scarThreshold 75 + scarConditionId chronic_weak_joint.
    // We pin peakTracking to 80 (above 75, below the override 90), then
    // walk one phase tick from a near-resolve state.
    const { world, player } = setup()
    const inst = forceOnset(player, 'sprain', '滑倒', 1, 'left-ankle')!
    commitTreatment(player, inst.instanceId, 1, 10, { scarThresholdOverride: 90 })
    // Force-park into recovering at severity 0.5, peakTracking 80, peak
    // phase already done. Next phase tick should drop severity below 0
    // and run the scar branch with the override (80 < 90 → no scar).
    patchInstance(player, inst.instanceId, {
      phase: 'recovering',
      severity: 0.5,
      peakTracking: 80,
      peakDayCounter: 1,
    })
    physiologySystem(world, 2)
    const list = player.get(Conditions)!.list
    // Sprain instance resolved + no chronic_weak_joint stub spawned.
    expect(list.some((c) => c.templateId === 'sprain')).toBe(false)
    expect(list.some((c) => c.templateId === 'chronic_weak_joint')).toBe(false)
  })

  it('baseline (no override) still spawns the chronic stub at peakTracking 80', () => {
    // Mirror of the previous test without the override — same pinned
    // peakTracking should clear the authored threshold (75) and stamp a
    // weak-joint stub. Guards against the override accidentally
    // becoming "always raise" instead of "only when set".
    const { world, player } = setup()
    const inst = forceOnset(player, 'sprain', '滑倒', 1, 'left-ankle')!
    commitTreatment(player, inst.instanceId, 1, 10)  // no perks
    patchInstance(player, inst.instanceId, {
      phase: 'recovering',
      severity: 0.5,
      peakTracking: 80,
      peakDayCounter: 1,
    })
    physiologySystem(world, 2)
    const list = player.get(Conditions)!.list
    expect(list.some((c) => c.templateId === 'sprain')).toBe(false)
    expect(list.some((c) => c.templateId === 'chronic_weak_joint')).toBe(true)
  })
})

describe('aeClinic — backwards compat', () => {
  it('commitTreatment without perks does not clobber existing perks', () => {
    // First commit stamps a bonus + override. Second commit (no perks
    // arg) shouldn't reset them to 0/null — players who upgrade tier
    // from civilian → AE within one arc keep the AE outcome.
    const { player } = setup()
    const inst = forceOnset(player, 'flu', '调试', 1)!
    commitTreatment(player, inst.instanceId, 2, 6, { peakReductionBonus: 10, scarThresholdOverride: 95 })
    commitTreatment(player, inst.instanceId, 2, 7)  // tier same, no perks
    const live = fluInstance(player)
    expect(live.peakReductionBonus).toBe(10)
    expect(live.scarThresholdOverride).toBe(95)
  })
})
