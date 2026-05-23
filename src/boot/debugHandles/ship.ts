// Phase 6.0 Starsector pivot — ship + space-campaign helpers. Drives
// boarding, helm, course-setting, and deterministic spaceSimSystem
// ticks for tests that need to advance the campaign without going
// through the helm Interactable tile or the React tick loop.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld } from '../../ecs/world'
import {
  IsPlayer, Position, Course,
  ShipRoom, Building, WeaponMount,
} from '../../ecs/traits'
import { boardShip, boardShipByKey, disembarkShip } from '../../sim/scene'
import { getShipState, refillFuelAndSupplies } from '../../sim/ship'
import { takeHelm } from '../../sim/helm'
import { spaceSimSystem } from '../../systems/spaceSim'
import { useDebug } from '../../debug/store'

registerDebugHandle('boardShip', boardShip)
registerDebugHandle('boardShipByKey', boardShipByKey)
registerDebugHandle('disembarkShip', disembarkShip)
registerDebugHandle('getShipState', getShipState)

registerDebugHandle('shipFuelSupply', () => {
  const s = getShipState()
  if (!s) return null
  return { fuel: s.fuelCurrent, supplies: s.suppliesCurrent }
})

registerDebugHandle('setCourse', (tx: number, ty: number, destPoiId: string | null = null) => {
  const w = getWorld('spaceCampaign')
  const e = w.queryFirst(IsPlayer, Course)
  if (!e) return false
  e.set(Course, { tx, ty, destPoiId, active: true })
  return true
})

registerDebugHandle('shipPos', () => {
  const w = getWorld('spaceCampaign')
  const e = w.queryFirst(IsPlayer, Position)
  if (!e) return null
  return { ...e.get(Position)! }
})

registerDebugHandle('takeHelmCheat', () => takeHelm())

registerDebugHandle('tickSpace', (dtSec: number) => {
  const w = getWorld('spaceCampaign')
  spaceSimSystem(w, dtSec)
  return true
})

registerDebugHandle('moveShipTo', (x: number, y: number) => {
  const w = getWorld('spaceCampaign')
  const e = w.queryFirst(IsPlayer, Position)
  if (!e) return false
  e.set(Position, { x, y })
  return true
})

registerDebugHandle('setInfiniteFuelSupply', (enabled: boolean = true) => {
  useDebug.getState().setInfiniteFuelSupply(enabled)
  if (enabled) refillFuelAndSupplies()
  return enabled
})

// Snapshot of the ship-interior scene's class-specific layout. Used by
// the drydock-boarding smoke to assert that a flagship-switch reseeds
// rooms / mounts from the new ship class authoring (e.g. Pegasus brings
// warRoom + brig rooms and 6 mounts; lightFreighter brings neither).
registerDebugHandle('shipSceneLayoutSnapshot', () => {
  const w = getWorld('playerShipInterior')
  const roomIds: string[] = []
  for (const e of w.query(ShipRoom)) {
    roomIds.push(e.get(ShipRoom)!.roomDefId)
  }
  return {
    roomIds: roomIds.slice().sort(),
    mountCount: Array.from(w.query(WeaponMount)).length,
    roomBuildings: Array.from(w.query(Building, ShipRoom)).length,
  }
})
