// Phase 6.0 Slice G — bridge-mode combat tick + manager. Drives the FTL-shape
// active-pause loop: weapon charge, shield regen, hull damage, simple enemy
// AI. Operates against the player ship world (`playerShipInterior`) where
// the EnemyShipState entity is spawned at startCombat() and torn down at
// endCombat().
//
// Tick model (per frame, when clock.mode === 'combat' AND store.paused === false):
//   1. Player weapon charge (gated by weapons-system power + integrity)
//   2. Player weapon firing  (consume ready + targeted mounts)
//   3. Enemy weapon charge   (gated by enemy weapons-system integrity)
//   4. Enemy AI firing       (random non-empty player room)
//   5. Shield regen          (both ships)
//   6. Resolution check      (hull <= 0 ⇒ end)
//
// Read but don't copy: FTL-Hyperspace ShipManager.zhl (charge bookkeeping),
// CombatAI.zhl (target selection), WeaponSystem.zhl + ShieldSystem.zhl.

import type { World, Entity } from 'koota'
import { create } from 'zustand'
import {
  Ship,
  ShipSystemState,
  WeaponMount,
  EnemyShipState,
  EntityKey,
  IsPlayer,
  Money,
} from '../ecs/traits'
import type { SystemId } from '../data/shipSystems'
import { getEnemyShip } from '../data/enemyShips'
import { getWeapon, type WeaponDef } from '../data/weapons'
import { useClock } from '../sim/clock'
import { setInCombat, damageHull } from '../sim/ship'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { logEvent } from '../ui/EventLog'

const SHIP_SCENE_ID = 'playerShipInterior'

// Combat UI store. Owns transient interaction state — pause toggle, the
// player's currently-selected weapon (so room-clicks know which mount to
// retarget), and modal open/close. Combat *data* lives in ECS traits; this
// store deliberately keeps zero gameplay numbers so save/load stays simple.
interface CombatState {
  open: boolean
  paused: boolean
  // Weapon mount index the player has highlighted in the queue. Clicking an
  // enemy room sets that mount's targetEnemyRoomId.
  selectedMountIdx: number | null
  // Last animated event line — short-lived hint banner over the bridge UI.
  lastFlashZh: string
  lastFlashAtMs: number
  setOpen: (open: boolean) => void
  togglePause: () => void
  setSelectedMount: (idx: number | null) => void
  flash: (textZh: string) => void
  reset: () => void
}

export const useCombatStore = create<CombatState>((set) => ({
  open: false,
  paused: true,
  selectedMountIdx: null,
  lastFlashZh: '',
  lastFlashAtMs: 0,
  setOpen: (open) => set({ open }),
  togglePause: () => set((s) => {
    const next = !s.paused
    useClock.getState().setSpeed(next ? 0 : 1)
    return { paused: next }
  }),
  setSelectedMount: (selectedMountIdx) => set({ selectedMountIdx }),
  flash: (lastFlashZh) => set({ lastFlashZh, lastFlashAtMs: performance.now() }),
  reset: () => set({
    open: false,
    paused: true,
    selectedMountIdx: null,
    lastFlashZh: '',
    lastFlashAtMs: 0,
  }),
}))

function shipWorld(): World {
  return getWorld(SHIP_SCENE_ID)
}

function getPlayerShip(): Entity | undefined {
  return shipWorld().queryFirst(Ship)
}

function getEnemyEntity(): Entity | undefined {
  return shipWorld().queryFirst(EnemyShipState)
}

function findPlayer(): Entity | undefined {
  // Player IsPlayer lives in whichever scene world they currently inhabit
  // (city or ship). startCombat is callable from any scene, so we scan
  // every registered scene world rather than assuming the active one.
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

function getPlayerSystemState(systemId: SystemId): {
  entity: Entity
  level: number
  powerAlloc: number
  integrityPct: number
} | null {
  const w = shipWorld()
  for (const e of w.query(ShipSystemState)) {
    const s = e.get(ShipSystemState)!
    if (s.systemId === systemId) {
      return {
        entity: e,
        level: s.level,
        powerAlloc: s.powerAlloc,
        integrityPct: s.integrityPct,
      }
    }
  }
  return null
}

// Public — encounters.ts calls this when the player picks a combat outcome.
// Spawns the enemy entity, forces clock into combat mode, opens the bridge
// overlay paused (FTL convention).
export function startCombat(enemyShipId: string): void {
  const blueprint = getEnemyShip(enemyShipId)
  const w = shipWorld()

  // Defensive: if a previous combat didn't tear down cleanly, scrub the
  // stale enemy entity before spawning a fresh one.
  for (const e of w.query(EnemyShipState)) e.destroy()

  w.spawn(
    EnemyShipState({
      shipClassId: blueprint.id,
      hullCurrent: blueprint.hullMax,
      hullMax: blueprint.hullMax,
      shields: {
        layers: blueprint.shieldsMax,
        layersMax: blueprint.shieldsMax,
        rechargeSec: blueprint.shieldsRechargeSec,
      },
      systems: { ...blueprint.systems },
      weapons: blueprint.weapons.map((id) => ({ weaponId: id, chargeSec: 0, ready: false })),
      rooms: blueprint.rooms.map((r) => ({
        roomId: r.id,
        nameZh: r.nameZh,
        system: r.system,
        integrityPct: 1,
      })),
      ai: {
        aggression: blueprint.ai.aggression,
        retreatThreshold: blueprint.ai.retreatThresholdPct,
      },
    }),
    EntityKey({ key: 'enemy-ship' }),
  )

  setInCombat(true)
  useClock.getState().setMode('combat')
  useClock.getState().setSpeed(0)
  useCombatStore.getState().reset()
  useCombatStore.getState().setOpen(true)
  resetTransientCombatState()
  logEvent(`战斗开始 · 对手: ${blueprint.nameZh}`)
}

export type CombatOutcome = 'victory' | 'defeat' | 'flee'

export function endCombat(outcome: CombatOutcome): void {
  const w = shipWorld()
  for (const e of w.query(EnemyShipState)) e.destroy()

  // Reset player weapon mounts so a follow-up encounter starts cold.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    e.set(WeaponMount, { ...m, chargeSec: 0, ready: false, targetEnemyRoomId: null })
  }

  setInCombat(false)
  useClock.getState().setMode('normal')
  useClock.getState().setSpeed(1)
  useCombatStore.getState().reset()
  resetTransientCombatState()

  if (outcome === 'victory') {
    const reward = 800 + Math.floor(Math.random() * 700)
    const player = findPlayer()
    if (player) {
      const m = player.get(Money) ?? { amount: 0 }
      player.set(Money, { amount: m.amount + reward })
    }
    logEvent(`战斗胜利 · 缴获 ¥${reward}`)
  } else if (outcome === 'defeat') {
    // Spine: defeat is non-game-over. Slice 6.2 wires permadeath / POW.
    // Reset player hull to 1 so saves don't softlock at hull 0.
    const ship = getPlayerShip()
    if (ship) {
      const s = ship.get(Ship)!
      ship.set(Ship, { ...s, hullCurrent: Math.max(1, s.hullCurrent) })
    }
    logEvent('战斗失败 · 飞船重创(永久死亡处理待 6.2)')
  } else {
    logEvent('战斗脱离')
  }
}

function applyDamageToEnemy(
  enemyEnt: Entity,
  weapon: WeaponDef,
  targetRoomId: string | null,
): { absorbed: boolean; destroyed: boolean } {
  const e = enemyEnt.get(EnemyShipState)!
  if (e.shields.layers > 0 && !weapon.pierceShields) {
    enemyEnt.set(EnemyShipState, {
      ...e,
      shields: { ...e.shields, layers: e.shields.layers - 1 },
    })
    return { absorbed: true, destroyed: false }
  }

  const nextHull = Math.max(0, e.hullCurrent - weapon.damage)
  let nextRooms = e.rooms
  let nextSystems = e.systems
  if (weapon.systemDamage && targetRoomId) {
    const targetRoom = e.rooms.find((r) => r.roomId === targetRoomId)
    if (targetRoom) {
      const dmg = weapon.systemDamage / 4
      nextRooms = e.rooms.map((r) =>
        r.roomId === targetRoomId
          ? { ...r, integrityPct: Math.max(0, r.integrityPct - dmg) }
          : r,
      )
      if (targetRoom.system) {
        const sysId = targetRoom.system
        const cur = e.systems[sysId]
        if (cur) {
          nextSystems = {
            ...e.systems,
            [sysId]: { ...cur, integrityPct: Math.max(0, cur.integrityPct - dmg) },
          }
        }
      }
    }
  }
  enemyEnt.set(EnemyShipState, {
    ...e,
    hullCurrent: nextHull,
    rooms: nextRooms,
    systems: nextSystems,
  })
  return { absorbed: false, destroyed: nextHull <= 0 }
}

function applyDamageToPlayer(
  weapon: WeaponDef,
  targetSystemId: SystemId | null,
): { absorbed: boolean; destroyed: boolean } {
  const ship = getPlayerShip()
  if (!ship) return { absorbed: false, destroyed: false }

  if (playerShields.layers > 0 && !weapon.pierceShields) {
    playerShields.layers -= 1
    return { absorbed: true, destroyed: false }
  }

  const result = damageHull(weapon.damage)

  if (weapon.systemDamage && targetSystemId) {
    const sysState = getPlayerSystemState(targetSystemId)
    if (sysState) {
      const dmg = weapon.systemDamage / 4
      const next = Math.max(0, sysState.integrityPct - dmg)
      const cur = sysState.entity.get(ShipSystemState)!
      sysState.entity.set(ShipSystemState, { ...cur, integrityPct: next })
    }
  }

  return { absorbed: false, destroyed: result.destroyed }
}

// Module-local accumulators. Reset on startCombat / endCombat. Combat is
// in-memory only — see Slice I notes.
const playerShields = { layers: -1, regenAccumSec: 0 }
let enemyShieldRegenAccumSec = 0

const PLAYER_SHIELDS_RECHARGE_SEC = 6

function resetTransientCombatState(): void {
  playerShields.layers = -1
  playerShields.regenAccumSec = 0
  enemyShieldRegenAccumSec = 0
}

export function combatSystem(_world: World, dtMs: number): void {
  const enemyEnt = getEnemyEntity()
  if (!enemyEnt) return
  const store = useCombatStore.getState()
  if (store.paused) return

  const dtSec = dtMs / 1000
  const w = shipWorld()
  const ship = getPlayerShip()
  if (!ship) return

  // -- 1. Player weapon charge -------------------------------------------------
  const weaponsSys = getPlayerSystemState('weapons')
  const weaponsOnline = !!weaponsSys && weaponsSys.integrityPct > 0
  let powerLeft = weaponsSys?.powerAlloc ?? 0
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId) continue
    const def = getWeapon(m.weaponId)
    const canPower = weaponsOnline && powerLeft >= def.powerCost
    let charge = m.chargeSec
    if (canPower) {
      powerLeft -= def.powerCost
      charge = Math.min(def.chargeSec, charge + dtSec)
    } else {
      charge = Math.max(0, charge - dtSec * 0.5)
    }
    const ready = canPower && charge >= def.chargeSec
    if (ready !== m.ready || charge !== m.chargeSec) {
      e.set(WeaponMount, { ...m, chargeSec: charge, ready })
    }
  }

  // -- 2. Player weapon firing -------------------------------------------------
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId || !m.ready || !m.targetEnemyRoomId) continue
    const def = getWeapon(m.weaponId)
    const res = applyDamageToEnemy(enemyEnt, def, m.targetEnemyRoomId)
    e.set(WeaponMount, { ...m, chargeSec: 0, ready: false, targetEnemyRoomId: null })
    useCombatStore.getState().flash(
      res.absorbed ? `${def.nameZh} → 命中护盾` : `${def.nameZh} → 命中船体`,
    )
    if (res.destroyed) {
      endCombat('victory')
      return
    }
  }

  // -- 3. Enemy weapon charge --------------------------------------------------
  const enemy = enemyEnt.get(EnemyShipState)!
  const enemyWeaponsState = enemy.systems.weapons
  const enemyWeaponsOnline = !enemyWeaponsState || enemyWeaponsState.integrityPct > 0
  const updatedEnemyWeapons = enemy.weapons.map((wpn) => {
    if (!enemyWeaponsOnline) {
      return { ...wpn, chargeSec: Math.max(0, wpn.chargeSec - dtSec * 0.5), ready: false }
    }
    const def = getWeapon(wpn.weaponId)
    const charge = Math.min(def.chargeSec, wpn.chargeSec + dtSec * (0.5 + enemy.ai.aggression))
    return { ...wpn, chargeSec: charge, ready: charge >= def.chargeSec }
  })

  // -- 4. Enemy AI firing ------------------------------------------------------
  // Pick a random player system room. Spine targeting is deliberately dumb;
  // CombatAI.zhl has the priority queue we'll port in 6.1.
  const allPlayerSystemIds: SystemId[] = []
  for (const sysEnt of w.query(ShipSystemState)) {
    const s = sysEnt.get(ShipSystemState)!
    allPlayerSystemIds.push(s.systemId)
  }
  let playerDestroyed = false
  const finalEnemyWeapons = updatedEnemyWeapons.map((wpn) => {
    if (!wpn.ready) return wpn
    const def = getWeapon(wpn.weaponId)
    const targetSys = allPlayerSystemIds.length
      ? allPlayerSystemIds[Math.floor(Math.random() * allPlayerSystemIds.length)]
      : null
    const res = applyDamageToPlayer(def, targetSys)
    useCombatStore.getState().flash(
      res.absorbed ? `敌方${def.nameZh} → 命中护盾` : `敌方${def.nameZh} → 命中船体`,
    )
    if (res.destroyed) playerDestroyed = true
    return { ...wpn, chargeSec: 0, ready: false }
  })

  // -- 5. Shield regen ---------------------------------------------------------
  let enemyShieldLayers = enemy.shields.layers
  enemyShieldRegenAccumSec += dtSec
  if (enemy.shields.rechargeSec > 0 && enemyShieldLayers < enemy.shields.layersMax) {
    while (
      enemyShieldRegenAccumSec >= enemy.shields.rechargeSec
      && enemyShieldLayers < enemy.shields.layersMax
    ) {
      enemyShieldRegenAccumSec -= enemy.shields.rechargeSec
      enemyShieldLayers += 1
    }
  } else {
    enemyShieldRegenAccumSec = 0
  }

  const playerShieldsSys = getPlayerSystemState('shields')
  const playerShieldCap = playerShieldsSys
    ? Math.max(0, Math.min(playerShieldsSys.level, playerShieldsSys.powerAlloc))
    : 0
  if (playerShields.layers < 0) {
    playerShields.layers = playerShieldCap
    playerShields.regenAccumSec = 0
  }
  playerShields.regenAccumSec += dtSec
  while (
    playerShields.regenAccumSec >= PLAYER_SHIELDS_RECHARGE_SEC
    && playerShields.layers < playerShieldCap
  ) {
    playerShields.regenAccumSec -= PLAYER_SHIELDS_RECHARGE_SEC
    playerShields.layers += 1
  }
  if (playerShields.layers > playerShieldCap) {
    playerShields.layers = playerShieldCap
  }

  // Persist enemy mutations from steps 3-5. Always write — diffing per-array
  // entry isn't worth the bookkeeping for a 3-room enemy ship.
  enemyEnt.set(EnemyShipState, {
    ...enemyEnt.get(EnemyShipState)!,
    weapons: finalEnemyWeapons,
    shields: { ...enemy.shields, layers: enemyShieldLayers },
  })

  // -- 6. Resolution check -----------------------------------------------------
  if (playerDestroyed) {
    endCombat('defeat')
    return
  }
  const refreshedEnemy = enemyEnt.get(EnemyShipState)!
  if (refreshedEnemy.hullCurrent <= 0) {
    endCombat('victory')
    return
  }
  const refreshedShip = ship.get(Ship)!
  if (refreshedShip.hullCurrent <= 0) {
    endCombat('defeat')
    return
  }
}

// Exposed for the BridgeOverlay so the HUD can render the player's current
// shield-layer count consistently with the damage handler.
export function getPlayerShieldLayers(): number {
  return Math.max(0, playerShields.layers)
}

export function getPlayerShieldCap(): number {
  const s = getPlayerSystemState('shields')
  if (!s) return 0
  return Math.max(0, Math.min(s.level, s.powerAlloc))
}

// Exposed so room-click handlers in BridgeOverlay can target a weapon mount.
export function setMountTarget(mountIdx: number, enemyRoomId: string | null): void {
  const w = shipWorld()
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (m.mountIdx === mountIdx) {
      e.set(WeaponMount, { ...m, targetEnemyRoomId: enemyRoomId })
      return
    }
  }
}
