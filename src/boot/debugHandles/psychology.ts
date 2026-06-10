// Phase 5.3 — psychology debug handles for deterministic smoke tests:
// fire a cause-tagged public-stance event with the player as actor, and
// inspect a character's psyche through one call.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, getActiveSceneId } from '../../ecs/world'
import { Attributes, Character, EntityKey, IsPlayer } from '../../ecs/traits'
import { applyCauseEvent } from '../../systems/psychology'
import { temperamentOf, sympathiesOf } from '../../character/psychology'
import type { CauseTags } from '../../config/psychology'
import { useClock } from '../../sim/clock'
import type { Entity } from 'koota'

function findCharacterByKey(key: string): Entity | null {
  const world = getWorld(getActiveSceneId())
  for (const e of world.query(Character, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

registerDebugHandle('applyCauseEvent', (causeTags: CauseTags, deedZh: string) => {
  const world = getWorld(getActiveSceneId())
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player in active scene' }
  const reactions = applyCauseEvent({
    actor: player,
    causeTags,
    deedZh,
    nowMs: useClock.getState().gameDate.getTime(),
  })
  return { ok: true, reactions }
})

registerDebugHandle('psycheOf', (npcKey: string) => {
  const npc = findCharacterByKey(npcKey)
  if (!npc || !npc.has(Attributes)) return null
  return {
    temperament: temperamentOf(npc),
    sympathies: sympathiesOf(npc.get(Attributes)!.sheet),
  }
})
