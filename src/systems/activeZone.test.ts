import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Action, Active, Character, Health, IsPlayer, MoveTarget, Position,
} from '../ecs/traits'
import { activeZoneSystem, isPointInActiveZone, setViewportHint } from './activeZone'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const RADIUS_PX = worldConfig.activeZone.activeRadiusTiles * TILE
const BLEED_PX = worldConfig.activeZone.viewportBleedTiles * TILE
const HYST_PX = worldConfig.activeZone.hysteresisTiles * TILE
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

const spawnPlayer = (world: ReturnType<typeof createWorld>, x: number, y: number) =>
  world.spawn(IsPlayer, Position({ x, y }), Character({ name: 'player', color: '#fff', title: '' }), Health({ hp: 100, dead: false }), Action({ kind: 'idle', remaining: 0, total: 0 }))

const spawnNpc = (world: ReturnType<typeof createWorld>, x: number, y: number) =>
  world.spawn(Position({ x, y }), Character({ name: 'npc', color: '#aaa', title: '' }), Health({ hp: 100, dead: false }), Action({ kind: 'idle', remaining: 0, total: 0 }))

describe('activeZoneSystem (player-radius model)', () => {
  it('partitions NPCs into Active vs Inactive based on distance from the player', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    // Well inside the radius.
    const near = spawnNpc(world, 1010, 1010)
    // Way past radius + hysteresis.
    const far = spawnNpc(world, 10000, 10000)

    activeZoneSystem(world, 0)

    expect(near.has(Active)).toBe(true)
    expect(far.has(Active)).toBe(false)
  })

  it('marks the player Active regardless of position', () => {
    const world = createWorld()
    const player = spawnPlayer(world, 0, 0)
    activeZoneSystem(world, 0)
    expect(player.has(Active)).toBe(true)
  })

  it('applies hysteresis on demotion — currently-Active NPC inside (radius + hyst) stays Active even outside radius', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    // Just outside radius but inside (radius + hysteresis).
    const halfHyst = HYST_PX / 2
    const npc = spawnNpc(world, 1000 + RADIUS_PX + halfHyst, 1000)
    npc.add(Active)

    activeZoneSystem(world, TICK_MS)

    expect(npc.has(Active)).toBe(true)
  })

  it('demotes an NPC that has crossed the (radius + hyst) outer boundary', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    const npc = spawnNpc(world, 1000 + RADIUS_PX + HYST_PX + 100, 1000)
    npc.add(Active)

    activeZoneSystem(world, TICK_MS)

    expect(npc.has(Active)).toBe(false)
  })

  it('headless boot (no player entity) → all Characters Active', () => {
    const world = createWorld()
    const a = spawnNpc(world, 1000, 1000)
    const b = spawnNpc(world, 99999, 99999)

    activeZoneSystem(world, 0)

    expect(a.has(Active)).toBe(true)
    expect(b.has(Active)).toBe(true)
  })

  it('demotion teleports a walking NPC with an outside MoveTarget straight to its target', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    // Active NPC outside the demote box, with a MoveTarget also outside the
    // promote box — should snap to target rather than walking it.
    const startX = 1000 + RADIUS_PX + HYST_PX + 200
    const targetX = 1000 + RADIUS_PX + HYST_PX + 800
    const npc = spawnNpc(world, startX, 1000)
    npc.add(Active)
    npc.add(MoveTarget({ x: targetX, y: 1000 }))
    npc.set(Action, { kind: 'walking', remaining: 0, total: 0 })

    activeZoneSystem(world, TICK_MS)

    const pos = npc.get(Position)!
    expect(pos.x).toBe(targetX)
    expect(pos.y).toBe(1000)
    expect(npc.has(MoveTarget)).toBe(false)
    expect(npc.has(Active)).toBe(false)
    expect(npc.get(Action)!.kind).toBe('idle')
  })

  it('keeps an Active NPC Active when its MoveTarget lies inside the promote box even though the NPC is outside it', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    const npc = spawnNpc(world, 1000 + RADIUS_PX + HYST_PX + 200, 1000)
    npc.add(Active)
    // Heading back into the promote box — should not demote.
    npc.add(MoveTarget({ x: 1010, y: 1010 }))

    activeZoneSystem(world, TICK_MS)

    expect(npc.has(Active)).toBe(true)
  })

  it('respects the membership tick throttle — second call inside one tick window is a no-op', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    const npc = spawnNpc(world, 10000, 10000)
    npc.add(Active)

    // First call: gameMs = 0, fresh world's lastTickGameMs starts at -Infinity → runs.
    activeZoneSystem(world, 0)
    expect(npc.has(Active)).toBe(false)

    // Re-add Active, then call again well within the tick window.
    npc.add(Active)
    activeZoneSystem(world, TICK_MS - 1)

    // Throttle should have skipped this tick.
    expect(npc.has(Active)).toBe(true)
  })

  it('throttle state is per-world — two worlds do not share the lastTickGameMs', () => {
    // Regression guard: previously a module-level lastTickGameMs would
    // suppress activeZone runs in world B if world A had ticked recently.
    // Each koota world must carry its own throttle.
    const w1 = createWorld()
    const w2 = createWorld()
    spawnPlayer(w1, 1000, 1000)
    spawnPlayer(w2, 1000, 1000)
    const npc1 = spawnNpc(w1, 10000, 10000)
    const npc2 = spawnNpc(w2, 10000, 10000)
    npc1.add(Active)
    npc2.add(Active)

    // Tick w1 forward; the throttle in w1 should now suppress further w1 calls.
    activeZoneSystem(w1, TICK_MS * 100)
    expect(npc1.has(Active)).toBe(false)

    // w2 has never run; even at t=0 it must still execute (the throttle is
    // per-world, not shared with w1's huge timestamp).
    activeZoneSystem(w2, 0)
    expect(npc2.has(Active)).toBe(false)
  })
})

describe('activeZoneSystem (viewport-driven half-extents)', () => {
  it('viewport hint above the floor expands the zone, with bleed past the viewport edge and a hard cutoff beyond', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    // Viewport wide enough that viewport/2 dominates over the floor on x.
    const halfViewportPx = RADIUS_PX + TILE * 8
    setViewportHint(world, halfViewportPx * 2, TILE * 4)
    // (a) Outside floor radius, inside viewport — must be Active.
    const insideViewport = spawnNpc(world, 1000 + RADIUS_PX + TILE * 5, 1000)
    // (b) Just past the viewport edge but inside the bleed band — must be Active.
    const insideBleed = spawnNpc(world, 1000 + halfViewportPx + Math.floor(BLEED_PX / 2), 1000)
    // (c) Well past viewport + bleed + hysteresis — must be Inactive.
    const beyond = spawnNpc(world, 1000 + halfViewportPx + BLEED_PX + HYST_PX + TILE * 4, 1000)

    activeZoneSystem(world, 0)

    expect(insideViewport.has(Active)).toBe(true)
    expect(insideBleed.has(Active)).toBe(true)
    expect(beyond.has(Active)).toBe(false)
  })

  it('viewport hint smaller than the floor does not shrink the active zone', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    setViewportHint(world, TILE * 4, TILE * 4)
    // Inside the floor radius but well outside the tiny viewport — the floor
    // is the lower bound, so must still be Active.
    const npc = spawnNpc(world, 1000 + RADIUS_PX - 5, 1000)

    activeZoneSystem(world, 0)

    expect(npc.has(Active)).toBe(true)
  })
})

describe('isPointInActiveZone (player-radius model)', () => {
  it('returns true for points within the player radius', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    expect(isPointInActiveZone(world, 1010, 1010)).toBe(true)
  })

  it('returns false for points well outside the player radius', () => {
    const world = createWorld()
    spawnPlayer(world, 1000, 1000)
    expect(isPointInActiveZone(world, 1000 + RADIUS_PX + 200, 1000)).toBe(false)
  })

  it('is permissive (returns true) when there is no player entity (headless boot)', () => {
    const world = createWorld()
    expect(isPointInActiveZone(world, 99999, 99999)).toBe(true)
  })
})
