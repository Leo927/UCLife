// Physiology debug handles. Lets smoke tests force-onset a condition
// on the player, advance the day-rollover phase tick deterministically,
// and inspect Conditions / Effects without going through the canvas.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { useClock, gameDayNumber } from '../../sim/clock'
import { IsPlayer, Conditions, Effects, Attributes } from '../../ecs/traits'
import { forceOnset, physiologySystem, diagnoseCondition, commitTreatment } from '../../systems/physiology'
import { getStat } from '../../stats/sheet'
import type { StatId } from '../../stats/schema'

registerDebugHandle('physiologyForceOnset', (templateId: string, source = '调试') => {
  const player = world.queryFirst(IsPlayer, Conditions)
  if (!player) return null
  const day = gameDayNumber(useClock.getState().gameDate)
  const inst = forceOnset(player, templateId, source, day)
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
