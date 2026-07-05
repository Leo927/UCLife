// Public ECS→render contract for the space (system-map) renderer.

import type { CelestialKind } from '../data/celestialBodies'
import type { Poi } from '../data/pois'

export interface BodySnapshot {
  x: number; y: number
  bodyId: string; nameZh: string
  radius: number; kind: CelestialKind
}
export interface PoiSnapshot {
  x: number; y: number
  poi: Poi
}
export interface ShipSnapshot {
  x: number; y: number; vx: number; vy: number
  course: {
    tx: number; ty: number
    destPoiId: string | null
    destEnemyKey: string | null
    active: boolean
  } | null
}
export interface EnemyShipSnapshot {
  /** Persistent key from EntityKey trait — used to dedupe DisplayObjects across frames. */
  key: string
  x: number; y: number; vx: number; vy: number
  shipClassId: string
  mode: 'patrol' | 'idle' | 'chase' | 'flee'
}
/** A diegetic transit line connecting two POIs — used to render the orbital
 * elevator between a surface POI and its orbital companion. Endpoints are
 * resolved against the POIs' live positions each frame so they drift with
 * the orbit. */
export interface LiftLineSnapshot {
  liftId: string
  x1: number; y1: number
  x2: number; y2: number
}
export interface SpaceSnapshot {
  bodies: BodySnapshot[]
  pois: PoiSnapshot[]
  /** Orbital-elevator visualisations. Empty when no lift's endpoint POIs are
   *  both on-screen (or when the lift catalog is empty). */
  liftLines: LiftLineSnapshot[]
  enemies: EnemyShipSnapshot[]
  ship: ShipSnapshot | null
  /** World-space dock-snap radius (POI panel + course-snap target). */
  dockSnapRadius: number
  /** Camera target — usually the ship; in fit-mode this is overridden. */
  fitMode: boolean
  /** When fit-mode is on, the precomputed transform. */
  fit: { scale: number; cx: number; cy: number } | null
  /** Course preview line endpoint (resolved against live POI position). */
  coursePreview: { fromX: number; fromY: number; toX: number; toY: number } | null
  /** POI under the panel (highlighted with a snap-radius ring). */
  hoveredPoiId: string | null
  /** Real elapsed seconds since previous update — used by particle systems. */
  dtSec: number
}
