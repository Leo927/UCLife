// Ambition / event-log / flag inspection + the test-only
// runAmbitionsTick that forces a single ambitionsSystem evaluation
// so tests don't have to wait for the RAF loop to consume tickAccum.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { useClock } from '../../sim/clock'
import {
  IsPlayer, Ambitions, Flags, Character,
  type AmbitionSlot,
} from '../../ecs/traits'
import { useEventLog } from '../../ui/EventLog'
import { ambitionsSystem } from '../../systems/ambitions'

registerDebugHandle('getAmbitions', () => {
  const player = world.queryFirst(IsPlayer, Ambitions)
  if (!player) return null
  const a = player.get(Ambitions)!
  const ch = player.get(Character)
  return {
    active: a.active.map((s) => ({ ...s })),
    history: a.history.map((h) => ({ ...h })),
    apBalance: a.apBalance,
    apEarned: a.apEarned,
    perks: [...a.perks],
    title: ch?.title ?? '',
  }
})

registerDebugHandle('getEventLog', () => {
  return useEventLog.getState().entries.map((e) => ({ ...e }))
})

registerDebugHandle('getFlags', () => {
  const player = world.queryFirst(IsPlayer, Flags)
  if (!player) return {}
  return { ...player.get(Flags)!.flags }
})

registerDebugHandle('pickAmbitions', (ids: string[]) => {
  const player = world.queryFirst(IsPlayer, Ambitions)
  if (!player) return false
  const next: AmbitionSlot[] = ids.map((id) => ({ id, currentStage: 0, streakAnchorMs: null }))
  player.set(Ambitions, {
    active: next, history: [], apBalance: 0, apEarned: 0, perks: [],
  })
  return true
})

registerDebugHandle('runAmbitionsTick', () => {
  ambitionsSystem(world, useClock.getState().gameDate)
  return true
})
