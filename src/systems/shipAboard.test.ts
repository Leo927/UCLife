// Phase 6.2.5 — unit tests for the MS-aboard carrier mechanic.
// Entity-based helpers (assignShipToCarrierBay) are tested with a
// local koota world. World-dependent helpers (countShipsAboard,
// findCarrierSlotForShip, releaseShipsFromCarrier) are covered by the
// e2e smoke layer where the full scene graph is initialized.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Ship, EntityKey } from '../ecs/traits'
import { assignShipToCarrierBay } from './shipDelivery'

function spawnShip(
  world: ReturnType<typeof createWorld>,
  key: string,
  opts: { storedAboardShipKey?: string; dockedAtPoiId?: string } = {},
) {
  return world.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 60, accel: 60, decel: 30, angularAccel: 4, maxAngVel: 1.5,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: opts.dockedAtPoiId ?? 'vonBraun',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      storedAboardShipKey: opts.storedAboardShipKey ?? '',
    }),
    EntityKey({ key }),
  )
}

describe('assignShipToCarrierBay', () => {
  it('sets storedAboardShipKey on the stored ship to the carrier key', () => {
    const w = createWorld()
    const carrier = spawnShip(w, 'carrier-1')
    const ms = spawnShip(w, 'ms-1')

    assignShipToCarrierBay(ms, carrier)

    expect(ms.get(Ship)!.storedAboardShipKey).toBe('carrier-1')
    // carrier is unchanged
    expect(carrier.get(Ship)!.storedAboardShipKey).toBe('')
  })

  it('overwrites an existing storedAboardShipKey (re-assignment)', () => {
    const w = createWorld()
    const carrierA = spawnShip(w, 'carrier-a')
    const carrierB = spawnShip(w, 'carrier-b')
    const ms = spawnShip(w, 'ms-1', { storedAboardShipKey: 'carrier-a' })

    assignShipToCarrierBay(ms, carrierB)

    expect(ms.get(Ship)!.storedAboardShipKey).toBe('carrier-b')
    void carrierA
  })

  it('no-ops when the carrier entity has no EntityKey', () => {
    const w = createWorld()
    // carrier spawned without EntityKey
    const carrier = w.spawn(
      Ship({
        templateId: 'lightFreighter',
        hullCurrent: 800, hullMax: 800,
        armorCurrent: 200, armorMax: 200,
        fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
        hasShield: false, shieldEfficiency: 1,
        topSpeed: 60, accel: 60, decel: 30, angularAccel: 4, maxAngVel: 1.5,
        crCurrent: 100, crMax: 100,
        dockedAtPoiId: 'vonBraun',
        fleetPos: { x: 0, y: 0 },
        inCombat: false,
        storedAboardShipKey: '',
      }),
    )
    const ms = spawnShip(w, 'ms-1')

    assignShipToCarrierBay(ms, carrier)

    // no key on carrier → storedAboardShipKey stays ''
    expect(ms.get(Ship)!.storedAboardShipKey).toBe('')
  })

  it('no-ops when the stored-ship entity has no Ship trait', () => {
    const w = createWorld()
    const carrier = spawnShip(w, 'carrier-1')
    const nonShip = w.spawn(EntityKey({ key: 'non-ship' }))

    // Should not throw
    assignShipToCarrierBay(nonShip, carrier)

    expect(nonShip.get(Ship)).toBeUndefined()
  })
})
