// Regression coverage for the bootTestMode order bug: bootstrapApp()
// spawned a default player BEFORE applyFixture() spawned the fixture-
// defined one, so getPlayerCharacter() returned the boot-spawned entity
// and fixture money / skills / position were silently shadowed.
//
// Tests drive the lifecycle directly (setupWorld) rather than through
// bootstrapApp + startLoop, because vitest's node env lacks the RAF
// the prod loop relies on. The skipDefaultPlayer flag plumbed through
// bootstrapApp is also covered structurally by bootstrapApp's own unit
// test in src/boot/lifecycle.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../sim/loop', () => ({
  startLoop: vi.fn(),
  stopLoop: vi.fn(),
}))

import { applyFixture } from './fixtures'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { IsPlayer, Money, Position, Attributes, EntityKey } from '../ecs/traits'
import { getStat } from '../stats/sheet'
import { bootstrapApp, __resetBootstrapForTests } from '../boot/lifecycle'
import { __resetSetupWorldForTests } from '../ecs/spawn'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

// Only count city-side IsPlayer entities (`EntityKey.key === 'player'`)
// — the space scene bootstrap also spawns an IsPlayer with key
// `spacePlayer`, which is unrelated to the fixture loader and should
// not skew this regression coverage.
function collectCityPlayers(): Array<{ scene: string; money: number; key: string }> {
  const out: Array<{ scene: string; money: number; key: string }> = []
  for (const id of SCENE_IDS) {
    const w = getWorld(id)
    for (const e of w.query(IsPlayer)) {
      const key = e.get(EntityKey)?.key ?? ''
      if (key !== 'player') continue
      out.push({
        scene: id,
        money: e.get(Money)?.amount ?? 0,
        key,
      })
    }
  }
  return out
}

function resetEverything(): void {
  for (const id of SCENE_IDS) getWorld(id).reset()
  __resetBootstrapForTests()
  __resetSetupWorldForTests()
}

describe('bootstrapApp + applyFixture ordering (the bug)', () => {
  beforeEach(() => {
    resetEverything()
  })

  afterEach(() => {
    resetEverything()
  })

  it('without skipDefaultPlayer, applyFixture leaves TWO IsPlayer entities (bug repro)', () => {
    bootstrapApp()  // default opts: skipDefaultPlayer = false
    applyFixture('minimal-player-only')
    const players = collectCityPlayers()
    expect(players.length).toBe(2)
  })

  it('with skipDefaultPlayer:true, applyFixture leaves exactly ONE IsPlayer (the fix)', () => {
    bootstrapApp({ skipDefaultPlayer: true })
    applyFixture('minimal-player-only')
    const players = collectCityPlayers()
    expect(players).toHaveLength(1)
    expect(players[0].money).toBe(1234)
    expect(players[0].key).toBe('player')
  })

  it('fixture position is authoritative when skipDefaultPlayer:true', () => {
    bootstrapApp({ skipDefaultPlayer: true })
    applyFixture('minimal-player-only')
    const w = getWorld('vonBraunCity')
    const ent = w.queryFirst(IsPlayer)!
    const pos = ent.get(Position)!
    expect(pos.x).toBe(10 * TILE)
    expect(pos.y).toBe(12 * TILE)
  })

  it('fixture skills are authoritative when skipDefaultPlayer:true', () => {
    bootstrapApp({ skipDefaultPlayer: true })
    applyFixture('minimal-player-only')
    const w = getWorld('vonBraunCity')
    const ent = w.queryFirst(IsPlayer)!
    const sheet = ent.get(Attributes)!.sheet
    expect(getStat(sheet, 'piloting')).toBe(42)
  })

  it('no-fixture boot (skipDefaultPlayer defaults to false) keeps the default-spawned player', () => {
    bootstrapApp()
    const players = collectCityPlayers()
    expect(players).toHaveLength(1)
    expect(players[0].key).toBe('player')
  })
})
