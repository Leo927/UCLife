import json5 from 'json5'
import raw from './orbital-lifts.json5?raw'
import { isSceneId } from './scenes'

// Scene ids are plain strings at the data layer; the ecs/world re-export
// `type SceneId = string` is for consumers further down the stack — the
// data tier can't import from ecs/.
type SceneId = string

// Static metadata about an orbital-lift pair. The lift kiosk positions live
// per-scene as fixedInteractables in scenes.json5 — this catalog only owns
// the (source, dest, duration, fare) economics that are independent of the
// kiosk's tile placement.
export interface OrbitalLift {
  id: string
  labelZh: string
  shortZh: string
  sceneIdA: SceneId
  sceneIdB: SceneId
  durationMin: number
  fare: number
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
  if (l.sceneIdA === l.sceneIdB) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" endpoints must be distinct scenes`)
  }
  if (!Number.isFinite(l.durationMin) || l.durationMin < 0) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" durationMin must be a non-negative number`)
  }
  if (!Number.isFinite(l.fare) || l.fare < 0) {
    throw new Error(`orbital-lifts.json5: lift "${l.id}" fare must be a non-negative number`)
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
