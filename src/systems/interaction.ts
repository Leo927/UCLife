import type { World } from 'koota'
import type { Entity } from 'koota'
import {
  Position, MoveTarget, Action, Interactable, IsPlayer, QueuedInteract, Vitals, Job,
  Money, Character, Bed, BarSeat, Workstation, RoughUse, RoughSpot, Transit,
  FlightHub, ManageCell, Owner, OrbitalLift, ShipMarker, EntityKey, GateSlot, MsRef,
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
import { maybeEmitWorkplacePrevalence } from './workplacePrevalence'
import { Ship, IsFlagshipMark, Ms } from '../ecs/traits'
import { boardShip, boardShipByKey, disembarkShip, migratePlayerToScene } from '../sim/scene'
import { getShipClass } from '../data/ship-classes'
import { takeHelm } from '../sim/helm'
import { launchMs, takeFlagshipControl } from '../sim/cockpit'
import { runTransition, useTransition } from '../sim/transition'
import { getActiveSceneId, getWorld } from '../ecs/world'
import { getPoi, poiIdForSceneAt } from '../data/pois'
import { getAirportPlacement } from '../sim/airportPlacements'
import { getSceneConfig, isSceneId } from '../data/scenes'
import {
  getOrbitalLift, liftOtherEndpoint, liftFareForEndpoint, type LiftEndpoint,
} from '../data/orbitalLifts'
import { findBoardingPadPx } from './shipMarkers'
import { isPlayerColony } from '../sim/colony'

const ARRIVE_DIST = worldConfig.ranges.playerInteract
const SLEEP_MIN_PER_FATIGUE = actionsConfig.sleepMinutesForFullRest / 100

// Pixel position to drop the player on at the other end of an orbital lift.
// Resolves by querying the destination scene's OrbitalLift kiosk for the
// *opposite* endpoint — so a same-world lift (the folded-in drydock, where
// both kiosks share a world) lands the player at the paired kiosk instead of
// the one they departed from. Returns null if no paired kiosk exists (data
// drift — surfaces as a toast at call site).
function findOrbitalLiftArrivalPx(
  destSceneId: string,
  liftId: string,
  fromEndpoint: LiftEndpoint,
): { x: number; y: number } | null {
  const destWorld = getWorld(destSceneId)
  for (const ent of destWorld.query(OrbitalLift, Position)) {
    const ol = ent.get(OrbitalLift)!
    if (ol.liftId !== liftId || ol.endpoint === fromEndpoint) continue
    const p = ent.get(Position)!
    // Drop the player one tile away from the kiosk along the +y axis so the
    // arrival doesn't immediately retrigger the kiosk's proximity scan.
    return { x: p.x, y: p.y + worldConfig.tilePx }
  }
  return null
}

// Resolve the disembark arrival tile for a flagship's chosen landing scene.
// Preferred drop point: the far end of the bridge the flagship is currently
// bound to (its boarding pad). Drydock disembarks land the player at the
// bridge's outer pad — symmetric with boarding. Airport / playerSpawnTile
// fallbacks cover hubs without a wall-placement gate.
export function resolveDisembarkArrival(
  targetSceneId: string,
  shipKey: string,
): { x: number; y: number } | null {
  let arrivalPx: { x: number; y: number } | null = shipKey
    ? findBoardingPadPx(targetSceneId, shipKey)
    : null
  if (!arrivalPx) {
    const hubId = `${targetSceneId}Airport`
    const placement = getAirportPlacement(hubId)
    arrivalPx = placement?.arrivalPx ?? null
  }
  if (!arrivalPx) {
    const cfg = getSceneConfig(targetSceneId)
    if (cfg.sceneType === 'micro' && cfg.playerSpawnTile) {
      arrivalPx = {
        x: cfg.playerSpawnTile.x * worldConfig.tilePx,
        y: cfg.playerSpawnTile.y * worldConfig.tilePx,
      }
    }
  }
  return arrivalPx
}

function playerHasApartmentClaim(world: World, player: Entity, nowMs: number): boolean {
  for (const bedEnt of world.query(Bed)) {
    const b = bedEnt.get(Bed)!
    if (b.tier !== 'apartment') continue
    if (bedActiveOccupant(b, nowMs) === player) return true
  }
  return false
}

// Ownership in the fleet system lives on the Ship's Owner trait, not on
// a per-player boolean. Any Ship with a character owner counts.
function playerOwnsAnyShip(): boolean {
  const shipWorld = getWorld('playerShipInterior')
  for (const e of shipWorld.query(Ship, Owner)) {
    if (e.get(Owner)!.kind === 'character') return true
  }
  return false
}

// Task 8 — Ms entities always live in playerShipInterior regardless of
// custody state (storedOnShipKey vs dockedAtPoiId); this resolves the
// custody state for the climbIntoMs / msTerminal depot-reachability check.
function findMsDockedAtPoiId(msKey: string): string {
  if (!msKey) return ''
  const shipWorld = getWorld('playerShipInterior')
  for (const ent of shipWorld.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return ent.get(Ms)!.dockedAtPoiId
  }
  return ''
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
      // Manage cell is hidden when the player doesn't own the linked
      // building; skip in the proximity scan so a non-owned cell can't
      // win nearest and stall the player on a ghost interactable.
      if (it.kind === 'manage') {
        const cell = ent.get(ManageCell)
        const owner = cell?.building?.get(Owner)
        if (!owner || owner.kind !== 'character' || owner.entity !== player) continue
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
    if (nearestKind === 'orbitalLift') {
      if (!nearestEnt) continue
      const ol = nearestEnt.get(OrbitalLift)
      if (!ol) continue
      const lift = getOrbitalLift(ol.liftId)
      if (!lift) {
        emitSim('toast', { textZh: '升降梯线路异常' })
        continue
      }
      const fromSceneId = getActiveSceneId()
      const destSceneId = liftOtherEndpoint(lift, fromSceneId)
      if (!destSceneId) {
        emitSim('toast', { textZh: '升降梯目的地异常' })
        continue
      }
      const fare = liftFareForEndpoint(lift, ol.endpoint)
      const m = player.get(Money)
      if (fare > 0 && (!m || m.amount < fare)) {
        emitSim('toast', { textZh: `金钱不足 · 需 ¥${fare}` })
        continue
      }
      // Charge fare up-front so a mid-transition cancel still reflects the
      // commitment — same pattern as flights / transit. Resolve the arrival
      // tile against the paired (opposite-endpoint) kiosk so the player
      // materialises next to the other end of the lift.
      const arrivalPx = findOrbitalLiftArrivalPx(destSceneId, ol.liftId, ol.endpoint)
      if (!arrivalPx) {
        emitSim('toast', { textZh: '升降梯目的地舱口异常' })
        continue
      }
      if (fare > 0 && m) player.set(Money, { amount: m.amount - fare })
      runTransition({
        midpoint: () => {
          useClock.getState().advance(lift.durationMin)
          migratePlayerToScene(destSceneId, arrivalPx)
        },
      })
      continue
    }
    if (nearestKind === 'manage') {
      const building = nearestEnt?.get(ManageCell)?.building
      if (building) emitSim('ui:open-manage', { building })
      continue
    }
    if (nearestKind === 'gateTerminal') {
      const slot = nearestEnt?.get(GateSlot)
      if (!slot) continue
      if (!slot.boundShipKey) {
        emitSim('toast', { textZh: `${slot.gateNumber} · 空泊位` })
        continue
      }
      emitSim('ui:open-gate-terminal', { gateNumber: slot.gateNumber, shipKey: slot.boundShipKey })
      continue
    }
    if (nearestKind === 'boardShip') {
      if (getActiveSceneId() === 'playerShipInterior') continue
      // Gate booths carry a ShipMarker pointing at the bound ship; the
      // legacy airport board kiosk has no marker and boards the current
      // flagship via the unparameterized helper.
      const targetKey = nearestEnt?.get(ShipMarker)?.shipKey ?? ''
      if (targetKey) {
        runTransition({
          midpoint: () => {
            const r = boardShipByKey(targetKey)
            if (!r.ok) emitSim('toast', { textZh: r.reasonZh })
          },
        })
      } else {
        if (!playerOwnsAnyShip()) {
          emitSim('toast', { textZh: '你尚未拥有任何飞船' })
          continue
        }
        runTransition({ midpoint: () => boardShip() })
      }
      continue
    }
    if (nearestKind === 'inspectShip') {
      // Per-ship marker for a fleet hull docked at this scene's POI.
      // Resolve the linked Ship entity via the marker's shipKey; surface a
      // short status toast (class + hull) until walkable interiors land
      // for non-flagship hulls (6.3+).
      const shipKey = nearestEnt?.get(ShipMarker)?.shipKey
      const shipWorld = getWorld('playerShipInterior')
      let shipEnt: Entity | null = null
      if (shipKey) {
        for (const e of shipWorld.query(Ship, EntityKey)) {
          if (e.get(EntityKey)!.key === shipKey) { shipEnt = e; break }
        }
      }
      const ship = shipEnt?.get(Ship)
      if (!ship) {
        emitSim('toast', { textZh: '舰艇已不在此停泊' })
        continue
      }
      const cls = getShipClass(ship.templateId)
      emitSim('toast', {
        textZh: `${cls.nameZh} · 舰体 ${ship.hullCurrent}/${ship.hullMax}`,
      })
      continue
    }
    if (nearestKind === 'disembarkShip') {
      if (getActiveSceneId() !== 'playerShipInterior') continue
      // The single-scene path below funnels through runTransition, which
      // ignores re-entry while a fade is in flight; the picker emit needs
      // its own guard so the modal can't paint over a live transition.
      if (useTransition.getState().inProgress) continue
      const ship = world.queryFirst(Ship, IsFlagshipMark)
      const shipKey = ship?.get(EntityKey)?.key ?? ''
      const dockedAt = ship?.get(Ship)?.dockedAtPoiId ?? ''
      const poi = dockedAt ? getPoi(dockedAt) : undefined
      const candidates = (poi?.dockScenes ?? []).filter(isSceneId)
      if (candidates.length === 0) {
        emitSim('toast', { textZh: '该坐标不可登陆' })
        continue
      }
      // Multiple landing scenes for this POI → open the picker; the
      // player picks one and the picker dispatches the same transition.
      // Single-scene POIs auto-pick — same behavior as before the picker.
      if (candidates.length > 1) {
        emitSim('ui:open-dock-picker', { poiId: dockedAt, shipKey, candidates })
        continue
      }
      const targetSceneId = candidates[0]
      const target = resolveDisembarkArrival(targetSceneId, shipKey)
      if (!target) {
        emitSim('toast', { textZh: '该坐标不可登陆' })
        continue
      }
      runTransition({ midpoint: () => disembarkShip(targetSceneId, target) })
      continue
    }
    if (nearestKind === 'helm') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '操舵台仅在飞船舰桥内可用' })
        continue
      }
      // Mid-combat helm = take direct flagship control + open the
      // tactical overlay. Outside combat, helm = orbit-map view.
      if (useClock.getState().mode === 'combat') {
        const r = takeFlagshipControl()
        if (!r.ok && r.reasonZh) emitSim('toast', { textZh: r.reasonZh })
        continue
      }
      takeHelm()
      continue
    }
    if (nearestKind === 'climbIntoMs') {
      const msKey = nearestEnt?.get(MsRef)?.msKey ?? ''
      const atDepot = msKey !== '' && findMsDockedAtPoiId(msKey) !== ''
      // Task 8 — depot MS also carry a climbIntoMs sprite (refreshDepotMsLayout).
      // Outside combat there's nothing to sortie into from the ground, so
      // repurpose the click as a retrofit-panel shortcut instead of a dead-
      // end rejection toast. In-combat behavior is unchanged: sortie launch
      // still requires the flagship's own hangar bay.
      if (getActiveSceneId() !== 'playerShipInterior') {
        if (atDepot && useClock.getState().mode !== 'combat') {
          emitSim('ui:open-ms-retrofit', { msKey })
          continue
        }
        emitSim('toast', { textZh: '只能在机库内登舱出击' })
        continue
      }
      if (useClock.getState().mode !== 'combat') {
        // W4 Task 7 — a docked bridge has nothing to sortie into, so climbing
        // an aboard MS outside combat opens its retrofit panel instead of a
        // dead-end toast (mirroring the adjacent msTerminal branch below).
        if (!msKey) {
          emitSim('toast', { textZh: 'MS 数据异常' })
          continue
        }
        emitSim('ui:open-ms-retrofit', { msKey })
        continue
      }
      const r = launchMs(msKey || undefined)
      if (!r.ok && r.reasonZh) emitSim('toast', { textZh: r.reasonZh })
      continue
    }
    if (nearestKind === 'msTerminal') {
      const msKey = nearestEnt?.get(MsRef)?.msKey ?? ''
      // Task 8 — depot terminals (refreshDepotMsLayout) are reachable
      // whenever the MS they reference is actually parked at a depot
      // (dockedAtPoiId set); the terminal entity only ever exists in the
      // scene it was spawned into, so no cross-scene lookup is needed.
      const atDepot = msKey !== '' && findMsDockedAtPoiId(msKey) !== ''
      if (getActiveSceneId() !== 'playerShipInterior' && !atDepot) {
        emitSim('toast', { textZh: 'MS 终端仅在机库内可用' })
        continue
      }
      if (!msKey) {
        emitSim('toast', { textZh: 'MS 终端数据异常' })
        continue
      }
      emitSim('ui:open-ms-retrofit', { msKey })
      continue
    }
    if (nearestKind === 'captainsDesk') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '船长简报仅在飞船内可用' })
        continue
      }
      emitSim('ui:open-captains-office', { reason: 'captainsDesk' })
      continue
    }
    if (nearestKind === 'commPanel') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '通讯面板仅在飞船内可用' })
        continue
      }
      emitSim('ui:open-comm-panel', { reason: 'commPanel' })
      continue
    }
    if (nearestKind === 'brig') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '禁闭室仅在飞船内可用' })
        continue
      }
      emitSim('ui:open-brig-panel', { reason: 'brig' })
      continue
    }
    if (nearestKind === 'warRoom') {
      if (getActiveSceneId() !== 'playerShipInterior') {
        emitSim('toast', { textZh: '战略图台仅在飞船内可用' })
        continue
      }
      emitSim('ui:open-war-room', { reason: 'warRoom' })
      continue
    }
    if (nearestKind === 'adminChair') {
      const chairPos = nearestEnt?.get(Position)
      if (!chairPos) continue
      const activeScene = getActiveSceneId()
      const tileX = Math.floor(chairPos.x / worldConfig.tilePx)
      const tileY = Math.floor(chairPos.y / worldConfig.tilePx)
      const poiId = poiIdForSceneAt(activeScene, tileX, tileY)
      if (!poiId) {
        emitSim('toast', { textZh: '无法确认所在地点' })
        continue
      }
      if (isPlayerColony(poiId)) {
        emitSim('toast', { textZh: '此地已是你的势力领地' })
        continue
      }
      emitSim('ui:colony-claim', { poiId })
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
    if (def.kind === 'working') {
      maybeEmitWorkplacePrevalence(world, player, useClock.getState().gameDate)
    }
  }
}
