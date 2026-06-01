// Frozen-clock helpers. Test mode never starts the RAF loop —
// `advanceSimByGameMs` is the sole path that moves sim time forward.
//
// Determinism strategy:
//
//   - useClock.gameDate is mutated directly by exactly the requested
//     game-ms (no Date.setMinutes truncation, no float drift across
//     thousands of sub-minute ticks).
//   - simNow() advances in lockstep so timestamp-driven systems see
//     the same advancement.
//   - Per-tick (game-minute) gated systems run once per integer-minute
//     boundary crossed — same systems + call order as src/sim/loop.ts
//     frame()'s inner per-tick block.
//   - Every-frame systems (movement / npc BT / interaction / talk) are
//     driven once per advanceSimByGameMs call with the requested
//     minutesThisFrame.
//
// The prod loop's `tickAccum` float-summing path is bypassed entirely.
// That path is correct under RAF (which produces tens of dt values per
// second) but unsuitable for test mode (which produces thousands of
// tiny dt values per simulated second).
//
// This module necessarily mirrors a subset of src/sim/loop.ts's frame()
// body. If a system is added or removed from frame(), audit this file
// too — the duplication is the price of decoupling test cadence from
// RAF cadence.

import { advanceSimNow } from '../sim/time'
import { useClock, gameDayNumber } from '../sim/clock'
import { getWorld, getActiveSceneId, SCENE_IDS } from '../ecs/world'
import { getSceneConfig } from '../data/scenes'
import { emitSim } from '../sim/events'
import { movementSystem } from '../systems/movement'
import { interactionSystem } from '../systems/interaction'
import { talkSystem } from '../systems/talk'
import { vitalsSystem } from '../systems/vitals'
import { actionSystem } from '../systems/action'
import { rentSystem } from '../systems/rent'
import { npcSystem } from '../systems/npc'
import { workSystem } from '../systems/work'
import { attributesSystem } from '../systems/attributes'
import { stressSystem } from '../systems/stress'
import { releaseStaleBarSeats } from '../systems/barSeats'
import { releaseStaleRoughSpots } from '../systems/roughSpots'
import { populationSystem } from '../systems/population'
import { relationsSystem } from '../systems/relations'
import { activeZoneSystem } from '../systems/activeZone'
import { ambitionsSystem } from '../systems/ambitions'
import { dailyEconomicsSystem } from '../systems/dailyEconomics'
import { housingPressureSystem } from '../systems/housingPressure'
import { recruitmentSystem } from '../systems/recruitment'
import { supplyDrainSystem } from '../systems/supplyDrain'
import { combatSystem } from '../systems/combat'
import { spaceSimSystem } from '../systems/spaceSim'
import { syncShipMarkers } from '../systems/shipMarkers'
import { IsPlayer, ShipBody } from '../ecs/traits'
import { testConfig } from './test-config'

const MS_PER_MINUTE = testConfig.msPerGameMinute
const MS_PER_GAME_SECOND = testConfig.msPerGameSecond

/**
 * Pin useClock.speed = 1 so any system that still reads speed (e.g.
 * combat scaling) sees the prod scaling. Idempotent.
 */
export function pinTestModeSpeed(): void {
  useClock.setState({ speed: 1 })
}

let prevDayInGame: number | null = null

/**
 * Advance sim time by `gameMs`. Mutates useClock.gameDate + simNow()
 * directly, then drives every-frame + per-tick sim systems so test
 * consequences land the same way they would under the prod RAF loop.
 */
export function advanceSimByGameMs(gameMs: number): void {
  if (gameMs <= 0) return
  const world = getWorld(getActiveSceneId())

  // 1. Compute boundaries before mutating state.
  const beforeMs = useClock.getState().gameDate.getTime()
  const targetMs = beforeMs + gameMs
  const beforeMinute = Math.floor(beforeMs / MS_PER_MINUTE)
  const afterMinute = Math.floor(targetMs / MS_PER_MINUTE)
  const minutesElapsed = afterMinute - beforeMinute

  // 2. Mutate clock + simNow.
  useClock.setState({ gameDate: new Date(targetMs) })
  advanceSimNow(gameMs)

  // 3. Drive every-frame systems once.
  const minutesThisFrame = gameMs / MS_PER_MINUTE
  // dt: real-ms; at speed=1, gameMs = dt-real-ms. We pass `gameMs` as
  // an opaque dt to systems that read it (npcSystem reads dt directly
  // to throttle BT updates; movementSystem reads minutesThisFrame).
  const dt = gameMs
  // Combat + space-campaign ticks run every frame regardless of game
  // speed — same gate-on-mode logic as src/sim/loop.ts. Without these,
  // fastWinCombat-style smoke tests can't drive combat resolution
  // (combatSystem sets clock.mode='normal' after victory).
  if (useClock.getState().mode === 'combat') {
    combatSystem(world, dt)
  }
  {
    const space = getWorld('spaceCampaign')
    if (space.queryFirst(IsPlayer, ShipBody)) {
      spaceSimSystem(space, dt / MS_PER_GAME_SECOND)
    }
  }
  movementSystem(world, minutesThisFrame)
  npcSystem(world, dt, useClock.getState().speed)
  interactionSystem(world)
  talkSystem(world)

  // 4. Drive per-tick (game-minute) gated systems for each integer-
  //    minute boundary crossed. Mirrors src/sim/loop.ts tickFrame's
  //    per-tick block exactly — same systems, same order.
  if (minutesElapsed > 0) {
    // Day-rollover detection — same shape as loop.ts.
    if (prevDayInGame === null) {
      prevDayInGame = gameDayNumber(useClock.getState().gameDate)
    }
    const newDay = gameDayNumber(useClock.getState().gameDate)
    if (newDay !== prevDayInGame) {
      prevDayInGame = newDay
      emitSim('day:rollover', { reason: '日翻页' })
      for (const id of SCENE_IDS) {
        dailyEconomicsSystem(getWorld(id), newDay)
      }
      housingPressureSystem(world)
      recruitmentSystem(world, newDay)
      emitSim('day:rollover:settled', { gameDay: newDay })
    }
    supplyDrainSystem(useClock.getState().gameDate)
    vitalsSystem(world, minutesElapsed)
    actionSystem(world, minutesElapsed)
    rentSystem(world, useClock.getState().gameDate.getTime())
    workSystem(world, useClock.getState().gameDate, minutesElapsed)
    stressSystem(world, minutesElapsed, useClock.getState().gameDate)
    releaseStaleBarSeats(world)
    releaseStaleRoughSpots(world)
    attributesSystem(world, useClock.getState().gameDate)
    const activeScene = getSceneConfig(getActiveSceneId())
    if (activeScene.sceneType === 'micro' && activeScene.replenishments) {
      for (let ri = 0; ri < activeScene.replenishments.length; ri++) {
        populationSystem(
          world, useClock.getState().gameDate, activeScene.replenishments[ri],
          `${activeScene.id}#${ri}`,
        )
      }
    }
    if (activeScene.sceneType === 'micro') {
      syncShipMarkers(world, activeScene.id)
    }
    relationsSystem(world, useClock.getState().gameDate, minutesElapsed)
    ambitionsSystem(world, useClock.getState().gameDate)
    activeZoneSystem(world, useClock.getState().gameDate.getTime())
  }
}

/** Test-only reset; production never calls this. */
export function __resetTestClockForTests(): void {
  prevDayInGame = null
}
