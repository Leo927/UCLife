import { getWorld, getActiveSceneId, SCENE_IDS } from '../ecs/world'
import { getSceneConfig } from '../data/scenes'
import { useClock, gameDayNumber, setPartialMinute } from './clock'
import { emitSim, onSim } from './events'
import { movementSystem } from '../systems/movement'
import { interactionSystem } from '../systems/interaction'
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
import { combatSystem } from '../systems/combat'
import { spaceSimSystem } from '../systems/spaceSim'
import { supplyDrainSystem } from '../systems/supplyDrain'
import { dailyEconomicsSystem } from '../systems/dailyEconomics'
import { housingPressureSystem } from '../systems/housingPressure'
import { timeConfig } from '../config'
import { useDebug } from '../debug/store'
import { IsPlayer, Action, Vitals, Health, ShipBody, Conditions, type ActionKind } from '../ecs/traits'

const VITAL_DANGER = timeConfig.dangerThresholds.vital
const HP_DANGER = timeConfig.dangerThresholds.hp

const ADDRESSED: Record<ActionKind, ReadonlySet<string>> = {
  idle: new Set(),
  walking: new Set(),
  eating: new Set(['hunger']),
  drinking: new Set(['thirst']),
  sleeping: new Set(['fatigue']),
  washing: new Set(['hygiene']),
  working: new Set(),
  reading: new Set(),
  reveling: new Set(['boredom']),
  chatting: new Set(['boredom']),
  // Gym session feeds Strength but addresses no vital; empty set keeps it
  // out of the urgent-vital check.
  exercising: new Set(),
}

const HYPERSPEED_KINDS: ReadonlySet<ActionKind> = new Set(['eating', 'drinking', 'sleeping', 'washing', 'reading', 'working', 'reveling', 'exercising'])

let prevHyperspeed = false

const COMMITTED_SPEED = timeConfig.committedSpeed
const MIN_HYPERSPEED_REAL_SEC = timeConfig.minHyperspeedRealSec
const MAX_TICKS_PER_FRAME = 200

let raf = 0
let running = false
let lastFrame = 0
let tickAccum = 0
let prevDayInGame = 0

// Phase 5.5.2 — set by `hyperspeed:break` events. Read once per frame
// inside the hyperspeed gate, then cleared. Lets dailyEconomicsSystem
// (and future diegetic events) force a break without inspecting Vitals.
let pendingHyperspeedBreak: string | null = null

function effectiveSpeed(): number {
  const { speed, mode } = useClock.getState()
  const ds = useDebug.getState()
  if (speed === 0) return 0
  let base: number = speed
  if (ds.alwaysHyperspeed) base = COMMITTED_SPEED
  else if (mode === 'committed') base = COMMITTED_SPEED
  return base * (ds.superSpeed > 0 ? ds.superSpeed : 1)
}

function frame(now: number) {
  const dt = Math.min(now - lastFrame, 100)
  lastFrame = now

  const world = getWorld(getActiveSceneId())

  // Combat tick runs at frame rate independent of game-speed scaling — the
  // combatSystem reads its own dt and bails internally when paused. Drive it
  // before the speed-gated city sim so a paused combat (speed=0) still gets
  // its UI snapshot consistent. See Design/combat.md "Bridge mode".
  if (useClock.getState().mode === 'combat') {
    combatSystem(world, dt)
  }

  // Phase 6.0 spaceCampaign tick. Runs every frame regardless of the active
  // camera scene so off-helm autopilot keeps integrating while the player
  // walks around the ship interior. Belt-and-suspenders gate: only tick if
  // the campaign world has a player ship (i.e. setupWorld() has run).
  {
    const space = getWorld('spaceCampaign')
    if (space.queryFirst(IsPlayer, ShipBody)) {
      spaceSimSystem(space, dt / 1000)
    }
  }

  const sp = effectiveSpeed()
  if (sp > 0) {
    // Combat mode runs at human-readable real-time scale (1 real-sec ≈ 1
    // game-sec) — encoded by dividing the per-frame minute count by 60. See
    // Design/combat.md "Bridge mode".
    const isCombat = useClock.getState().mode === 'combat'
    const minutesThisFrame = isCombat
      ? (dt / 1000) * sp / 60
      : (dt / 1000) * sp

    movementSystem(world, minutesThisFrame)
    npcSystem(world, dt, sp)
    interactionSystem(world)

    tickAccum += minutesThisFrame
    let ticks = 0
    while (tickAccum >= 1 && ticks < MAX_TICKS_PER_FRAME) {
      tickAccum -= 1
      ticks++
    }
    // Expose the sub-minute remainder so visualization code (orbit positions)
    // can advance smoothly between integer-minute clock ticks.
    setPartialMinute(tickAccum)
    if (ticks > 0) {
      useClock.getState().advance(ticks)
      // A single tick can span midnight, so compare day numbers rather than
      // doing minute math.
      const newDay = gameDayNumber(useClock.getState().gameDate)
      if (newDay !== prevDayInGame) {
        prevDayInGame = newDay
        emitSim('day:rollover', { reason: '日翻页' })
        // Phase 5.5.2 — facility owners reckon revenue/salary/maintenance
        // and roll the insolvency counter. Runs on every scene world so
        // facilities outside the active scene (e.g. another district)
        // still settle. Skip ship/space worlds; their queries are empty.
        for (const id of SCENE_IDS) {
          dailyEconomicsSystem(getWorld(id), newDay)
        }
        // Phase 5.5.3 — housing pressure runs after the economics rollover
        // so the secretary's "anything gone sideways?" verb sees today's
        // freshly-decayed opinions. Active scene only — pre-creation
        // player-faction members are single-scene, since they can only be
        // bound to facilities the player physically owns + walks past.
        housingPressureSystem(world)
      }
      // Supply drain runs after clock.advance so it sees the post-tick game
      // date. Reads its own elapsed-min delta internally.
      supplyDrainSystem(useClock.getState().gameDate)
      vitalsSystem(world, ticks)
      actionSystem(world, ticks)
      rentSystem(world, useClock.getState().gameDate.getTime())
      workSystem(world, useClock.getState().gameDate, ticks)
      // After vitals so saturated-vital triggers see freshly-updated values.
      stressSystem(world, ticks, useClock.getState().gameDate)
      releaseStaleBarSeats(world)
      releaseStaleRoughSpots(world)
      attributesSystem(world, useClock.getState().gameDate)
      // Per-scene opt-in: only scenes declaring a `replenishment` config in
      // scenes.json5 auto-spawn immigrants, and they spawn at that scene's
      // own arrivalTile. Ship interiors / space sectors omit the field, so
      // boarding the ship doesn't drop citizens into the cabin.
      const activeScene = getSceneConfig(getActiveSceneId())
      if (activeScene.sceneType === 'micro' && activeScene.replenishment) {
        populationSystem(world, useClock.getState().gameDate, activeScene.replenishment)
      }
      relationsSystem(world, useClock.getState().gameDate, ticks)
      ambitionsSystem(world, useClock.getState().gameDate)
      activeZoneSystem(world, useClock.getState().gameDate.getTime())
    }

    const player = world.queryFirst(IsPlayer, Action)
    if (player) {
      const a = player.get(Action)!
      const isCommitted = HYPERSPEED_KINDS.has(a.kind)
      const v = player.get(Vitals)
      const h = player.get(Health)
      const addressed = ADDRESSED[a.kind]

      const reasons: string[] = []
      if (v) {
        if (v.hunger >= VITAL_DANGER && !addressed.has('hunger')) reasons.push('饥饿')
        if (v.thirst >= VITAL_DANGER && !addressed.has('thirst')) reasons.push('口渴')
        if (v.fatigue >= VITAL_DANGER && !addressed.has('fatigue')) reasons.push('疲劳')
      }
      if (h && h.hp <= HP_DANGER) reasons.push('健康危急')
      // Phase 4 — wake hyperspeed on stalled / high-severity conditions
      // so the player can't skip past a worsening illness in their sleep.
      const cond = player.get(Conditions)
      if (cond) {
        for (const inst of cond.list) {
          if (inst.phase === 'stalled') { reasons.push('病情停滞'); break }
          if (inst.severity >= 70 && (inst.phase === 'rising' || inst.phase === 'peak')) {
            reasons.push('病情加重'); break
          }
        }
      }

      // Phase 5.5.2 — pending break from a diegetic event (insolvency,
      // foreclosure, …). Synthesized into a danger reason for one frame
      // so the existing toast-on-break path lights up too. Cleared after
      // read so the next frame is back to vitals-only gating.
      if (pendingHyperspeedBreak) {
        reasons.push(pendingHyperspeedBreak)
        pendingHyperspeedBreak = null
      }

      const inDanger = reasons.length > 0
      const force = useClock.getState().forceHyperspeed
      const debugAlways = useDebug.getState().alwaysHyperspeed

      // Suppress hyperspeed for actions finishing in under
      // MIN_HYPERSPEED_REAL_SEC at committed speed (avoids UI flicker on
      // trivially short actions). 'working' is open-ended (remaining=0 until
      // end-of-shift) so it always qualifies.
      const realSecAtHyperspeed = a.remaining / COMMITTED_SPEED
      const tooShortForHyperspeed = isCommitted
        && a.kind !== 'working'
        && a.remaining > 0
        && realSecAtHyperspeed < MIN_HYPERSPEED_REAL_SEC

      // debugAlways bypasses every gate (committed-action requirement +
      // duration threshold). Player `force` bypasses the duration gate too.
      const isHyperspeed = debugAlways
        || (isCommitted && (!inDanger || force) && (!tooShortForHyperspeed || force))

      // Autosave on the leading edge of a hyperspeed action so a crash mid-
      // skip doesn't cost the player the action's setup. Subscriber lives
      // in src/boot/autosaveBinding.ts (throttle + in-flight guard).
      if (!prevHyperspeed && isHyperspeed && isCommitted) {
        emitSim('hyperspeed:start', { reason: '快进开始' })
      }

      if (prevHyperspeed && !isHyperspeed && isCommitted && inDanger && !force && !debugAlways) {
        emitSim('toast', {
          textZh: `快进暂停 · ${reasons.join('、')}严重`,
          durationMs: 8000,
          action: {
            label: '强制快进',
            onClick: () => useClock.getState().setForceHyperspeed(true),
          },
        })
      }
      // Clear force flag when the committed action ends so the next one
      // requires its own opt-in.
      if (!isCommitted && force) {
        useClock.getState().setForceHyperspeed(false)
      }
      prevHyperspeed = isHyperspeed

      const wantMode = isHyperspeed ? 'committed' : 'normal'
      if (useClock.getState().mode !== wantMode) {
        useClock.getState().setMode(wantMode)
      }
    }
  }

  if (running) raf = requestAnimationFrame(frame)
}

export function startLoop() {
  if (running) return
  running = true
  lastFrame = performance.now()
  tickAccum = 0
  prevHyperspeed = false
  // Anchor day tracking to the current game date so the first tick after a
  // load doesn't fire a spurious autosave.
  prevDayInGame = gameDayNumber(useClock.getState().gameDate)
  raf = requestAnimationFrame(frame)
}

export function stopLoop() {
  running = false
  cancelAnimationFrame(raf)
}

// Wire load events to loop control. save/loadGame emits these instead of
// importing stopLoop/startLoop directly — that's the inversion that
// breaks the historical save <-> sim/loop import cycle.
onSim('load:start', () => stopLoop())
onSim('load:end', () => startLoop())

// Phase 5.5.2 — diegetic events outside the loop ask for a hyperspeed
// break by emitting this. Loop reads the latest reason in its own
// frame() and clears the slot.
onSim('hyperspeed:break', (p) => { pendingHyperspeedBreak = p.reason })
