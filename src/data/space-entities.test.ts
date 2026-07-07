import { describe, it, expect } from 'vitest'
import { SPACE_ENTITIES, getSpaceEntity } from './space-entities'
import { getEnemyShip } from './enemyShips'
import { POIS } from './pois'
import { CELESTIAL_BODIES } from './celestialBodies'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'

// Regression test for W1 Task 7 finding 1: the uniform 5x aggroRadius scale
// left every near-moon patrol's circle covering Von Braun's dock anchor at
// once, so a freshly-undocked ship triggered the whole cluster into chase
// simultaneously (a multi-group ambush at the home port). The invariant:
// at most one authored enemy group may cover any dockable POI's t=0 anchor,
// and every excluded group must miss by a real margin, not a hairline.
//
// t=0 here is literal sim time zero (the orbital angle each body/POI starts
// at), matching the "at game start" framing authored in space-entities.json5
// — not useClock's live gameDate, which carries an unrelated year-encoding
// quirk in sim/clock.ts's startDate().
const T_ZERO_DAYS = 0

// Below this fraction of the covering distance, an "excluded" circle counts
// as a hairline miss — orbits move, so real margin matters more than a
// literal non-overlap at the single instant t=0.
const MIN_EXCLUSION_MARGIN_RATIO = 0.2

const bodyById = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))

const resolveBody: ParentResolver = (id: string): OrbitalParams | undefined => {
  const b = bodyById.get(id)
  if (!b) return undefined
  return {
    parentId: b.parentId ?? null,
    pos: b.pos,
    orbitRadius: b.orbitRadius,
    orbitPeriodDays: b.orbitPeriodDays,
    orbitPhase: b.orbitPhase,
  }
}

function derivedPoiPosAt(poi: (typeof POIS)[number], tDays: number) {
  const params: OrbitalParams = {
    parentId: poi.bodyId,
    orbitRadius: poi.orbitRadius,
    orbitPeriodDays: poi.orbitPeriodDays,
    orbitPhase: poi.orbitPhase,
  }
  return derivedPos(params, tDays, resolveBody)
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('space-entities aggro coverage at dockable POIs (t=0)', () => {
  const dockablePois = POIS.filter((p) => p.dockScenes && p.dockScenes.length > 0)

  it('has at least one dockable POI to check (sanity)', () => {
    expect(dockablePois.length).toBeGreaterThan(0)
  })

  it.each(dockablePois.map((p) => [p.id, p] as const))(
    '%s: at most one authored enemy group covers the dock anchor at t=0',
    (_id, poi) => {
      const anchor = derivedPoiPosAt(poi, T_ZERO_DAYS)
      const distances = SPACE_ENTITIES.map((e) => ({
        id: e.id,
        distance: dist(anchor, e.spawn),
        aggroRadius: e.aggroRadius,
      }))
      const covering = distances.filter((d) => d.distance <= d.aggroRadius)

      expect(
        covering.length,
        `home-port undock at "${poi.id}" must not be a multi-group ambush: ` +
          `expected at most 1 authored group covering the t=0 anchor, got ` +
          `${covering.length} (${covering.map((c) => `${c.id}@${c.distance.toFixed(0)}px<=${c.aggroRadius}px`).join(', ')})`,
      ).toBeLessThanOrEqual(1)

      const hairlineMisses = distances.filter((d) => {
        if (d.distance <= d.aggroRadius) return false
        const margin = (d.distance - d.aggroRadius) / d.distance
        return margin < MIN_EXCLUSION_MARGIN_RATIO
      })

      expect(
        hairlineMisses.length,
        `"${poi.id}" has a group excluded by a hairline (< ${MIN_EXCLUSION_MARGIN_RATIO * 100}% ` +
          `distance margin) — orbits move, so a near-miss today becomes coverage tomorrow: ` +
          `${hairlineMisses.map((c) => `${c.id}@${c.distance.toFixed(0)}px vs aggro=${c.aggroRadius}px`).join(', ')}`,
      ).toBe(0)
    },
  )
})

// W3 (ms-identity) Task 2 — hostile MS group complements. authored onto a
// handful of shoal-zone / outer-belt groups; the Von Braun starter picket
// must stay a solo, winnable-day-one fight (no escorts, no MS wingmen).
describe('space-entities MS complements', () => {
  it('authors msComplement onto at least 2 groups', () => {
    const withComplement = SPACE_ENTITIES.filter((e) => (e.msComplement?.length ?? 0) > 0)
    expect(withComplement.length).toBeGreaterThanOrEqual(2)
  })

  it('every msComplement id resolves to an isMs enemyShips row', () => {
    for (const e of SPACE_ENTITIES) {
      for (const msId of e.msComplement ?? []) {
        expect(getEnemyShip(msId).isMs, `${e.id} msComplement "${msId}" must be isMs`).toBe(true)
      }
    }
  })

  it('the vonBraun starter picket stays a solo fight (no escorts, no MS complement)', () => {
    const starter = getSpaceEntity('pirate-lunar-starter')
    expect(starter, 'pirate-lunar-starter must exist').toBeTruthy()
    expect(starter!.escorts ?? [], 'starter picket must have no escorts').toEqual([])
    expect(starter!.msComplement ?? [], 'starter picket must have no MS complement').toEqual([])
  })
})
