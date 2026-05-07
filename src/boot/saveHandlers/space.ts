// Continuous-space snapshot for the spaceCampaign world. Bodies and
// POIs are derived from data + the game-clock so they're never
// persisted; only the player ship's physics state and each enemy's
// mutable AI state round-trip. Patrol paths come from data — only
// index + mode round-trip.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import {
  IsPlayer, Position, Velocity, Course, AtHelm, EnemyAI, ShipBody,
  EntityKey,
} from '../../ecs/traits'

const SPACE_SCENE_ID: SceneId = 'spaceCampaign'

interface SpaceBlock {
  player: {
    pos: { x: number; y: number }
    vel: { vx: number; vy: number }
    course: {
      tx: number; ty: number; destPoiId: string | null; active: boolean
      autoDock?: boolean
    }
    atHelm: boolean
  }
  enemies: {
    key: string
    pos: { x: number; y: number }
    vel: { vx: number; vy: number }
    mode: 'patrol' | 'idle' | 'chase' | 'flee'
    patrolIdx: number
  }[]
}

function snapshotSpace(): SpaceBlock | undefined {
  const w = getWorld(SPACE_SCENE_ID)
  const player = w.queryFirst(IsPlayer, ShipBody)
  if (!player) return undefined

  const pos = player.get(Position)!
  const vel = player.get(Velocity)!
  const course = player.get(Course)!
  const atHelm = player.has(AtHelm)

  const enemies: SpaceBlock['enemies'] = []
  for (const e of w.query(EnemyAI, Position, Velocity, EntityKey)) {
    const k = e.get(EntityKey)!.key
    if (!k.startsWith('enemy-')) continue
    const ai = e.get(EnemyAI)!
    const ep = e.get(Position)!
    const ev = e.get(Velocity)!
    enemies.push({
      key: k,
      pos: { x: ep.x, y: ep.y },
      vel: { vx: ev.vx, vy: ev.vy },
      mode: ai.mode,
      patrolIdx: ai.patrolIdx,
    })
  }

  return {
    player: {
      pos: { x: pos.x, y: pos.y },
      vel: { vx: vel.vx, vy: vel.vy },
      course: {
        tx: course.tx, ty: course.ty, destPoiId: course.destPoiId,
        active: course.active, autoDock: course.autoDock,
      },
      atHelm,
    },
    enemies,
  }
}

function restoreSpace(block: SpaceBlock): void {
  const w = getWorld(SPACE_SCENE_ID)

  const player = w.queryFirst(IsPlayer, ShipBody)
  if (player) {
    player.set(Position, { x: block.player.pos.x, y: block.player.pos.y })
    player.set(Velocity, { vx: block.player.vel.vx, vy: block.player.vel.vy })
    player.set(Course, {
      tx: block.player.course.tx,
      ty: block.player.course.ty,
      destPoiId: block.player.course.destPoiId,
      active: block.player.course.active,
      autoDock: block.player.course.autoDock ?? false,
    })
    if (block.player.atHelm && !player.has(AtHelm)) player.add(AtHelm)
    else if (!block.player.atHelm && player.has(AtHelm)) player.remove(AtHelm)
  }

  const byKey = new Map<string, ReturnType<typeof w.queryFirst>>()
  for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)

  for (const snap of block.enemies) {
    const e = byKey.get(snap.key)
    if (!e) continue
    e.set(Position, { x: snap.pos.x, y: snap.pos.y })
    e.set(Velocity, { vx: snap.vel.vx, vy: snap.vel.vy })
    const ai = e.get(EnemyAI)
    if (ai) {
      e.set(EnemyAI, { ...ai, mode: snap.mode, patrolIdx: snap.patrolIdx })
    }
  }
}

registerSaveHandler<SpaceBlock>({
  id: 'space',
  snapshot: snapshotSpace,
  restore: restoreSpace,
  // No reset — bootstrapSpaceCampaign already seeds defaults during
  // resetWorld(). Missing block ⇒ player ship at docked POI t=0
  // position, enemies at data-driven spawns.
})
