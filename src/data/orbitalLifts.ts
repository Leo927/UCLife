import json5 from 'json5'
import raw from './orbital-lifts.json5?raw'
import { isSceneId } from './scenes'

// Scene ids are plain strings at the data layer; the ecs/world re-export
// `type SceneId = string` is for consumers further down the stack — the
// data tier can't import from ecs/.
type SceneId = string

// Static metadata about an orbital-lift pair. Each row's sceneIdA/sceneIdB
// double as the binding for the per-endpoint `orbitalLift` building (see
// building-types.json5 + spawnLiftBuilding) — spawn looks up which lift
// names the host scene as an endpoint and stamps the kiosk's OrbitalLift
// trait with that liftId. Catalog only owns the (source, dest, duration,
// fare) economics that are independent of the kiosk's tile placement.
// fareUp gates endpoint 'a' (sceneIdA, surface); fareDown gates endpoint 'b'
// (sceneIdB, orbital). sceneIdA may equal sceneIdB — a same-world lift whose
// orbital end is a hidden region of the surface world (the Von Braun drydock);
// the kiosks are then disambiguated by endpoint, not by scene.
export type LiftEndpoint = 'a' | 'b'

export interface OrbitalLift {
  id: string
  labelZh: string
  shortZh: string
  sceneIdA: SceneId
  sceneIdB: SceneId
  durationMin: number
  fareUp: number
  fareDown: number
  description?: string
}

interface OrbitalLiftFile {
  lifts: OrbitalLift[]
}

const parsed = json5.parse(raw) as OrbitalLiftFile

const ids = new Set<string>()
for (const l of parsed.lifts) {
  if (ids.has(l.id)) {
    throw new Error(`orbital-lifts.json5: duplicate lift id "${l.id}"`)
  }
  ids.add(l.id)
  if (!isSceneId(l.sceneIdA)) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" references unknown sceneIdA "${l.sceneIdA}"`)
  }
  if (!isSceneId(l.sceneIdB)) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" references unknown sceneIdB "${l.sceneIdB}"`)
  }
  if (!Number.isFinite(l.durationMin) || l.durationMin < 0) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" durationMin must be a non-negative number`)
  }
  if (!Number.isFinite(l.fareUp) || l.fareUp < 0) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" fareUp must be a non-negative number`)
  }
  if (!Number.isFinite(l.fareDown) || l.fareDown < 0) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" fareDown must be a non-negative number`)
  }
}

export const orbitalLifts: readonly OrbitalLift[] = parsed.lifts

const byId = new Map<string, OrbitalLift>(parsed.lifts.map((l) => [l.id, l]))

export function getOrbitalLift(id: string): OrbitalLift | undefined {
  return byId.get(id)
}

export function isOrbitalLiftId(id: string): boolean {
  return byId.has(id)
}

// Resolve the destination scene from a (lift, source-scene) pair. Returns
// null if the source isn't one of the lift's endpoints — guards against
// kiosks getting spawned in scenes outside the lift's declared pair.
export function liftOtherEndpoint(lift: OrbitalLift, fromSceneId: SceneId): SceneId | null {
  if (fromSceneId === lift.sceneIdA) return lift.sceneIdB
  if (fromSceneId === lift.sceneIdB) return lift.sceneIdA
  return null
}

// Fare to depart a kiosk on this lift — directional by endpoint, since the
// orbital ('b') end is free to leave so the player can never strand themselves
// there for lack of cash. Each kiosk carries its endpoint on the OrbitalLift
// trait (stamped at spawn), which works whether the two ends are in separate
// worlds or folded into one.
export function liftFareForEndpoint(lift: OrbitalLift, endpoint: LiftEndpoint): number {
  return endpoint === 'a' ? lift.fareUp : lift.fareDown
}

// How many kiosks this lift plants in `sceneId`: one per endpoint that names
// the scene, so a same-world lift (sceneIdA === sceneIdB === sceneId) gets two.
export function liftEndpointCountInScene(lift: OrbitalLift, sceneId: SceneId): number {
  return (lift.sceneIdA === sceneId ? 1 : 0) + (lift.sceneIdB === sceneId ? 1 : 0)
}

// All lifts that name `sceneId` as one of their endpoints. spawnLiftBuilding
// pulls from this list and binds each unspawned endpoint to an `orbitalLift`
// building it places in the scene.
export function liftsForScene(sceneId: SceneId): readonly OrbitalLift[] {
  return parsed.lifts.filter((l) => l.sceneIdA === sceneId || l.sceneIdB === sceneId)
}
