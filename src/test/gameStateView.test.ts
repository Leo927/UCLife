import { describe, expect, it, beforeEach } from 'vitest'
import { applyFixture, __registerInlineFixtureForTest } from './fixtures'
import { getGameState } from './gameStateView'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { Building, EntityKey } from '../ecs/traits'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

function resetAllWorlds(): void {
  for (const id of SCENE_IDS) getWorld(id).reset()
}

describe('getGameState', () => {
  beforeEach(() => {
    resetAllWorlds()
  })

  it('CharacterView.getResource reads player Money', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getPlayerCharacter().getResource('Money')).toBe(1234)
  })

  it('CharacterView.getStat reads player StatSheet skill', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getPlayerCharacter().getStat('piloting')).toBe(42)
  })

  it('CharacterView.getId returns the player EntityKey', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getPlayerCharacter().getId()).toBe('player')
  })

  it('CharacterView.getPosition reflects fixture coordinates', () => {
    applyFixture('minimal-player-only')
    const pos = getGameState().getPlayerCharacter().getPosition()
    expect(pos.scene).toBe('vonBraunCity')
    expect(pos.x).toBe(10 * TILE)
    expect(pos.y).toBe(12 * TILE)
  })

  it('getCharacter returns null for unknown id', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getCharacter('nonexistent')).toBeNull()
  })

  it('getCharacter resolves a named NPC and exposes its stat', () => {
    applyFixture('amuro-at-recruit-office')
    const amuro = getGameState().getCharacter('amuro')
    expect(amuro).not.toBeNull()
    expect(amuro!.getStat('piloting')).toBe(92)
  })

  it('getShip resolves the fleet flagship and reports captain/crew/dock', () => {
    applyFixture('amuro-at-recruit-office')
    const ship = getGameState().getShip('white-base')
    expect(ship).not.toBeNull()
    expect(ship!.getId()).toBe('white-base')
    expect(ship!.getDockedAt()).toBe('vonBraun')
    expect(ship!.getCaptain()).toBeNull()
    expect(ship!.getCrew()).toEqual([])
    expect(ship!.getHullPct()).toBe(1)
  })

  it('getPlayerFleet counts zero ships when no fixture ship exists', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getPlayerFleet().getShipCount()).toBe(0)
  })

  it('getPlayerFleet counts the fixture flagship', () => {
    applyFixture('amuro-at-recruit-office')
    expect(getGameState().getPlayerFleet().getShipCount()).toBe(1)
  })

  it('getFaction reads the post-fixture fund as a "Money" resource', () => {
    applyFixture('amuro-at-recruit-office')
    const ae = getGameState().getFaction('anaheim')
    expect(ae).not.toBeNull()
    expect(ae!.getResource('Money')).toBe(1_000_000)
  })

  it('getDialogue returns null when no NPC dialogue is active', () => {
    applyFixture('minimal-player-only')
    expect(getGameState().getDialogue()).toBeNull()
  })

  it('getScene returns the active scene id and tile dimensions', () => {
    applyFixture('minimal-player-only')
    const scene = getGameState().getScene()
    expect(scene.getId()).toBe('vonBraunCity')
    expect(scene.getDimensions().tilesX).toBeGreaterThan(0)
    expect(scene.getDimensions().tilesY).toBeGreaterThan(0)
  })

  it('SceneView.getBuildings lists Building entities in the active scene', () => {
    applyFixture('minimal-player-only')
    getWorld('vonBraunCity').spawn(
      Building({ typeId: 'drydockBar' }),
      EntityKey({ key: 'bld-test-bar' }),
    )
    const bar = getGameState().getScene().getBuildings().find((b) => b.typeId === 'drydockBar')
    expect(bar, 'spawned drydockBar not surfaced by getBuildings()').toBeTruthy()
    expect(bar!.key).toBe('bld-test-bar')
  })

  it('CharacterView.getHiredRole returns null when the NPC has no EmployedAsCrew', () => {
    applyFixture('amuro-at-recruit-office')
    expect(getGameState().getCharacter('amuro')!.getHiredRole()).toBeNull()
    expect(getGameState().getCharacter('amuro')!.getAssignedShipId()).toBeNull()
  })

  it('FactionView.ownsBuilding returns false for an unowned building key', () => {
    __registerInlineFixtureForTest('faction-only', `{ factions: [{ id: 'anaheim', money: 50 }] }`)
    applyFixture('faction-only')
    const ae = getGameState().getFaction('anaheim')!
    expect(ae.ownsBuilding('bld-vonBraunCity-aeOffice-0')).toBe(false)
  })
})
