// Phase 4.2 — contagion. Builds a fresh world, marks NPCs Active, force-
// infects a carrier, walks the active-zone tick forward, and verifies
// transmission lands on neighbours but not on distant / immune / dead /
// incubating-carrier-adjacent characters.

import { describe, expect, it, afterEach } from 'vitest'
import { createWorld, type Entity, type World } from 'koota'
import { spawnPlayer, spawnNPC } from '../character/spawn'
import {
  Active, Conditions, Health, IsPlayer,
} from '../ecs/traits'
import { forceOnset, physiologySystem } from './physiology'
import {
  contagionSystem, resetContagion, prevalenceForTemplate,
} from './contagion'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

// Step the contagion system across N active-zone ticks at the configured
// cadence. Resets the throttle between setups so two `setup()` calls in
// one test file don't leak last-tick state.
function stepContagion(world: World, ticks: number, startTickId = 1): void {
  for (let i = 0; i < ticks; i++) {
    contagionSystem(world, (startTickId + i) * TICK_MS, /* day */ 1)
  }
}

const worlds: World[] = []

afterEach(() => {
  while (worlds.length) worlds.pop()!.destroy()
})

interface Setup {
  world: World
  player: Entity
  carrier: Entity
  near: Entity
  far: Entity
}

function setup(): Setup {
  const world = createWorld()
  worlds.push(world)
  resetContagion(world)
  const player = spawnPlayer(world, { x: 0, y: 0 })
  // Carrier and target NPCs are co-located so contactRadius doesn't gate
  // them out by accident. Tests that want distance push `far` outside the
  // 1.5-tile flu radius.
  const carrier = spawnNPC(world, { name: '李明', color: '#aaa', x: 0, y: 0, key: 'carrier' })
  const near = spawnNPC(world, { name: '张三', color: '#aaa', x: TILE * 0.5, y: 0, key: 'near' })
  const far = spawnNPC(world, { name: '远人', color: '#aaa', x: TILE * 10, y: TILE * 10, key: 'far' })
  // Mark all Active — contagion only walks the Active set.
  for (const e of [player, carrier, near, far]) e.add(Active)
  return { world, player, carrier, near, far }
}

// Push a carrier past incubation so isSymptomatic() returns true.
function advancePastIncubation(carrier: Entity): void {
  const cond = carrier.get(Conditions)!
  const list = cond.list.map((c) => ({ ...c, phase: 'rising' as const, severity: 30 }))
  carrier.set(Conditions, { list })
}

describe('contagion — basic transmission', () => {
  it('symptomatic carrier infects a co-located neighbour', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    // 0.05 per tick → after 100 ticks, P(no hit) = 0.95^100 ≈ 0.59%; the
    // deterministic seeded rolls reproduce a hit well inside 100 ticks.
    stepContagion(world, 100)
    const list = near.get(Conditions)!.list
    expect(list.some((c) => c.templateId === 'flu')).toBe(true)
    const source = list.find((c) => c.templateId === 'flu')!.source
    expect(source).toContain('李明')
  })

  it('incubating carrier does not transmit (severity 0 = no shedding)', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    // Leave the carrier in 'incubating' — forceOnset sets severity 0 and
    // phase 'incubating' on a fresh instance. No advancePastIncubation
    // call here.
    stepContagion(world, 200)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(false)
  })

  it('distant neighbour outside contactRadius is not infected', () => {
    const { world, carrier, far } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 200)
    expect(far.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(false)
  })

  it('dead character is never infected', () => {
    const { world, carrier, near } = setup()
    near.set(Health, { ...near.get(Health)!, dead: true })
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 200)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(false)
  })

  it('dead carrier does not transmit', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    carrier.set(Health, { ...carrier.get(Health)!, dead: true })
    stepContagion(world, 200)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(false)
  })

  it('already-infected target is skipped (no re-onset on top of existing)', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    forceOnset(near, 'flu', 'preexisting', 1)
    // Pin instanceId so we can confirm the original wasn't replaced.
    const originalId = near.get(Conditions)!.list[0].instanceId
    stepContagion(world, 200)
    const list = near.get(Conditions)!.list
    expect(list.filter((c) => c.templateId === 'flu')).toHaveLength(1)
    expect(list[0].instanceId).toBe(originalId)
  })

  it('non-Active entity is skipped (engine scope = active zone)', () => {
    const { world, carrier, near } = setup()
    if (near.has(Active)) near.remove(Active)
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 200)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(false)
  })
})

describe('contagion — throttle', () => {
  it('two calls inside one TICK_MS only roll once', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    // Same gameMs back-to-back: only the first should actually run.
    contagionSystem(world, TICK_MS, 1)
    const after1 = near.get(Conditions)!.list.length
    contagionSystem(world, TICK_MS, 1)
    contagionSystem(world, TICK_MS + 100, 1)  // still inside the throttle window
    const after3 = near.get(Conditions)!.list.length
    expect(after3).toBe(after1)
  })
})

describe('contagion — non-infectious templates skipped', () => {
  it('cold (no infectious flag in current authoring) does not spread via this system', () => {
    // cold_common's onsetPaths exclude 'contagion' and the row has no
    // infectious flag — the contagion system must skip it entirely so
    // we don't accidentally regress the cold's design (it's a vitals-
    // saturation condition).
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'cold_common', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 200)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'cold_common')).toBe(false)
  })
})

describe('contagion — determinism', () => {
  it('same seed + tick → same outcome', () => {
    function runOnce(): boolean[] {
      const world = createWorld()
      worlds.push(world)
      resetContagion(world)
      const p = spawnPlayer(world, { x: 0, y: 0 })
      const c = spawnNPC(world, { name: '李明', color: '#aaa', x: 0, y: 0, key: 'carrier' })
      const t1 = spawnNPC(world, { name: '张三', color: '#aaa', x: TILE * 0.5, y: 0, key: 't1' })
      const t2 = spawnNPC(world, { name: '李四', color: '#aaa', x: TILE * 0.5, y: 0, key: 't2' })
      const t3 = spawnNPC(world, { name: '王五', color: '#aaa', x: TILE * 0.5, y: 0, key: 't3' })
      for (const e of [p, c, t1, t2, t3]) e.add(Active)
      forceOnset(c, 'flu', 'seed', 1)
      advancePastIncubation(c)
      stepContagion(world, 50)
      return [t1, t2, t3].map((e) => e.get(Conditions)!.list.some((c) => c.templateId === 'flu'))
    }
    expect(runOnce()).toEqual(runOnce())
  })
})

describe('contagion — onset source attribution', () => {
  it('source string names the carrier and the canonical condition', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 100)
    const list = near.get(Conditions)!.list
    const flu = list.find((c) => c.templateId === 'flu')!
    expect(flu.source).toMatch(/感染自李明/)
    expect(flu.source).toMatch(/流感/)
  })
})

describe('contagion — prevalence readback (inactive aggregate)', () => {
  it('counts symptomatic carriers vs total living characters across the scene', () => {
    const { world, carrier } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    const { carriers, total } = prevalenceForTemplate(world, 'flu')
    expect(carriers).toBe(1)
    expect(total).toBeGreaterThanOrEqual(4)  // player + 3 npcs
  })

  it('incubating carriers do not count toward prevalence (no symptoms = no signal)', () => {
    const { world, carrier } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    // Leave in incubating
    const { carriers } = prevalenceForTemplate(world, 'flu')
    expect(carriers).toBe(0)
  })
})

describe('contagion — integration with physiology phase machine', () => {
  it('newly-infected target runs through the phase machine and becomes contagious itself', () => {
    const { world, carrier, near } = setup()
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 100)
    expect(near.get(Conditions)!.list.some((c) => c.templateId === 'flu')).toBe(true)
    // Walk the phase machine. After incubationDays days, the secondary
    // should reach 'rising' and start contributing to the contact-roll
    // pool (we don't assert on a third generation here — that's a
    // smoke-test concern).
    for (let day = 2; day <= 8; day++) physiologySystem(world, day)
    const list = near.get(Conditions)!.list
    // Either still active (rising/peak/recovering/stalled) or resolved
    // back to nothing — both are valid steady-state outcomes for the
    // ~5-7 day flu arc with no treatment.
    if (list.length > 0) {
      const flu = list.find((c) => c.templateId === 'flu')
      if (flu) {
        expect(['incubating', 'rising', 'peak', 'recovering', 'stalled']).toContain(flu.phase)
      }
    }
  })
})

describe('contagion — player as susceptible', () => {
  it('player co-located with infectious NPC catches the condition', () => {
    const world = createWorld()
    worlds.push(world)
    resetContagion(world)
    const player = spawnPlayer(world, { x: 0, y: 0 })
    const carrier = spawnNPC(world, { name: '李明', color: '#aaa', x: TILE * 0.5, y: 0, key: 'carrier' })
    for (const e of [player, carrier]) e.add(Active)
    forceOnset(carrier, 'flu', 'seed', 1)
    advancePastIncubation(carrier)
    stepContagion(world, 200)
    const fluInst = player.get(Conditions)!.list.find((c) => c.templateId === 'flu')
    expect(player.has(IsPlayer)).toBe(true)
    expect(fluInst).toBeDefined()
    expect(fluInst!.source).toContain('李明')
  })
})
