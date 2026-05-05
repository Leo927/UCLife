// Phase 6.0 Starsector pivot — ship + space-campaign helpers. Drives
// boarding, helm, course-setting, and deterministic spaceSimSystem
// ticks for tests that need to advance the campaign without going
// through the helm Interactable tile or the React tick loop.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld } from '../../ecs/world'
import { IsPlayer, Position, Course } from '../../ecs/traits'
import { boardShip, disembarkShip } from '../../sim/scene'
import { getShipState } from '../../sim/ship'
import { takeHelm } from '../../sim/helm'
import { spaceSimSystem } from '../../systems/spaceSim'

registerDebugHandle('boardShip', boardShip)
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
