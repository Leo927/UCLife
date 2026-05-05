import type { World, Entity } from 'koota'
import { Active, Vitals, Health, Action, IsPlayer, Character, Inventory, Money, Job, Workstation, RoughUse, Attributes } from '../ecs/traits'
import { Not } from 'koota'
import { useDebug } from '../debug/store'
import { useClock, formatUC } from '../sim/clock'
import { getBedMultiplierFor, releaseBedFor } from './bed'
import { releaseBarSeatFor } from './barSeats'
import { releaseRoughSpotFor } from './roughSpots'
import { releaseJob, releaseHome } from './market'
import { feedUse, statValue } from './attributes'
import { FEED, statInvMult } from '../data/stats'
import { vitalsConfig, actionsConfig, aiConfig, worldConfig } from '../config'
import { getJobSpec } from '../data/jobs'
import { isolationMultiplier } from './relations'
import { requestNpcWake } from './npc'
import { getStat } from '../stats/sheet'
import { vitalDrainMulStat, type VitalId } from '../stats/schema'

const { drain, actions: act, npcFatigueMult, hpRegenPerMin, hpDamagePerMin } = vitalsConfig
const SLOW_FACTOR = worldConfig.activeZone.inactiveSlowFactor
const COARSE_TICK_MIN = worldConfig.activeZone.inactiveCoarseTickMin

// Buffered game-minutes for Inactive NPCs. Flushed at coarse-tick boundaries
// at `acc * inactiveSlowFactor`. On Inactive→Active promote, the partial
// buffer drains on the next tick alongside the current full-rate drift.
const inactiveAccumMin = new Map<Entity, number>()

export function resetVitalsAccum(): void {
  inactiveAccumMin.clear()
}

// Per-vital max + drain-mul lookups. Default sheet seeds these to 100 / 1
// so behavior is identical to the legacy hardcoded clamp until a perk,
// background, or item adds a modifier.
function vitalMax(entity: Entity, v: VitalId): number {
  const a = entity.get(Attributes)
  if (!a) return 100
  return getStat(a.sheet, `${v}Max`)
}

function vitalDrainMul(entity: Entity, v: VitalId): number {
  const a = entity.get(Attributes)
  if (!a) return 1
  return getStat(a.sheet, vitalDrainMulStat(v))
}

function clampVital(entity: Entity, v: VitalId, x: number): number {
  return Math.max(0, Math.min(vitalMax(entity, v), x))
}

function hpCap(entity: Entity): number {
  const a = entity.get(Attributes)
  if (!a) return 100
  return getStat(a.sheet, 'hpMax')
}

function hpRegenMul(entity: Entity): number {
  const a = entity.get(Attributes)
  if (!a) return 1
  return getStat(a.sheet, 'hpRegenMul')
}

const ROUGH_CFG = actionsConfig.rough

// Threshold table for the BT-wake gate. npc.ts skips stepBT for committed
// actions unless wakePending is flipped — flip it whenever a vital crosses
// one of these values in either direction. These are the only points where
// BT branches flip outcome; intermediate thresholds would re-introduce
// per-tick BT churn with no gameplay benefit.
const D = aiConfig.drives
const HUNGER_THRESH = [D.hungerFed, D.hungerGoHome, 95]
const THIRST_THRESH = [D.thirstQuenched, D.thirstGoHome, 95]
const FATIGUE_THRESH = [D.fatigueRested, D.fatigueGoHome]
const HYGIENE_THRESH = [D.hygieneClean, D.hygieneGoHome]
const BOREDOM_THRESH = [D.boredomFulfilled, D.boredomGoToBar]

function crossed(before: number, after: number, thresholds: readonly number[]): boolean {
  if (before === after) return false
  for (const t of thresholds) {
    if ((before < t) !== (after < t)) return true
  }
  return false
}

function applyAction(kind: string, world: World, entity: Entity): {
  dHunger: number; dThirst: number; dFatigue: number; dHygiene: number; dBoredom: number; dHpExtra: number
} {
  let dHunger = drain.hunger
  let dThirst = drain.thirst
  let dFatigue = drain.fatigue
  let dHygiene = drain.hygiene
  let dBoredom = drain.boredom
  let dHpExtra = 0

  switch (kind) {
    case 'eating':
      dHunger = act.eating.hunger
      break
    case 'drinking':
      dThirst = act.drinking.thirst
      break
    case 'sleeping':
      dHunger = drain.hunger * act.sleeping.hungerMult
      dThirst = drain.thirst * act.sleeping.thirstMult
      dFatigue = act.sleeping.fatigue * getBedMultiplierFor(world, entity)
      dBoredom = act.sleeping.boredom
      break
    case 'washing':
      dHygiene = act.washing.hygiene
      break
    case 'working':
      dHunger = drain.hunger * act.working.hungerMult
      dThirst = drain.thirst * act.working.thirstMult
      dFatigue = drain.fatigue * act.working.fatigueMult
      dHygiene = drain.hygiene * act.working.hygieneMult
      dBoredom = drain.boredom * act.working.boredomMult
      break
    case 'reading':
      dFatigue = drain.fatigue * act.reading.fatigueMult
      break
    case 'reveling':
      dBoredom = act.reveling.boredom
      break
    case 'chatting':
      // Opinion bonus is applied separately in relationsSystem.
      dBoredom = actionsConfig.chatting.boredomPerMin
      dHygiene = drain.hygiene + actionsConfig.chatting.hygienePerMin
      break
  }

  // Guard the RoughUse read on action kind first — applies only to
  // eat/drink/sleep, and avoids a trait read for every NPC every tick.
  if (kind === 'eating' || kind === 'drinking' || kind === 'sleeping') {
    const rough = entity.get(RoughUse)
    if (rough) {
      if (kind === 'eating' && rough.kind === 'scavenge') {
        dHunger = act.eating.hunger * ROUGH_CFG.scavenge.hungerMult
        dHygiene += ROUGH_CFG.scavenge.hygienePerMin
        dHpExtra -= ROUGH_CFG.scavenge.hpPerMin
      } else if (kind === 'drinking' && rough.kind === 'tap') {
        dHygiene += ROUGH_CFG.tap.hygienePerMin
        dHpExtra -= ROUGH_CFG.tap.hpPerMin
      } else if (kind === 'sleeping' && rough.kind === 'rough') {
        dHygiene += ROUGH_CFG.rough.hygienePerMin
        dHpExtra -= ROUGH_CFG.rough.hpPerMin
      }
    }
  }

  return { dHunger, dThirst, dFatigue, dHygiene, dBoredom, dHpExtra }
}

function hpDamage(v: { hunger: number; thirst: number; fatigue: number }, entity: Entity): number {
  let dHp = 0
  // Saturation triggers HP damage when a vital hits its (per-character) max.
  if (v.thirst  >= vitalMax(entity, 'thirst'))  dHp -= hpDamagePerMin.thirst
  if (v.hunger  >= vitalMax(entity, 'hunger'))  dHp -= hpDamagePerMin.hunger
  if (v.fatigue >= vitalMax(entity, 'fatigue')) dHp -= hpDamagePerMin.fatigue
  return dHp
}

export function vitalsSystem(world: World, gameMinutes: number) {
  const freezePlayer = useDebug.getState().freezeNeeds
  const toDestroy: Entity[] = []
  const nowMs = useClock.getState().gameDate.getTime()

  // try/catch: destroyed entities can briefly surface in query() results
  // between destroy() and koota's index update.
  for (const e of world.query(RoughUse, Action)) {
    const a = e.get(Action)
    if (!a) continue
    if (a.kind !== 'eating' && a.kind !== 'drinking' && a.kind !== 'sleeping') {
      try { e.remove(RoughUse) } catch { /* destroyed mid-iteration */ }
    }
  }

  if (!freezePlayer) world.query(Vitals, Health, Action, IsPlayer).updateEach(([v, h, a], entity) => {
    if (h.dead) return
    const d = applyAction(a.kind, world, entity)

    // Endurance softens fatigue accumulation only — sleep recovery untouched.
    if (d.dFatigue > 0) d.dFatigue *= statInvMult(statValue(entity, 'endurance'))
    if (d.dBoredom > 0) d.dBoredom *= isolationMultiplier(entity, nowMs)

    // Sheet-driven per-vital drain multipliers — only positive
    // (decay-direction) deltas are scaled. Recovery actions (eating,
    // washing) keep their authored magnitude.
    if (d.dHunger  > 0) d.dHunger  *= vitalDrainMul(entity, 'hunger')
    if (d.dThirst  > 0) d.dThirst  *= vitalDrainMul(entity, 'thirst')
    if (d.dFatigue > 0) d.dFatigue *= vitalDrainMul(entity, 'fatigue')
    if (d.dHygiene > 0) d.dHygiene *= vitalDrainMul(entity, 'hygiene')
    if (d.dBoredom > 0) d.dBoredom *= vitalDrainMul(entity, 'boredom')

    v.hunger  = clampVital(entity, 'hunger',  v.hunger  + d.dHunger  * gameMinutes)
    v.thirst  = clampVital(entity, 'thirst',  v.thirst  + d.dThirst  * gameMinutes)
    v.fatigue = clampVital(entity, 'fatigue', v.fatigue + d.dFatigue * gameMinutes)
    v.hygiene = clampVital(entity, 'hygiene', v.hygiene + d.dHygiene * gameMinutes)
    v.boredom = clampVital(entity, 'boredom', v.boredom + d.dBoredom * gameMinutes)

    if (a.kind === 'sleeping') feedUse(entity, 'endurance', FEED.sleep, gameMinutes)
    else if (a.kind === 'reveling') feedUse(entity, 'charisma', FEED.reveling, gameMinutes)

    const dHp = hpDamage(v, entity) + d.dHpExtra
    const cap = hpCap(entity)
    if (dHp < 0) {
      h.hp = Math.max(0, h.hp + dHp * gameMinutes)
      if (h.hp <= 0) h.dead = true
    } else if (h.hp < cap) {
      h.hp = Math.min(cap, h.hp + hpRegenPerMin * hpRegenMul(entity) * gameMinutes)
    }
  })

  world.query(Vitals, Health, Action, Not(IsPlayer)).updateEach(([v, h, a], entity) => {
    if (h.dead) {
      inactiveAccumMin.delete(entity)
      return
    }

    let effMinutes: number
    if (entity.has(Active)) {
      const carry = inactiveAccumMin.get(entity)
      if (carry !== undefined && carry > 0) {
        effMinutes = gameMinutes + carry * SLOW_FACTOR
        inactiveAccumMin.delete(entity)
      } else {
        effMinutes = gameMinutes
      }
    } else {
      const acc = (inactiveAccumMin.get(entity) ?? 0) + gameMinutes
      if (acc < COARSE_TICK_MIN) {
        inactiveAccumMin.set(entity, acc)
        return
      }
      inactiveAccumMin.set(entity, 0)
      effMinutes = acc * SLOW_FACTOR
    }

    const d = applyAction(a.kind, world, entity)

    if (d.dFatigue > 0) d.dFatigue *= npcFatigueMult * statInvMult(statValue(entity, 'endurance'))
    if (d.dBoredom > 0) d.dBoredom *= isolationMultiplier(entity, nowMs)

    if (d.dHunger  > 0) d.dHunger  *= vitalDrainMul(entity, 'hunger')
    if (d.dThirst  > 0) d.dThirst  *= vitalDrainMul(entity, 'thirst')
    if (d.dFatigue > 0) d.dFatigue *= vitalDrainMul(entity, 'fatigue')
    if (d.dHygiene > 0) d.dHygiene *= vitalDrainMul(entity, 'hygiene')
    if (d.dBoredom > 0) d.dBoredom *= vitalDrainMul(entity, 'boredom')

    const beforeHunger = v.hunger
    const beforeThirst = v.thirst
    const beforeFatigue = v.fatigue
    const beforeHygiene = v.hygiene
    const beforeBoredom = v.boredom

    v.hunger  = clampVital(entity, 'hunger',  v.hunger  + d.dHunger  * effMinutes)
    v.thirst  = clampVital(entity, 'thirst',  v.thirst  + d.dThirst  * effMinutes)
    v.fatigue = clampVital(entity, 'fatigue', v.fatigue + d.dFatigue * effMinutes)
    v.hygiene = clampVital(entity, 'hygiene', v.hygiene + d.dHygiene * effMinutes)
    v.boredom = clampVital(entity, 'boredom', v.boredom + d.dBoredom * effMinutes)

    if (
      crossed(beforeHunger, v.hunger, HUNGER_THRESH) ||
      crossed(beforeThirst, v.thirst, THIRST_THRESH) ||
      crossed(beforeFatigue, v.fatigue, FATIGUE_THRESH) ||
      crossed(beforeHygiene, v.hygiene, HYGIENE_THRESH) ||
      crossed(beforeBoredom, v.boredom, BOREDOM_THRESH)
    ) {
      requestNpcWake(entity)
    }

    if (a.kind === 'sleeping') feedUse(entity, 'endurance', FEED.sleep, effMinutes)
    else if (a.kind === 'reveling') feedUse(entity, 'charisma', FEED.reveling, effMinutes)

    const dHp = hpDamage(v, entity) + d.dHpExtra
    const cap = hpCap(entity)
    if (dHp < 0) {
      h.hp = Math.max(0, h.hp + dHp * effMinutes)
      if (h.hp <= 0) {
        h.dead = true
        releaseBedFor(world, entity)
        releaseBarSeatFor(world, entity)
        releaseRoughSpotFor(world, entity)
        releaseJob(world, entity)
        releaseHome(world, entity)
        if (useDebug.getState().logNpcs) {
          const ch = entity.get(Character)
          const inv = entity.get(Inventory)
          const m = entity.get(Money)
          const job = entity.get(Job)
          const ws = job?.workstation ?? null
          const wsSpec = ws ? getJobSpec(ws.get(Workstation)?.specId ?? '') : null
          const title = wsSpec?.jobTitle ?? '无业'
          // eslint-disable-next-line no-console
          console.log(
            `[death] ${formatUC(useClock.getState().gameDate)} ${ch?.name ?? '?'} (${title}) ` +
            `hunger=${v.hunger.toFixed(0)} thirst=${v.thirst.toFixed(0)} fatigue=${v.fatigue.toFixed(0)} ` +
            `hygiene=${v.hygiene.toFixed(0)} boredom=${v.boredom.toFixed(0)} action=${a.kind} ` +
            `meals=${inv?.meal ?? '?'} water=${inv?.water ?? '?'} money=${m?.amount ?? '?'}`,
          )
        }
        // The survive harness keeps corpses for post-mortem inspection.
        if (!useDebug.getState().keepCorpses) {
          toDestroy.push(entity)
        }
      }
    } else if (h.hp < cap) {
      h.hp = Math.min(cap, h.hp + hpRegenPerMin * hpRegenMul(entity) * effMinutes)
    }
  })

  // Drop accumulator entries so a koota-recycled entity id doesn't inherit
  // ghost minutes from the prior occupant.
  for (const e of toDestroy) {
    inactiveAccumMin.delete(e)
    e.destroy()
  }
}
