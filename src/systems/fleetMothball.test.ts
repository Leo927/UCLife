// Phase 6.2.G — mothball verb side-effect tests. Pure-koota, no clock /
// loop. Spawns ships with hand-crafted Ship trait state, exercises the
// setShipMothballed transitions and asserts the IsInActiveFleet +
// formationSlot side effects.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Ship, IsFlagshipMark, IsInActiveFleet, EntityKey,
} from '../ecs/traits'
import { setShipMothballed } from './fleetMothball'

function spawnShip(world: ReturnType<typeof createWorld>, key: string, opts: {
  flagship?: boolean
  inActiveFleet?: boolean
  formationSlot?: number
  transitDest?: string
  mothballed?: boolean
} = {}) {
  const ent = world.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100,
      fuelCurrent: 0, fuelMax: 16,
      suppliesCurrent: 0, suppliesMax: 40,
      dockedAtPoiId: 'vonBraun',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      mothballed: opts.mothballed ?? false,
      formationSlot: opts.formationSlot ?? -1,
      transitDestinationId: opts.transitDest ?? '',
    }),
    EntityKey({ key }),
  )
  if (opts.flagship) ent.add(IsFlagshipMark)
  if (opts.inActiveFleet) ent.add(IsInActiveFleet)
  return ent
}

describe('setShipMothballed', () => {
  it('mothballs a non-flagship ship and clears IsInActiveFleet + formationSlot', () => {
    const w = createWorld()
    const ship = spawnShip(w, 's1', { inActiveFleet: true, formationSlot: 4 })
    const r = setShipMothballed(ship, true)
    expect(r.ok).toBe(true)
    expect(ship.get(Ship)!.mothballed).toBe(true)
    expect(ship.get(Ship)!.formationSlot).toBe(-1)
    expect(ship.has(IsInActiveFleet)).toBe(false)
  })

  it('refuses to mothball the flagship', () => {
    const w = createWorld()
    const ship = spawnShip(w, 'flagship', { flagship: true, inActiveFleet: true })
    const r = setShipMothballed(ship, true)
    expect(r).toEqual({ ok: false, reason: 'flagship_locked' })
    expect(ship.get(Ship)!.mothballed).toBe(false)
    expect(ship.has(IsInActiveFleet)).toBe(true)
  })

  it('refuses to mothball a ship in cross-POI transit', () => {
    const w = createWorld()
    const ship = spawnShip(w, 's1', { transitDest: 'granada' })
    const r = setShipMothballed(ship, true)
    expect(r).toEqual({ ok: false, reason: 'in_transit' })
    expect(ship.get(Ship)!.mothballed).toBe(false)
  })

  it('refuses to mothball an already-mothballed ship', () => {
    const w = createWorld()
    const ship = spawnShip(w, 's1', { mothballed: true })
    const r = setShipMothballed(ship, true)
    expect(r).toEqual({ ok: false, reason: 'already_in_state' })
  })

  it('un-mothballs a mothballed ship; does NOT auto-add IsInActiveFleet', () => {
    const w = createWorld()
    const ship = spawnShip(w, 's1', { mothballed: true })
    const r = setShipMothballed(ship, false)
    expect(r.ok).toBe(true)
    expect(ship.get(Ship)!.mothballed).toBe(false)
    expect(ship.has(IsInActiveFleet)).toBe(false)
  })

  it('refuses to un-mothball an operational ship', () => {
    const w = createWorld()
    const ship = spawnShip(w, 's1')
    const r = setShipMothballed(ship, false)
    expect(r).toEqual({ ok: false, reason: 'already_in_state' })
  })
})
