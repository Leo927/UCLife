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
  course: { tx: number; ty: number; destPoiId: string | null; active: boolean } | null
}
export interface EnemyShipSnapshot {
  /** Persistent key from EntityKey trait — used to dedupe DisplayObjects across frames. */
  key: string
  x: number; y: number; vx: number; vy: number
  shipClassId: string
  mode: 'patrol' | 'idle' | 'chase' | 'flee'
}
export interface SpaceSnapshot {
  bodies: BodySnapshot[]
  pois: PoiSnapshot[]
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
