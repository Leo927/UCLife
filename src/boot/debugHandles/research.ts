// Phase 5.5.6 research debug surface. Lets the smoke suite install a
// researcher, queue research, drive the day-rollover system, and verify
// completion + unlock + lost-overflow without driving the dialogue UI.

import type { Entity } from 'koota'
import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  Building, Character, EntityKey, IsPlayer, Job, Owner, Position, Workstation,
  Faction, FactionResearch,
} from '../../ecs/traits'
import {
  cancelHead, dequeueResearch, enqueueResearch, plannerView,
  reorderQueue, researchSystem,
} from '../../systems/research'
import { hasFactionUnlock, getFactionUnlocks } from '../../ecs/factionEffects'
import { gameDayNumber, useClock } from '../../sim/clock'

interface InstallResult {
  ok: boolean
  reason?: string
  researcherName?: string
}

// Find the player-owned researchLab's researcher workstation. Returns
// null if the player doesn't own a researchLab yet.
function findOwnedResearcherStation(player: Entity): Entity | null {
  for (const b of world.query(Building, Owner)) {
    if (b.get(Building)!.typeId !== 'researchLab') continue
    const o = b.get(Owner)!
    if (o.kind !== 'character' || o.entity !== player) continue
    const bld = b.get(Building)!
    for (const ws of world.query(Workstation, Position)) {
      if (ws.get(Workstation)!.specId !== 'researcher') continue
      const pos = ws.get(Position)!
      if (pos.x < bld.x || pos.x >= bld.x + bld.w) continue
      if (pos.y < bld.y || pos.y >= bld.y + bld.h) continue
      return ws
    }
  }
  return null
}

registerDebugHandle('factionInstallResearcher', (): InstallResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedResearcherStation(player)
  if (!ws) return { ok: false, reason: 'no player-owned research lab' }
  const wsT = ws.get(Workstation)!
  if (wsT.occupant !== null) {
    return { ok: true, researcherName: wsT.occupant.get(Character)?.name ?? '已就职' }
  }
  // Pick an idle civilian (mirrors the secretary / recruiter install shape).
  let pick: Entity | null = null
  for (const c of world.query(Character, EntityKey)) {
    if (c.has(IsPlayer)) continue
    const j = c.get(Job)
    if (j?.workstation) continue
    pick = c
    break
  }
  if (!pick) return { ok: false, reason: 'no eligible civilians' }
  ws.set(Workstation, { ...wsT, occupant: pick })
  pick.set(Job, { workstation: ws, unemployedSinceMs: 0 })
  return { ok: true, researcherName: pick.get(Character)?.name ?? '未命名' }
})

function findCivilianResearchFaction(): Entity | null {
  for (const e of world.query(Faction, FactionResearch)) {
    if (e.get(Faction)!.id === 'civilian') return e
  }
  return null
}

registerDebugHandle('researchEnqueue', (researchId: string): { ok: boolean; reason?: string } => {
  const f = findCivilianResearchFaction()
  if (!f) return { ok: false, reason: 'no civilian faction' }
  if (!enqueueResearch(f, researchId)) return { ok: false, reason: 'enqueue rejected' }
  return { ok: true }
})

registerDebugHandle('researchCancelHead', (): { ok: boolean; reason?: string } => {
  const f = findCivilianResearchFaction()
  if (!f) return { ok: false, reason: 'no civilian faction' }
  if (!cancelHead(f)) return { ok: false, reason: 'queue empty' }
  return { ok: true }
})

registerDebugHandle('researchDequeue', (id: string): { ok: boolean; reason?: string } => {
  const f = findCivilianResearchFaction()
  if (!f) return { ok: false, reason: 'no civilian faction' }
  if (!dequeueResearch(f, id)) return { ok: false, reason: 'not in non-head position' }
  return { ok: true }
})

registerDebugHandle('researchReorder', (from: number, to: number): { ok: boolean; reason?: string } => {
  const f = findCivilianResearchFaction()
  if (!f) return { ok: false, reason: 'no civilian faction' }
  if (!reorderQueue(f, from, to)) return { ok: false, reason: 'reorder rejected' }
  return { ok: true }
})

registerDebugHandle('researchPlannerView', () => {
  const f = findCivilianResearchFaction()
  if (!f) return null
  return plannerView(f)
})

registerDebugHandle('forceResearchTick', (gameDay?: number) => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  return { day, ...researchSystem(world, day) }
})

registerDebugHandle('factionUnlocks', (): string[] => {
  const f = findCivilianResearchFaction()
  if (!f) return []
  return getFactionUnlocks(f).slice()
})

registerDebugHandle('factionHasUnlock', (id: string): boolean => {
  const f = findCivilianResearchFaction()
  if (!f) return false
  return hasFactionUnlock(f, id)
})
