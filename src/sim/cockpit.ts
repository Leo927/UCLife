// Phase 6.1 — bridge ↔ hangar transit + MS launch / dock.
//
// State machine (orthogonal to combat-engaged):
//   piloting='flagship' (default while combat is open)
//   piloting='ms'        (after launchMs, until dockMs / MS destroyed / endCombat)
//   piloting=null        (no active combat, OR combat is open but the
//                        player closed the tactical view to walk the ship)
//
// Public API:
//   - launchMs()       : spawns the MS in the tactical arena, sets
//                        piloting='ms', migrates player avatar OFF the
//                        ship interior (they're now in the cockpit), and
//                        opens the tactical view.
//   - dockMs()         : closes the cockpit, despawns the MS, drops the
//                        player avatar back into the hangar bay, leaves
//                        combat running.
//   - takeFlagshipControl() : switch piloting to 'flagship' from any
//                        state where combat is engaged. Opens tactical
//                        view if closed.
//   - leaveBridge()    : drops the tactical overlay; player avatar walks
//                        the ship interior at the bridge. Flagship now on
//                        AI.
//   - onMsDestroyed()  : called by combatSystem when the player's MS
//                        hull reaches zero. Pushes ejection log + drops
//                        the player at the hangar bay walkable.

import { create } from 'zustand'
import type { Entity } from 'koota'
import { getWorld, getActiveSceneId } from '../ecs/world'
import {
  CombatShipState, EntityKey, IsPlayer, Position, MoveTarget, Action,
} from '../ecs/traits'
import { getMsClass } from '../data/ms'
import { getWeapon } from '../data/weapons'
import { cockpitConfig, worldConfig } from '../config'
import { useScene, migratePlayerToScene } from './scene'
import { useClock } from './clock'
import { emitSim } from './events'
import { pushCombatLog } from './combatLog'
import { getSceneConfig, type ShipSceneConfig } from '../data/scenes'
import { getShipClass } from '../data/ships'

const SHIP_SCENE_ID = 'playerShipInterior'
export const PLAYER_MS_KEY = 'player-ms-1'
const PLAYER_MS_CLASS_ID = 'gm_pre'

interface CockpitState {
  // Which player-side unit the WASD axis + shift+mouse aim are bound to,
  // when the tactical overlay is visible. null = combat closed OR player
  // currently walking the ship interior with the tactical view dropped.
  piloting: 'flagship' | 'ms' | null
  setPiloting: (next: 'flagship' | 'ms' | null) => void
  // Bumped on every (un)mount of the MS — UI + smoke tests poll this.
  msNonce: number
  bumpMs: () => void
}

export const useCockpit = create<CockpitState>((set) => ({
  piloting: null,
  setPiloting: (piloting) => set({ piloting }),
  msNonce: 0,
  bumpMs: () => set((s) => ({ msNonce: s.msNonce + 1 })),
}))

function shipWorld() { return getWorld(SHIP_SCENE_ID) }

function ensureTacticalOpen(open: boolean): void {
  emitSim('combat:set-overlay-open', { open })
}

function findFlagshipCombat(): Entity | undefined {
  for (const e of shipWorld().query(CombatShipState)) {
    if (e.get(CombatShipState)!.isFlagship) return e
  }
  return undefined
}

export function getPlayerMs(): Entity | undefined {
  for (const e of shipWorld().query(CombatShipState, EntityKey)) {
    if (e.get(EntityKey)!.key === PLAYER_MS_KEY) return e
  }
  return undefined
}

function clearPilotedFlags(): void {
  for (const e of shipWorld().query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.pilotedByPlayer) {
      e.set(CombatShipState, { ...cs, pilotedByPlayer: false })
    }
  }
}

// Spawn the MS at flagship.pos + cockpitConfig.launchOffset, rotated by
// the flagship's heading. Returns the new entity, or null if there's no
// flagship combat row (combat not open).
function spawnPlayerMs(): Entity | null {
  const flagshipEnt = findFlagshipCombat()
  if (!flagshipEnt) return null
  const fcs = flagshipEnt.get(CombatShipState)!
  const ms = getMsClass(PLAYER_MS_CLASS_ID)
  const cosH = Math.cos(fcs.heading)
  const sinH = Math.sin(fcs.heading)
  const off = cockpitConfig.launchOffset
  const pos = {
    x: fcs.pos.x + off.x * cosH - off.y * sinH,
    y: fcs.pos.y + off.x * sinH + off.y * cosH,
  }
  const lv = cockpitConfig.launchVelocity
  const vel = {
    x: lv.x * cosH - lv.y * sinH,
    y: lv.x * sinH + lv.y * cosH,
  }
  const w = shipWorld()
  const ent = w.spawn(
    CombatShipState({
      shipClassId: ms.id,
      nameZh: ms.nameZh,
      side: 'player',
      isFlagship: false,
      isMs: true,
      pilotedByPlayer: true,
      isPlayer: false,
      pos,
      vel,
      heading: fcs.heading,
      angVel: 0,
      hullCurrent: ms.hullMax, hullMax: ms.hullMax,
      armorCurrent: ms.armorMax, armorMax: ms.armorMax,
      // No flux / shield on the MS in 6.1 — hull-only combat.
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: ms.topSpeed,
      accel: ms.accel,
      decel: ms.decel,
      angularAccel: ms.angularAccel,
      maxAngVel: ms.maxAngVel,
      weapons: ms.weapons.map((wpn) => {
        // Reference getWeapon for boot-time validation parity with ships
        // (and so an unknown weapon id surfaces a clear error here, not
        // mid-combat).
        getWeapon(wpn.weaponId)
        return {
          weaponId: wpn.weaponId,
          size: wpn.size,
          firingArcRad: (wpn.firingArcDeg * Math.PI) / 180,
          facingRad: (wpn.facingDeg * Math.PI) / 180,
          chargeSec: 0,
          ready: false,
        }
      }),
      ai: {
        aggression: ms.ai.aggression,
        retreatThreshold: ms.ai.retreatThresholdPct,
        maintainRange: ms.ai.maintainRange,
      },
    }),
    EntityKey({ key: PLAYER_MS_KEY }),
  )
  return ent
}

function despawnPlayerMs(): void {
  const ent = getPlayerMs()
  if (ent) ent.destroy()
}

function getHangarBayCenter(): { x: number; y: number } | null {
  const cfg = getSceneConfig(SHIP_SCENE_ID) as ShipSceneConfig
  const cls = getShipClass(cfg.shipClassId)
  const room = cls.rooms.find((r) => r.id === 'hangarBay')
  if (!room) return null
  return {
    x: (room.bounds.x + room.bounds.w / 2) * worldConfig.tilePx,
    y: (room.bounds.y + room.bounds.h / 2) * worldConfig.tilePx,
  }
}

function getBridgeCenter(): { x: number; y: number } | null {
  const cfg = getSceneConfig(SHIP_SCENE_ID) as ShipSceneConfig
  const cls = getShipClass(cfg.shipClassId)
  const room = cls.rooms.find((r) => r.id === 'bridge')
  if (!room) return null
  return {
    x: (room.bounds.x + room.bounds.w / 2) * worldConfig.tilePx,
    y: (room.bounds.y + room.bounds.h / 2) * worldConfig.tilePx,
  }
}

function logEvent(textZh: string): void {
  emitSim('log', { textZh, atMs: useClock.getState().gameDate.getTime() })
}

// Launch the player into an MS sortie. Requires combat to be engaged
// (flagship CombatShipState present) and no MS currently active. Routes
// player input to the new MS and opens the tactical view.
export function launchMs(): { ok: boolean; reasonZh?: string } {
  if (!findFlagshipCombat()) return { ok: false, reasonZh: '尚未进入战斗 · 无法出击' }
  if (getPlayerMs()) return { ok: false, reasonZh: '已经有一台 MS 在外 · 先回收' }

  clearPilotedFlags()
  const flagship = findFlagshipCombat()!
  const fcs = flagship.get(CombatShipState)!
  flagship.set(CombatShipState, { ...fcs, pilotedByPlayer: false })

  const ent = spawnPlayerMs()
  if (!ent) return { ok: false, reasonZh: '出击失败 · 旗舰状态异常' }

  useCockpit.getState().setPiloting('ms')
  useCockpit.getState().bumpMs()
  ensureTacticalOpen(true)

  pushCombatLog('副官 · 凯文：「机库门已开 · 出击 · 一路顺风」', 'narr')
  pushCombatLog(`${getMsClass(PLAYER_MS_CLASS_ID).nameZh} · 出击`, 'info')
  logEvent(`登舱出击 · ${getMsClass(PLAYER_MS_CLASS_ID).nameZh}`)
  return { ok: true }
}

// Dock the active MS back into the hangar bay. Requires the MS to be
// within `dockApproachRadiusPx` of the flagship, moving slower than
// `dockApproachMaxRelVel` relative to it. (Hard dock authoring lands at
// 6.2.5 — for 6.1 a single placeholder door per ship.)
export function dockMs(opts: { force?: boolean } = {}): { ok: boolean; reasonZh?: string } {
  const ms = getPlayerMs()
  if (!ms) return { ok: false, reasonZh: '无在外 MS · 无法回收' }
  const flagship = findFlagshipCombat()
  if (!flagship) return { ok: false, reasonZh: '旗舰状态异常 · 无法回收' }

  if (!opts.force) {
    const mcs = ms.get(CombatShipState)!
    const fcs = flagship.get(CombatShipState)!
    const dx = mcs.pos.x - fcs.pos.x
    const dy = mcs.pos.y - fcs.pos.y
    const range = Math.hypot(dx, dy)
    if (range > cockpitConfig.dockApproachRadiusPx) {
      return { ok: false, reasonZh: `距离旗舰过远 · ${Math.round(range)} > ${cockpitConfig.dockApproachRadiusPx}` }
    }
    const relVx = mcs.vel.x - fcs.vel.x
    const relVy = mcs.vel.y - fcs.vel.y
    const relSpeed = Math.hypot(relVx, relVy)
    if (relSpeed > cockpitConfig.dockApproachMaxRelVel) {
      return { ok: false, reasonZh: `相对速度过快 · ${Math.round(relSpeed)} > ${cockpitConfig.dockApproachMaxRelVel}` }
    }
  }

  despawnPlayerMs()
  useCockpit.getState().setPiloting(null)
  useCockpit.getState().bumpMs()

  // Drop the player back into the walkable hangar bay. Close the
  // tactical overlay so they can walk; combat continues on the flagship
  // (which is on AI until they take the helm again).
  const hangarPos = getHangarBayCenter()
  if (hangarPos) {
    if (getActiveSceneId() === SHIP_SCENE_ID) {
      const w = shipWorld()
      const player = w.queryFirst(IsPlayer)
      if (player) {
        player.set(Position, { x: hangarPos.x, y: hangarPos.y })
        player.set(MoveTarget, { x: hangarPos.x, y: hangarPos.y })
        player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
      }
    } else {
      migratePlayerToScene(SHIP_SCENE_ID, hangarPos)
    }
  }
  ensureTacticalOpen(false)

  pushCombatLog('副官 · 凯文：「MS 已入舱 · 欢迎回来」', 'narr')
  pushCombatLog(`${getMsClass(PLAYER_MS_CLASS_ID).nameZh} · 回收`, 'info')
  logEvent(`回收 MS · ${getMsClass(PLAYER_MS_CLASS_ID).nameZh}`)
  return { ok: true }
}

// Player MS hull crossed zero — combatSystem calls this. Eject the
// pilot into the hangar bay (no in-tactical recovery; that's 6.2.5).
export function onMsDestroyed(): void {
  despawnPlayerMs()
  useCockpit.getState().setPiloting(null)
  useCockpit.getState().bumpMs()

  const hangarPos = getHangarBayCenter()
  if (hangarPos) {
    if (getActiveSceneId() === SHIP_SCENE_ID) {
      const w = shipWorld()
      const player = w.queryFirst(IsPlayer)
      if (player) {
        player.set(Position, { x: hangarPos.x, y: hangarPos.y })
        player.set(MoveTarget, { x: hangarPos.x, y: hangarPos.y })
        player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
      }
    } else {
      migratePlayerToScene(SHIP_SCENE_ID, hangarPos)
    }
  }
  ensureTacticalOpen(false)

  pushCombatLog('MS 损毁 · 弹射成功 · 副官 · 凯文：「机师平安归来」', 'crit')
  logEvent('MS 损毁 · 弹射回收')
}

// Take direct flagship control. Used both when combat starts (default
// pilot target) and when the player walks back to the helm mid-combat.
export function takeFlagshipControl(): { ok: boolean; reasonZh?: string } {
  if (!findFlagshipCombat()) return { ok: false, reasonZh: '尚未进入战斗 · 无法接管旗舰' }
  if (getPlayerMs()) return { ok: false, reasonZh: 'MS 在外 · 先回收再接管旗舰' }

  clearPilotedFlags()
  const flagship = findFlagshipCombat()!
  const fcs = flagship.get(CombatShipState)!
  flagship.set(CombatShipState, { ...fcs, pilotedByPlayer: true })
  useCockpit.getState().setPiloting('flagship')

  ensureTacticalOpen(true)

  pushCombatLog('副官 · 凯文：「舰桥岗位已就绪」', 'narr')
  return { ok: true }
}

// Player walks off the bridge mid-combat. Closes the tactical overlay,
// drops the avatar at the bridge room (so the walking-transit cost
// includes the actual walk to wherever they're going), flagship is now
// on AI.
export function leaveBridge(): void {
  clearPilotedFlags()
  useCockpit.getState().setPiloting(null)
  const bridgePos = getBridgeCenter()
  if (bridgePos) {
    if (getActiveSceneId() === SHIP_SCENE_ID) {
      const w = shipWorld()
      const player = w.queryFirst(IsPlayer)
      if (player) {
        player.set(Position, { x: bridgePos.x, y: bridgePos.y })
        player.set(MoveTarget, { x: bridgePos.x, y: bridgePos.y })
        player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
      }
    } else {
      migratePlayerToScene(SHIP_SCENE_ID, bridgePos)
    }
  }
  ensureTacticalOpen(false)

  pushCombatLog('副官 · 凯文：「舰长离桥 · 自动驾驶启动」', 'warn')
  logEvent('离开舰桥 · 旗舰自动驾驶接管')
  // If the player is in space scene at helm, switch to ship scene so
  // they can actually walk around. (Combat keeps running because
  // clock.mode='combat' persists.)
  if (useScene.getState().activeId !== SHIP_SCENE_ID) {
    useScene.getState().setActive(SHIP_SCENE_ID)
  }
}

// Reset cockpit state — called by combat.ts:endCombat so the next
// engagement starts cleanly (no stale piloting flag, no orphan MS).
export function resetCockpitForEndCombat(): void {
  if (getPlayerMs()) despawnPlayerMs()
  useCockpit.getState().setPiloting(null)
  useCockpit.getState().bumpMs()
  // The flagship CombatShipState is stripped by endCombat itself;
  // pilotedByPlayer goes with it.
}

// Called by combat.ts:startCombat after the flagship CombatShipState is
// (re-)attached. Marks the flagship as piloted by the player by default
// and posts the "副官" briefing chatter line into the log.
export function onCombatStarted(): void {
  useCockpit.getState().setPiloting('flagship')
  useCockpit.getState().bumpMs()
  pushCombatLog('副官 · 凯文：「舰桥岗位准备完毕 · 等候指令」', 'narr')
}
