// Issue #144 — relation debug handles for deterministic smoke tests:
// apply an event-shaped opinion delta through the shared write path
// (applyOpinionDelta) and inspect the acknowledgement queues on an NPC's
// edge to the player.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, getActiveSceneId } from '../../ecs/world'
import { Character, EntityKey, IsPlayer, Knows } from '../../ecs/traits'
import { applyOpinionDelta } from '../../systems/relations'
import { useClock } from '../../sim/clock'
import type { Entity } from 'koota'

function findCharacterByKey(key: string): Entity | null {
  const world = getWorld(getActiveSceneId())
  for (const e of world.query(Character, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

// Raw entity getter so smoke tests can hand the entity to
// uclifeUI.setDialogNPC (the established dialog-open pattern, see
// fleet-supply.spec.ts).
registerDebugHandle('characterEntityByKey', (key: string) => findCharacterByKey(key))

registerDebugHandle('applyOpinionDelta', (npcKey: string, delta: number, deedZh: string) => {
  const world = getWorld(getActiveSceneId())
  const npc = findCharacterByKey(npcKey)
  const player = world.queryFirst(IsPlayer)
  if (!npc) return { ok: false, reason: `no character with key "${npcKey}" in active scene` }
  if (!player) return { ok: false, reason: 'no player in active scene' }
  const applied = applyOpinionDelta(
    npc, player, delta,
    { actorName: player.get(Character)?.name ?? '玩家', deedZh },
    useClock.getState().gameDate.getTime(),
  )
  return { ok: true, applied }
})

registerDebugHandle('relationToPlayer', (npcKey: string) => {
  const world = getWorld(getActiveSceneId())
  const npc = findCharacterByKey(npcKey)
  const player = world.queryFirst(IsPlayer)
  if (!npc || !player || !npc.has(Knows(player))) return null
  const e = npc.get(Knows(player))!
  return {
    opinion: e.opinion,
    grievances: e.grievances.map((r) => ({ ...r, cause: { ...r.cause } })),
    credits: e.credits.map((r) => ({ ...r, cause: { ...r.cause } })),
  }
})
