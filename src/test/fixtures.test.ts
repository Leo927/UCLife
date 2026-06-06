import { describe, expect, it, beforeEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { applyFixture, listFixtureNames } from './fixtures'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { IsPlayer, Position, Money, EntityKey, Attributes, ShipStatSheet } from '../ecs/traits'
import { getStat } from '../stats/sheet'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

function findPlayer() {
  const w = getWorld('vonBraunCity')
  return w.queryFirst(IsPlayer)
}

function resetAllWorlds(): void {
  for (const id of SCENE_IDS) getWorld(id).reset()
}

describe('applyFixture', () => {
  beforeEach(() => {
    resetAllWorlds()
  })

  it('loads minimal-player-only: player exists with fixture money and position', () => {
    applyFixture('minimal-player-only')
    const player = findPlayer()
    expect(player).not.toBeNull()
    expect(player!.get(Money)!.amount).toBe(1234)
    const pos = player!.get(Position)!
    expect(pos.x).toBe(10 * TILE)
    expect(pos.y).toBe(12 * TILE)
    expect(player!.get(EntityKey)!.key).toBe('player')
  })

  it('applies fixture skills onto the player StatSheet', () => {
    applyFixture('minimal-player-only')
    const player = findPlayer()!
    const sheet = player.get(Attributes)!.sheet
    expect(getStat(sheet, 'piloting')).toBe(42)
  })

  it('throws naming the fixture when the name is unregistered', () => {
    expect(() => applyFixture('this-fixture-does-not-exist')).toThrow(
      /applyFixture\(this-fixture-does-not-exist\).*not registered/,
    )
  })

  it('loads player-with-cash-at-vb: large money balance + vonBraunCity scene', () => {
    applyFixture('player-with-cash-at-vb')
    const player = findPlayer()
    expect(player).not.toBeNull()
    expect(player!.get(Money)!.amount).toBe(200000)
  })

  it('loads newsfeed-pre-war: player parked away from the commercial district', () => {
    applyFixture('newsfeed-pre-war')
    const player = findPlayer()
    expect(player).not.toBeNull()
    const pos = player!.get(Position)!
    expect(pos.x).toBe(8 * TILE)
    expect(pos.y).toBe(36 * TILE)
  })

  it('loads npc-transit: player + commuter NPC both land in vonBraunCity', () => {
    applyFixture('npc-transit')
    const w = getWorld('vonBraunCity')
    expect(w.queryFirst(IsPlayer)).not.toBeNull()
    let commuterFound = false
    for (const e of w.query(EntityKey)) {
      if (e.get(EntityKey)!.key === 'commuter') commuterFound = true
    }
    expect(commuterFound).toBe(true)
  })

  it('loads cp-dp: three-ship fleet + piloting=50 + dpCost projects onto ship sheets', () => {
    applyFixture('cp-dp')
    const player = findPlayer()!
    // Fixture stores XP (cumulative); 5000 XP = level 50.
    expect(getStat(player.get(Attributes)!.sheet, 'piloting')).toBe(5000)

    const shipWorld = getWorld('playerShipInterior')
    const byKey = new Map<string, ReturnType<typeof shipWorld.queryFirst>>()
    for (const e of shipWorld.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)
    expect(byKey.has('escort-a')).toBe(true)
    expect(byKey.has('escort-b')).toBe(true)

    // dpCost projects onto the ShipStatSheet from the class template.
    const escortA = byKey.get('escort-a')!
    expect(getStat(escortA.get(ShipStatSheet)!.sheet, 'dpCost')).toBe(2)
    const escortB = byKey.get('escort-b')!
    expect(getStat(escortB.get(ShipStatSheet)!.sheet, 'dpCost')).toBe(10)
  })

  it('loads vonBraunDrydock-station: player lands in the drydock concourse with cash', () => {
    applyFixture('vonBraunDrydock-station')
    // The drydock concourse is now the hidden orbital region of vonBraunCity.
    const player = getWorld('vonBraunCity').queryFirst(IsPlayer)
    expect(player).not.toBeNull()
    expect(player!.get(Money)!.amount).toBe(50000)
    const pos = player!.get(Position)!
    expect(pos.x).toBe(40 * TILE)
    expect(pos.y).toBe(560 * TILE)
  })
})

describe('fixture auto-discovery', () => {
  const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures')
  const filesOnDisk = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json5'))
    .map((f) => f.replace(/\.json5$/, ''))

  it('registers every tests/fixtures/*.json5 with no manual wiring', () => {
    const registered = listFixtureNames().sort()
    expect(registered).toEqual([...filesOnDisk].sort())
  })

  it('registry is non-empty (guards against a broken glob path silently registering nothing)', () => {
    expect(listFixtureNames().length).toBeGreaterThan(0)
  })

  it('resolves a known fixture name to a non-empty raw string', () => {
    expect(listFixtureNames()).toContain('minimal-player-only')
  })
})

import { __registerInlineFixtureForTest } from './fixtures'

describe('applyFixture validation', () => {
  beforeEach(() => {
    resetAllWorlds()
  })

  it('rejects unknown top-level keys, naming the offending field', () => {
    __registerInlineFixtureForTest('bad-toplevel', `{ player: {}, surpriseField: 1 }`)
    expect(() => applyFixture('bad-toplevel')).toThrow(
      /applyFixture\(bad-toplevel\): root\.surpriseField is not a recognized field/,
    )
  })

  it('rejects ship templates that are not registered ship classes', () => {
    __registerInlineFixtureForTest(
      'bad-ship',
      `{ player: { location: { scene: 'vonBraunCity', x: 0, y: 0 } }, ships: [{ id: 's1', template: 'pegasus' }] }`,
    )
    expect(() => applyFixture('bad-ship')).toThrow(
      /applyFixture\(bad-ship\): ships\[0\]\.template "pegasus" not found in ship-classes/,
    )
  })

  it('rejects an unknown scene id at top-level', () => {
    __registerInlineFixtureForTest('bad-scene', `{ scene: 'mars' }`)
    expect(() => applyFixture('bad-scene')).toThrow(
      /applyFixture\(bad-scene\): scene references unknown scene id "mars"/,
    )
  })

  it('rejects an unknown skill id under player.skills', () => {
    __registerInlineFixtureForTest(
      'bad-skill',
      `{ player: { location: { scene: 'vonBraunCity', x: 0, y: 0 }, skills: { wizardry: 5 } } }`,
    )
    expect(() => applyFixture('bad-skill')).toThrow(
      /applyFixture\(bad-skill\): player\.skills\.wizardry is not a known skill id/,
    )
  })

  it('loads amuro-at-recruit-office: player + faction money + ship + npc all land', () => {
    applyFixture('amuro-at-recruit-office')
    const player = findPlayer()!
    expect(player.get(Money)!.amount).toBe(5_000_000)
    expect(getStat(player.get(Attributes)!.sheet, 'piloting')).toBe(50)

    let amuroFound = false
    for (const e of getWorld('vonBraunCity').query(EntityKey)) {
      if (e.get(EntityKey)!.key === 'amuro') amuroFound = true
    }
    expect(amuroFound).toBe(true)

    let whiteBaseFound = false
    for (const e of getWorld('playerShipInterior').query(EntityKey)) {
      if (e.get(EntityKey)!.key === 'white-base') whiteBaseFound = true
    }
    expect(whiteBaseFound).toBe(true)
  })
})
