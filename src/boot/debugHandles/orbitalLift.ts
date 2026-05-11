// Phase 6.2.A.2 orbital-lift debug handles. Lets the smoke suite enumerate
// the lift kiosks per scene and trigger the cross-scene transit without
// driving the player through real-time pathfinding. Mirrors the per-scene
// shape of listHangars / hangarManagerEntity at 6.2.A.1.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, getActiveSceneId, type SceneId } from '../../ecs/world'
import { IsPlayer, Money, OrbitalLift, Position } from '../../ecs/traits'
import { getOrbitalLift, liftOtherEndpoint, orbitalLifts } from '../../data/orbitalLifts'
import { useClock } from '../../sim/clock'
import { migratePlayerToScene } from '../../sim/scene'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

interface OrbitalLiftSnapshot {
  liftId: string
  sceneId: SceneId
  posTile: { x: number; y: number }
  fare: number
  durationMin: number
  destSceneId: SceneId | null
}

registerDebugHandle('listOrbitalLifts', (sceneIdOverride?: SceneId): OrbitalLiftSnapshot[] => {
  const sceneId = sceneIdOverride ?? getActiveSceneId()
  const out: OrbitalLiftSnapshot[] = []
  const w = getWorld(sceneId)
  for (const ent of w.query(OrbitalLift, Position)) {
    const ol = ent.get(OrbitalLift)!
    const p = ent.get(Position)!
    const lift = getOrbitalLift(ol.liftId)
    if (!lift) continue
    out.push({
      liftId: ol.liftId,
      sceneId,
      posTile: { x: Math.round(p.x / TILE), y: Math.round(p.y / TILE) },
      fare: lift.fare,
      durationMin: lift.durationMin,
      destSceneId: liftOtherEndpoint(lift, sceneId),
    })
  }
  return out
})

registerDebugHandle('orbitalLiftCatalog', () => orbitalLifts.map((l) => ({ ...l })))

// Deterministic transit driver — same flow the interaction system runs,
// minus the visual fade. Charges fare, advances clock by durationMin, and
// migrates the player to the kiosk on the other end. Returns the resolved
// destination sceneId or null on failure (insufficient funds, bad liftId,
// no paired kiosk on the destination scene).
registerDebugHandle('runOrbitalLift', (liftId: string): SceneId | null => {
  const lift = getOrbitalLift(liftId)
  if (!lift) return null
  const fromSceneId = getActiveSceneId()
  const destSceneId = liftOtherEndpoint(lift, fromSceneId)
  if (!destSceneId) return null

  const fromWorld = getWorld(fromSceneId)
  const player = fromWorld.queryFirst(IsPlayer)
  if (!player) return null

  if (lift.fare > 0) {
    const m = player.get(Money)
    if (!m || m.amount < lift.fare) return null
    player.set(Money, { amount: m.amount - lift.fare })
  }

  const destWorld = getWorld(destSceneId)
  let arrivalPx: { x: number; y: number } | null = null
  for (const ent of destWorld.query(OrbitalLift, Position)) {
    const ol = ent.get(OrbitalLift)!
    if (ol.liftId !== liftId) continue
    const p = ent.get(Position)!
    arrivalPx = { x: p.x, y: p.y + TILE }
    break
  }
  if (!arrivalPx) return null

  useClock.getState().advance(lift.durationMin)
  migratePlayerToScene(destSceneId, arrivalPx)
  return destSceneId
})
