// Starmap navigation. The single commit point for "leave port and go
// somewhere": this is where takeoff fuel is debited, the dock binding is
// cleared, and the 起航 log is emitted. Both navigateTo (move to a point
// or POI) and dockAt (move to a POI and park there on arrival) funnel
// through the same takeoff path so a player can never accidentally get
// into space without paying for the launch.

import { getShipState, spendFuel, clearDocked, setDockedPoi, setFleetPos } from './ship'
import { getPoi } from '../data/pois'
import { takeoffFuelCostFor, derivedPoiPos } from './helm'
import { getWorld } from '../ecs/world'
import { IsPlayer, ShipBody, Course, PoiTag, Position, Velocity } from '../ecs/traits'
import { useClock } from './clock'
import { emitSim } from './events'
import { useDebug } from '../debug/store'
import { spaceConfig } from '../config'

export type NavTarget =
  | { kind: 'poi'; poiId: string }
  | { kind: 'point'; x: number; y: number }

function poiLivePos(poiId: string): { x: number; y: number } | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(PoiTag, Position)) {
    if (e.get(PoiTag)!.poiId === poiId) {
      const p = e.get(Position)!
      return { x: p.x, y: p.y }
    }
  }
  return derivedPoiPos(poiId)
}

// Charges takeoff fuel + clears the dock binding if the ship is currently
// docked. Returns ok:false with a player-facing message on failure
// (insufficient fuel, missing data). No-op when already in flight.
function takeoffIfDocked(): { ok: boolean; message?: string } {
  const ship = getShipState()
  if (!ship) return { ok: false, message: '未检测到飞船' }
  if (!ship.dockedAtPoiId) return { ok: true }

  const infinite = useDebug.getState().infiniteFuelSupply
  const fuelCost = takeoffFuelCostFor(ship.dockedAtPoiId)
  if (!infinite && ship.fuelCurrent < fuelCost) {
    return { ok: false, message: `燃料不足 · 起航需 ${fuelCost}` }
  }
  const fromPoi = getPoi(ship.dockedAtPoiId)
  if (fuelCost > 0 && !spendFuel(fuelCost)) {
    return { ok: false, message: '燃料扣除失败' }
  }
  clearDocked()
  if (fromPoi) {
    emitSim('log', {
      textZh: `起航 · 自 ${fromPoi.nameZh}`,
      atMs: useClock.getState().gameDate.getTime(),
    })
  }
  return { ok: true }
}

export function navigateTo(target: NavTarget): { ok: boolean; message?: string } {
  const takeoff = takeoffIfDocked()
  if (!takeoff.ok) return takeoff

  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody, Course)
  if (!player) return { ok: false, message: '未在空间场景中找到玩家' }

  if (target.kind === 'poi') {
    const live = poiLivePos(target.poiId) ?? { x: 0, y: 0 }
    player.set(Course, {
      tx: live.x, ty: live.y, destPoiId: target.poiId, active: true, autoDock: false,
    })
  } else {
    player.set(Course, {
      tx: target.x, ty: target.y, destPoiId: null, active: true, autoDock: false,
    })
  }
  return { ok: true }
}

// Dock-at semantics: "go to this POI and park on arrival." If the ship
// is already within snap range, dock immediately and skip the autopilot.
export function dockAt(poiId: string): { ok: boolean; message?: string } {
  const ship = getShipState()
  if (!ship) return { ok: false, message: '未检测到飞船' }
  if (ship.dockedAtPoiId === poiId) {
    return { ok: false, message: '已停泊于此处' }
  }

  const live = poiLivePos(poiId)
  if (!live) return { ok: false, message: '坐标无效' }

  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody, Course, Position, Velocity)
  if (!player) return { ok: false, message: '未在空间场景中找到玩家' }

  const pp = player.get(Position)!
  const dist = Math.hypot(pp.x - live.x, pp.y - live.y)
  if (dist <= spaceConfig.dockSnapRadius) {
    if (ship.dockedAtPoiId) {
      const takeoff = takeoffIfDocked()
      if (!takeoff.ok) return takeoff
    }
    setDockedPoi(poiId, live)
    setFleetPos(live)
    player.set(Position, { x: live.x, y: live.y })
    player.set(Velocity, { vx: 0, vy: 0 })
    player.set(Course, { tx: 0, ty: 0, destPoiId: null, active: false, autoDock: false })
    const poi = getPoi(poiId)
    emitSim('log', {
      textZh: `已停泊 · ${poi?.nameZh ?? poiId}`,
      atMs: useClock.getState().gameDate.getTime(),
    })
    return { ok: true }
  }

  // Far from the POI: pay takeoff if leaving a different dock, set Course
  // with autoDock=true. spaceSim snaps the dock binding on arrival.
  const takeoff = takeoffIfDocked()
  if (!takeoff.ok) return takeoff
  player.set(Course, {
    tx: live.x, ty: live.y, destPoiId: poiId, active: true, autoDock: true,
  })
  return { ok: true }
}
