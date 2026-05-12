// Physiology debug handles. Lets smoke tests force-onset a condition
// on the player, advance the day-rollover phase tick deterministically,
// and inspect Conditions / Effects without going through the canvas.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { useClock, gameDayNumber } from '../../sim/clock'
import {
  IsPlayer, Conditions, Effects, Attributes, Active, Position, Character, EntityKey,
} from '../../ecs/traits'
import { forceOnset, physiologySystem, diagnoseCondition, commitTreatment } from '../../systems/physiology'
import { contagionSystem, resetContagion } from '../../systems/contagion'
import { spawnNPC } from '../../character/spawn'
import { getStat } from '../../stats/sheet'
import type { StatId } from '../../stats/schema'
import { worldConfig } from '../../config'

registerDebugHandle('physiologyForceOnset', (templateId: string, source = '调试', bodyPart: string | null = null) => {
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return null
  const day = gameDayNumber(useClock.getState().gameDate)
  const inst = forceOnset(player, templateId, source, day, bodyPart)
  return inst ? { ...inst, activeBands: [...inst.activeBands] } : null
})

registerDebugHandle('physiologyTickDay', (steps = 1) => {
  // Each call: advance the game-clock by 24h, fire the phase tick,
  // return the resulting condition list.
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return null
  for (let i = 0; i < steps; i++) {
    useClock.getState().advance(24 * 60)  // one game-day
    const day = gameDayNumber(useClock.getState().gameDate)
    physiologySystem(world, day)
  }
  const cond = player.get(Conditions)!
  return cond.list.map((c) => ({ ...c, activeBands: [...c.activeBands] }))
})

registerDebugHandle('physiologyDiagnose', (instanceId: string) => {
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return false
  const day = gameDayNumber(useClock.getState().gameDate)
  return diagnoseCondition(player, instanceId, day)
})

registerDebugHandle('physiologyCommitTreatment', (instanceId: string, tier: number, expiresInDays: number | null) => {
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return false
  const day = gameDayNumber(useClock.getState().gameDate)
  return commitTreatment(player, instanceId, tier, expiresInDays === null ? null : day + expiresInDays)
})

registerDebugHandle('getConditions', () => {
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return []
  return player.get(Conditions)!.list.map((c) => ({ ...c, activeBands: [...c.activeBands] }))
})

registerDebugHandle('getEffectsList', () => {
  const player = world.queryFirst(IsPlayer, Effects)
  if (!player) return []
  return player.get(Effects)!.list.map((e) => ({
    ...e,
    modifiers: e.modifiers.map((m) => ({ ...m })),
  }))
})

registerDebugHandle('getPlayerStatValue', (statId: string) => {
  const player = world.queryFirst(IsPlayer, Attributes)
  if (!player) return null
  return getStat(player.get(Attributes)!.sheet, statId as StatId)
})

// Phase 4.2 — contagion smoke handles. Spawn an NPC next to the player,
// optionally onset a condition on it, and step the contagion tick to
// drive transmission. Returns the spawned NPC's EntityKey so the smoke
// can poll its condition list.
registerDebugHandle('physiologySpawnInfectedNPC', (
  templateId: string,
  name = '感染者',
  dxTiles = 0.5,
  dyTiles = 0,
) => {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return null
  const ppos = player.get(Position)!
  const key = `contagion-debug-${Math.random().toString(36).slice(2, 8)}`
  const npc = spawnNPC(world, {
    name,
    color: '#bf6a3a',
    x: ppos.x + dxTiles * worldConfig.tilePx,
    y: ppos.y + dyTiles * worldConfig.tilePx,
    key,
  })
  npc.add(Active)
  const day = gameDayNumber(useClock.getState().gameDate)
  const inst = forceOnset(npc, templateId, '调试', day)
  if (!inst) return null
  // Advance past incubation so the NPC counts as symptomatic / shedding.
  const cond = npc.get(Conditions)!
  const list = cond.list.map((c) =>
    c.instanceId === inst.instanceId ? { ...c, phase: 'rising' as const, severity: 30 } : c,
  )
  npc.set(Conditions, { list })
  return { key, instanceId: inst.instanceId, templateId }
})

// Step the contagion system N times. Each step bumps an internal
// gameMs counter past the membership-tick throttle so the call always
// fires. Returns the player's current Conditions list. Ensures the
// player carries Active even if the paused-clock state means
// activeZoneSystem hasn't run yet.
registerDebugHandle('physiologyContagionStep', (steps = 1) => {
  const tickMs = worldConfig.activeZone.membershipTickMin * 60 * 1000
  const day = gameDayNumber(useClock.getState().gameDate)
  const player = world.queryFirst(IsPlayer, Conditions)
  if (player && !player.has(Active)) player.add(Active)
  resetContagion(world)
  for (let i = 0; i < steps; i++) {
    contagionSystem(world, (i + 1) * tickMs, day)
  }
  if (!player) return null
  return player.get(Conditions)!.list.map((c) => ({ ...c, activeBands: [...c.activeBands] }))
})

// Inspect an NPC's conditions by stable EntityKey.
registerDebugHandle('getNpcConditionsByKey', (key: string) => {
  for (const entity of world.query(Character, Conditions, EntityKey)) {
    if (entity.get(EntityKey)!.key !== key) continue
    return entity.get(Conditions)!.list.map((c) => ({ ...c, activeBands: [...c.activeBands] }))
  }
  return null
})
