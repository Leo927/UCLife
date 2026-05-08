import type { World } from 'koota'
import type { Entity } from 'koota'
import {
  Position, MoveTarget, Action, Interactable, IsPlayer, QueuedInteract, Vitals, Job,
  Money, Character, Bed, BarSeat, Workstation, RoughUse, RoughSpot, Transit,
  FlightHub,
  type InteractableKind,
} from '../ecs/traits'
import type { BedTier } from '../ecs/traits'
import { ACTIONS } from '../data/actions'
import { isInWorkWindowWS, isWorkDayWS, getJobSpec } from '../data/jobs'
import { BED_MULTIPLIERS, bedActiveOccupant } from './bed'
import { isBarOpen } from './shop'
import { useClock } from '../sim/clock'
import { emitSim } from '../sim/events'
import { worldConfig, actionsConfig } from '../config'
import { Flags, Ship } from '../ecs/traits'
import { boardShip, disembarkShip } from '../sim/scene'
import { takeHelm } from '../sim/helm'
import { runTransition } from '../sim/transition'
import { getActiveSceneId } from '../ecs/world'
import { getPoi } from '../data/pois'
import { getAirportPlacement } from '../sim/airportPlacements'
import { getSceneConfig, isSceneId } from '../data/scenes'

const ARRIVE_DIST = worldConfig.ranges.playerInteract
const SLEEP_MIN_PER_FATIGUE = actionsConfig.sleepMinutesForFullRest / 100

function playerHasApartmentClaim(world: World, player: Entity, nowMs: number): boolean {
  for (const bedEnt of world.query(Bed)) {
    const b = bedEnt.get(Bed)!
    if (b.tier !== 'apartment') continue
    if (bedActiveOccupant(b, nowMs) === player) return true
  }
  return false
}

export function interactionSystem(world: World) {
  const players = world.query(IsPlayer, Position, MoveTarget, Action, QueuedInteract)
  for (const player of players) {
    const pos = player.get(Position)!
    const target = player.get(MoveTarget)!
    const action = player.get(Action)!

    if (Math.hypot(pos.x - target.x, pos.y - target.y) > 1) continue
    if (action.kind !== 'idle') continue

    let nearestKind: InteractableKind | null = null
    let nearestEnt: Entity | null = null
    let nearestDist = Infinity
    let nearestFee = 0
    const interactables = world.query(Interactable, Position)
    for (const ent of interactables) {
      const it = ent.get(Interactable)!
      const ip = ent.get(Position)!
      const d = Math.hypot(pos.x - ip.x, pos.y - ip.y)
      if (d >= ARRIVE_DIST || d >= nearestDist) continue
      // Skip beds rented by someone else so the next-nearest free bed wins.
      if (it.kind === 'sleep') {
        const bed = ent.get(Bed)
        if (bed) {
          const active = bedActiveOccupant(bed, useClock.getState().gameDate.getTime())
          if (active !== null && active !== player) continue
        }
      }
      if (it.kind === 'bar') {
        const seat = ent.get(BarSeat)
        if (seat && seat.occupant !== null && seat.occupant !== player) continue
      }
      if (it.kind === 'rough') {
        const spot = ent.get(RoughSpot)
        if (spot && spot.occupant !== null && spot.occupant !== player) continue
      }
      nearestKind = it.kind
      nearestEnt = ent
      nearestDist = d
      nearestFee = it.fee
    }

    player.remove(QueuedInteract)
    if (!nearestKind) continue

    if (nearestKind === 'transit') {
      if (nearestEnt) {
        const t = nearestEnt.get(Transit)
        if (t) emitSim('ui:open-transit', { terminalId: t.terminalId })
      }
      continue
    }
    if (nearestKind === 'ticketCounter') {
      if (nearestEnt) {
        const fh = nearestEnt.get(FlightHub)
        if (fh) emitSim('ui:open-flight', { hubId: fh.hubId })
      }
      continue
    }
    if (nearestKind === 'manage') {
      // Per Design/social/diegetic-management.md the manage cell is the
      // legitimate cell-as-management surface. Wired in a follow-up phase;
      // for now, just emit a placeholder toast so a stray spawn from
      // building-types.json5 won't crash the system.
      emitSim('toast', { textZh: '管理面板尚未启用' })
      continue
    }
    if (nearestKind === 'boardShip') {
      const flags = player.get(Flags)
      if (!flags?.flags.shipOwned) {
        emitSim('toast', { textZh: '你尚未拥有飞船 · 请先到 AE 大厅购买' })
        continue
      }
      if (getActiveSceneId() === 'playerShipInterior') continue
      runTransition({ midpoint: () => boardShip() })
      continue
    }
    if (nearestKind === 'disembarkShip') {
      if (getActiveSceneId() !== 'playerShipInterior') continue
      const ship = world.queryFirst(Ship)
      const dockedAt = ship?.get(Ship)?.dockedAtPoiId ?? ''
      const poi = dockedAt ? getPoi(dockedAt) : undefined
      const targetSceneId = poi?.sceneId
      if (!targetSceneId || !isSceneId(targetSceneId)) {
        emitSim('toast', { textZh: '该坐标不可登陆' })
        continue
      }
      const hubId = `${targetSceneId}Airport`
      const placement = getAirportPlacement(hubId)
      let arrivalPx: { x: number; y: number } | null = placement?.arrivalPx ?? null
      if (!arrivalPx) {
        const cfg = getSceneConfig(targetSceneId)
        if (cfg.sceneType === 'micro' && cfg.playerSpawnTile) {
          arrivalPx = {
            x: cfg.playerSpawnTile.x * worldConfig.tilePx,
            y: cfg.playerSpawnTile.y * worldConfig.tilePx,
          }
        }
      }
      if (!arrivalPx) {
        emitSim('toast', { textZh: '该坐标不可登陆' })
        continue
      }
      const target = arrivalPx
      runTransition({ midpoint: () => disembarkShip(targetSceneId, target) })
      continue
    }
    if (nearestKind === 'helm') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '操舵台仅在飞船舰桥内可用' })
        continue
      }
      takeHelm()
      continue
    }
    if (nearestKind === 'work') {
      const j = player.get(Job)
      const ws = j?.workstation ?? null
      if (!ws) {
        emitSim('toast', { textZh: '你尚未受雇 · 请先到人事处签订工作' })
        continue
      }
      const wsTrait = ws.get(Workstation)
      const spec = wsTrait ? getJobSpec(wsTrait.specId) : null
      const now = useClock.getState().gameDate
      if (spec) {
        if (!isWorkDayWS(now, spec)) {
          emitSim('toast', { textZh: '今天是休息日 · 无需上班' })
          continue
        }
        if (!isInWorkWindowWS(now, spec)) {
          emitSim('toast', { textZh: `不在上班时间 · ${spec.shiftStart}:00 – ${spec.shiftEnd}:00` })
          continue
        }
      }
      if (wsTrait && wsTrait.occupant !== null && wsTrait.occupant !== player) {
        const occName = wsTrait.occupant.get(Character)?.name ?? '别人'
        emitSim('toast', { textZh: `${occName} 正在使用此工位` })
        continue
      }
    }
    if (nearestKind === 'wash') {
      const now = useClock.getState().gameDate.getTime()
      if (!playerHasApartmentClaim(world, player, now)) {
        emitSim('toast', { textZh: '这是公寓住户的洗手台 · 请先租下一张公寓床' })
        continue
      }
    }
    // Renting/buying a bed happens through the realtor only. Lounge couches
    // are the exception: claim on click; rentSystem GCs after the nap window.
    if (nearestEnt && nearestKind === 'sleep') {
      const bed = nearestEnt.get(Bed)
      if (bed) {
        const now = useClock.getState().gameDate.getTime()
        if (bed.tier === 'lounge') {
          if (bed.occupant !== null && bed.occupant !== player) {
            emitSim('toast', { textZh: '这张沙发已被人占用' })
            continue
          }
          nearestEnt.set(Bed, {
            ...bed,
            occupant: player,
            rentPaidUntilMs: now + 90 * 60 * 1000,
          })
        } else {
          const active = bedActiveOccupant(bed, now)
          if (active === null) {
            emitSim('toast', { textZh: '请前往房产中介签订租约' })
            continue
          }
          if (active !== player) {
            emitSim('toast', { textZh: '这张床已被人租下' })
            continue
          }
        }
      }
      nearestFee = 0
    }
    if (nearestEnt && nearestKind === 'rough') {
      const spot = nearestEnt.get(RoughSpot)
      if (spot) {
        if (spot.occupant !== null && spot.occupant !== player) {
          emitSim('toast', { textZh: '长椅已被占用' })
          continue
        }
        nearestEnt.set(RoughSpot, { occupant: player })
      }
    }
    if (nearestEnt && nearestKind === 'bar') {
      if (!isBarOpen(world)) {
        emitSim('toast', { textZh: '调酒师不在 · 酒吧未开门' })
        continue
      }
      const seat = nearestEnt.get(BarSeat)
      if (seat) {
        if (seat.occupant !== null && seat.occupant !== player) {
          emitSim('toast', { textZh: '座位已被占用' })
          continue
        }
        nearestEnt.set(BarSeat, { occupant: player })
      }
    }
    if (nearestFee > 0) {
      const m = player.get(Money)
      if (!m || m.amount < nearestFee) {
        emitSim('toast', { textZh: `金钱不足 · 需 ¥${nearestFee}` })
        continue
      }
      player.set(Money, { amount: m.amount - nearestFee })
    }

    if (nearestKind === 'tap' || nearestKind === 'scavenge' || nearestKind === 'rough') {
      const kind = nearestKind
      if (player.has(RoughUse)) player.set(RoughUse, { kind })
      else player.add(RoughUse({ kind }))
    } else if (player.has(RoughUse)) {
      player.remove(RoughUse)
    }

    const def = ACTIONS[nearestKind]
    let durationMin = def.durationMin
    if (def.kind === 'sleeping') {
      const v = player.get(Vitals)
      const fatigue = v?.fatigue ?? 100
      let mult = BED_MULTIPLIERS.flop
      if (nearestEnt) {
        const bed = nearestEnt.get(Bed)
        if (bed) mult = BED_MULTIPLIERS[bed.tier as BedTier] ?? 1.0
      }
      if (nearestKind === 'rough') mult = BED_MULTIPLIERS.none
      durationMin = Math.max(1, Math.round((fatigue * SLEEP_MIN_PER_FATIGUE) / mult))
    }
    if (def.kind === 'working') {
      durationMin = 0
    }
    if (def.kind === 'reveling') {
      const v = player.get(Vitals)
      const boredom = v?.boredom ?? 100
      durationMin = Math.max(1, Math.round((boredom * actionsConfig.barMinutesForFullFun) / 100))
    }
    player.set(Action, { kind: def.kind, remaining: durationMin, total: durationMin })
  }
}
