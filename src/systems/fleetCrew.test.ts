// Phase 6.2.D — fleetCrew unit tests. The hire / fire / move helpers
// have a small ECS surface area and are easy to drive in a single
// koota world without bootstrapping the full scene graph.
//
// Skipped here (covered by the e2e smoke check-hire-crew.mjs): the
// captain Effect re-emission across save/load, the salary tick's
// money debit, and the cross-scene NPC lookup. Those paths read from
// SCENE_IDS / getWorld which the unit-test layer doesn't wire up.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Character, EntityKey, IsPlayer, Job, Money, Ship, ShipStatSheet,
  ShipEffectsList,
} from '../ecs/traits'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { fleetConfig } from '../config'
import { crewVacancyForShip, hasCaptainVacancy } from './fleetCrew'
import { setBase } from '../stats/sheet'

function spawnPlayer(world: ReturnType<typeof createWorld>, money: number) {
  return world.spawn(
    IsPlayer,
    Character({ name: 'player', color: '#0f0', title: 'player' }),
    Money({ amount: money }),
    EntityKey({ key: 'player' }),
  )
}

function spawnCivilian(world: ReturnType<typeof createWorld>, key: string) {
  return world.spawn(
    Character({ name: key, color: '#fff', title: '市民' }),
    Job({ workstation: null, unemployedSinceMs: 0 }),
    EntityKey({ key }),
  )
}

function spawnShip(world: ReturnType<typeof createWorld>, key: string, templateId: string) {
  const ent = world.spawn(
    Ship({
      templateId,
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 60, accel: 60, decel: 30, angularAccel: 4, maxAngVel: 1.5,
      crCurrent: 100, crMax: 100,
      fuelCurrent: 16, fuelMax: 16,
      suppliesCurrent: 40, suppliesMax: 40,
      dockedAtPoiId: 'vonBraun',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
    }),
    EntityKey({ key }),
  )
  attachShipStatSheet(ent)
  return ent
}

describe('fleet crew helpers (no scene wiring)', () => {
  it('hasCaptainVacancy reads off Ship.assignedCaptainId', () => {
    const w = createWorld()
    const ship = spawnShip(w, 'ship-a', 'lightFreighter')
    expect(hasCaptainVacancy(ship)).toBe(true)
    ship.set(Ship, { ...ship.get(Ship)!, assignedCaptainId: 'npc-crew-1' })
    expect(hasCaptainVacancy(ship)).toBe(false)
  })

  it('crewVacancyForShip = crewRequired - crewIds.length', () => {
    const w = createWorld()
    const ship = spawnShip(w, 'ship-a', 'lightFreighter')
    // lightFreighter crewMax is 4 — the sheet projects from getShipClass
    // via attachShipStatSheet.
    expect(crewVacancyForShip(ship)).toBe(4)
    ship.set(Ship, { ...ship.get(Ship)!, crewIds: ['a', 'b'] })
    expect(crewVacancyForShip(ship)).toBe(2)
  })

  it('crewVacancyForShip clamps at zero when crewIds.length exceeds crewRequired', () => {
    const w = createWorld()
    const ship = spawnShip(w, 'ship-a', 'lightFreighter')
    // Force a small crewRequired so the clamp is exercisable without
    // hiring four NPCs first.
    const ss = ship.get(ShipStatSheet)!
    ship.set(ShipStatSheet, { sheet: setBase(ss.sheet, 'crewRequired', 1) })
    ship.set(Ship, { ...ship.get(Ship)!, crewIds: ['a', 'b'] })
    expect(crewVacancyForShip(ship)).toBe(0)
  })

  it('Ship trait default has empty assignedCaptainId + empty crewIds', () => {
    const w = createWorld()
    const ship = spawnShip(w, 'ship-a', 'lightFreighter')
    const s = ship.get(Ship)!
    expect(s.assignedCaptainId).toBe('')
    expect(s.crewIds).toEqual([])
  })

  it('player + civilian + ship are all spawnable side-by-side without conflicting trait keys', () => {
    const w = createWorld()
    const p = spawnPlayer(w, 100_000)
    const npc = spawnCivilian(w, 'npc-a')
    const ship = spawnShip(w, 'ship-a', 'lightFreighter')
    expect(p.get(Money)!.amount).toBe(100_000)
    expect(npc.get(Character)!.name).toBe('npc-a')
    expect(ship.get(Ship)!.templateId).toBe('lightFreighter')
    expect(ship.has(ShipEffectsList)).toBe(true)
  })

  it('fleetConfig publishes the new D-slice tunables', () => {
    expect(fleetConfig.hireCaptainSigningFee).toBeGreaterThan(0)
    expect(fleetConfig.hireCrewSigningFee).toBeGreaterThan(0)
    expect(fleetConfig.captainDailySalary).toBeGreaterThan(0)
    expect(fleetConfig.crewDailySalary).toBeGreaterThan(0)
    expect(fleetConfig.captainEffectSkill).toBe('engineering')
    expect(fleetConfig.captainEffectStat).toBe('topSpeed')
    expect(fleetConfig.manFromIdlePoolMaxPerClick).toBeGreaterThan(0)
  })
})
