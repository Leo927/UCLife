// W4.1 — crew duty resolution. Pure schedule logic (underway + hour →
// duty), plus the flagship-underway ECS read.

import { describe, it, expect, beforeEach } from 'vitest'
import { resolveCrewDuty, isFlagshipUnderway } from './crewDuty'
import { crewConfig } from '../config'
import { getWorld } from '../ecs/world'
import { Ship, EntityKey, IsFlagshipMark } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { fleetConfig } from '../config'

describe('resolveCrewDuty — schedule precedence', () => {
  it('underway wins outright, regardless of the clock', () => {
    for (const hour of [3, 7, 12, 22, 23]) {
      expect(resolveCrewDuty(true, hour), `underway at ${hour}:00 mans the station`).toBe('station')
    }
  })

  it('docked → mess inside a meal window', () => {
    for (const w of crewConfig.duty.mealWindows) {
      expect(resolveCrewDuty(false, w.startHour), `mess at ${w.startHour}:00`).toBe('mess')
    }
  })

  it('docked → quarters inside the (midnight-wrapping) sleep window', () => {
    expect(resolveCrewDuty(false, 23), 'late night → quarters').toBe('quarters')
    expect(resolveCrewDuty(false, 2), 'small hours → quarters').toBe('quarters')
  })

  it('docked outside every window → offDuty (falls through to drives)', () => {
    expect(resolveCrewDuty(false, 10), 'mid-morning is off-duty').toBe('offDuty')
    // Meal window end is exclusive — 08:00 is no longer breakfast.
    expect(resolveCrewDuty(false, 8), 'meal end hour is exclusive').toBe('offDuty')
  })
})

describe('isFlagshipUnderway', () => {
  const SHIP = 'playerShipInterior'
  beforeEach(() => { getWorld(SHIP).reset() })

  function spawnFlagship(dockedAtPoiId: string) {
    const cls = getShipClass('lightFreighter')
    return getWorld(SHIP).spawn(
      Ship({
        templateId: cls.id, name: 'F',
        hullCurrent: cls.hullMax, hullMax: cls.hullMax,
        armorCurrent: cls.armorMax, armorMax: cls.armorMax,
        fluxMax: cls.fluxMax, fluxCurrent: 0, fluxDissipation: cls.fluxDissipation,
        hasShield: cls.hasShield, shieldEfficiency: cls.shieldEfficiency,
        topSpeed: cls.topSpeed, accel: cls.accel, decel: cls.decel,
        angularAccel: cls.angularAccel, maxAngVel: cls.maxAngVel,
        crCurrent: cls.crMax, crMax: cls.crMax,
        dockedAtPoiId, fleetPos: { x: 0, y: 0 }, inCombat: false,
        aggression: fleetConfig.aggressionDefault,
        formationSlot: fleetConfig.activeFleetGrid.flagshipSlot,
      }),
      EntityKey({ key: 'f1' }),
      IsFlagshipMark,
    )
  }

  it('is underway when the flagship is not docked at a POI', () => {
    spawnFlagship('')
    expect(isFlagshipUnderway(getWorld(SHIP))).toBe(true)
  })

  it('is not underway when the flagship is docked', () => {
    spawnFlagship('vonBraun')
    expect(isFlagshipUnderway(getWorld(SHIP))).toBe(false)
  })

  it('is not underway when there is no flagship', () => {
    expect(isFlagshipUnderway(getWorld(SHIP))).toBe(false)
  })
})
