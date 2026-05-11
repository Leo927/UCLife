import type { World } from 'koota'
import {
  Position, MoveTarget, Action, IsPlayer, QueuedTalk, Character, Health,
} from '../ecs/traits'
import { emitSim } from '../sim/events'
import { worldConfig } from '../config'

const TALK_RANGE = worldConfig.ranges.playerInteract
// Re-target threshold: only reissue MoveTarget if the NPC has moved more than
// this many pixels from the player's current MoveTarget. Avoids re-running
// findPath() on every tick while the NPC stands still or jitters.
const RETARGET_PX = worldConfig.holdMoveRetargetPx

export function talkSystem(world: World) {
  const players = world.query(IsPlayer, Position, QueuedTalk)
  for (const player of players) {
    const queued = player.get(QueuedTalk)!
    const target = queued.target
    if (!target) {
      player.remove(QueuedTalk)
      continue
    }
    const targetInfo = target.get(Character)
    const targetPos = target.get(Position)
    const targetHealth = target.get(Health)
    if (!targetInfo || !targetPos || targetHealth?.dead) {
      player.remove(QueuedTalk)
      continue
    }
    const pos = player.get(Position)!
    const dist = Math.hypot(pos.x - targetPos.x, pos.y - targetPos.y)
    if (dist <= TALK_RANGE) {
      const action = player.get(Action)
      if (action && action.kind !== 'idle' && action.kind !== 'walking') continue
      // Snap MoveTarget to the player's current position so movementSystem
      // stops the walk on the next tick — otherwise the player keeps drifting
      // toward the NPC's stale position while the dialog is open.
      player.set(MoveTarget, { x: pos.x, y: pos.y })
      player.remove(QueuedTalk)
      emitSim('ui:open-dialog-npc', { entity: target })
      continue
    }
    const cur = player.get(MoveTarget)
    if (!cur || Math.hypot(cur.x - targetPos.x, cur.y - targetPos.y) > RETARGET_PX) {
      player.set(MoveTarget, { x: targetPos.x, y: targetPos.y })
    }
  }
}
