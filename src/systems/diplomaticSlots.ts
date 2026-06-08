// Diplomatic-slot occupancy (Phase 7.0.E.4). Once wartime, a faction whose
// living-member count crosses `consulateThreshold` occupies a free generic city
// slot: `staffPerSlot` staff + `guardsPerSlot` guard NPCs spawn at the city
// arrival point (the road-connected immigrant/flight spill tile — the scene's
// first replenishment `arrivalTile`, with the airport fly-in as a fallback) and
// walk to the slot anchor. The guard carries the Guard trait (its eject branch
// is the highest-priority NPC_TREE child, gated on has(Guard) so ordinary NPCs
// are untouched). Below threshold → vacate: the slot's staff + guards depart and
// despawn, freeing the slot.
//
// Slot identity is purely the occupant's — there is no per-faction building.
//
// Event-driven: runs on day:rollover:settled (boot/diplomaticSlotsTick.ts),
// gated on isWartime() in prod. The occupancy eval itself (occupancyTick) is
// independent of the wartime/cadence gate so a debug force-tick can drive it.
//
// Perf: faction-strength is O(living characters) once per day rollover (not per
// frame); the occupy/vacate work is O(eligible factions). Guard detection lives
// in the BT (src/ai/agent.ts), O(guards) per tick. No global per-frame scan.

import type { Entity, World } from 'koota'
import { Character, Health, FactionRole, MoveTarget, EntityKey, DiplomaticSlot, Guard } from '../ecs/traits'
import { getWorld, SCENE_IDS, getActiveSceneId } from '../ecs/world'
import { spawnNPC } from '../character/spawn'
import { getAirportPlacement } from '../sim/airportPlacements'
import { FlightHub } from '../ecs/traits'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { getSceneConfig } from '../data/scenes'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
import { diplomacySlotsConfig as cfg } from '../config'
import type { FactionId } from '../config'
import {
  type SlotOccupancy, getOccupancy, factionOccupiesAnySlot, allOccupancies,
  setOccupancy, clearOccupancy, takeSeq,
} from '../sim/diplomaticSlotState'

const STAFF_KEY_PREFIX = 'dipl-staff-'
const GUARD_KEY_PREFIX = 'dipl-guard-'

// True for an NPC we ourselves spawned for a slot — excluded from the
// faction-strength count so occupancy can't bootstrap itself into a feedback
// loop (a faction's own consulate staff don't raise its strength).
function isSlotPersonnel(e: Entity): boolean {
  const k = e.get(EntityKey)?.key ?? ''
  return k.startsWith(STAFF_KEY_PREFIX) || k.startsWith(GUARD_KEY_PREFIX)
}

// Living non-player members of a faction across every scene world, excluding
// slot personnel. The player carries no FactionRole by default (neutral). A
// test-only override (setFactionMemberCountOverride) short-circuits the live
// count so the smoke can drive a faction below threshold without culling NPCs.
const memberCountOverride = new Map<string, number>()

export function factionMemberCount(factionId: string): number {
  const ov = memberCountOverride.get(factionId)
  if (ov !== undefined) return ov
  let count = 0
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Character, FactionRole, Health)) {
      if (e.get(Health)!.dead) continue
      if (e.get(FactionRole)!.faction !== factionId) continue
      if (isSlotPersonnel(e)) continue
      count += 1
    }
  }
  return count
}

export function factionStrength(factionId: string): number {
  return factionMemberCount(factionId) * cfg.memberCountScalar
}

export function setFactionMemberCountOverride(factionId: string, count: number | null): void {
  if (count === null) memberCountOverride.delete(factionId)
  else memberCountOverride.set(factionId, count)
}

export function clearFactionMemberCountOverrides(): void {
  memberCountOverride.clear()
}

// The arrival pixel point staff/guards spawn at — where flight passengers spill
// into the city. Prefers the scene's first replenishment `arrivalTile` (a
// road-connected tile by construction — immigrants and refugees use it, and it
// is adjacent to the diplomatic slots), so the walk to the slot is short and
// deterministically reachable. Falls back to the airport fly-in placement, then
// to the slot anchor (no hub / no replenishment in this scene).
function arrivalPointFor(world: World, sceneId: string, anchorX: number, anchorY: number): { x: number; y: number } {
  const cfg = getSceneConfig(sceneId)
  if (cfg.sceneType === 'micro' && cfg.replenishments && cfg.replenishments.length > 0) {
    const t = cfg.replenishments[0].arrivalTile
    return { x: t.x * TILE, y: t.y * TILE }
  }
  for (const e of world.query(FlightHub)) {
    const p = getAirportPlacement(e.get(FlightHub)!.hubId)
    if (p) return { x: p.arrivalPx.x, y: p.arrivalPx.y }
  }
  return { x: anchorX, y: anchorY }
}

interface SlotAnchorView {
  entity: Entity
  slotId: string
  anchorX: number
  anchorY: number
  rectX: number
  rectY: number
  rectW: number
  rectH: number
  exitX: number
  exitY: number
}

function slotAnchors(world: World): SlotAnchorView[] {
  const out: SlotAnchorView[] = []
  for (const e of world.query(DiplomaticSlot)) {
    const d = e.get(DiplomaticSlot)!
    out.push({
      entity: e, slotId: d.slotId,
      anchorX: d.anchorX, anchorY: d.anchorY,
      rectX: d.rectX, rectY: d.rectY, rectW: d.rectW, rectH: d.rectH,
      exitX: d.exitX, exitY: d.exitY,
    })
  }
  return out
}

function setAnchorOccupant(anchor: SlotAnchorView, factionId: string): void {
  const d = anchor.entity.get(DiplomaticSlot)!
  anchor.entity.set(DiplomaticSlot, { ...d, occupantFaction: factionId })
}

// Spawn one slot-personnel NPC at `spawnAt`, give it the Guard trait, and walk
// it to the anchor. Both staff and guards carry Guard so the BT's guard branch
// pins them to the post (holdPost) instead of letting ordinary NPC drives
// (wander/work/eat) drag them off — only guards get a non-zero detectRadiusPx,
// so staff (radius 0) hold but never eject. `title` distinguishes them in the
// inspector; `color` for the renderer.
function spawnSlotPersonnel(
  world: World, anchor: SlotAnchorView, factionId: string, key: string,
  spawnAt: { x: number; y: number }, detectRadiusPx: number, title: string, color: string,
): void {
  const ent = spawnNPC(world, {
    name: factionId, color, title,
    x: spawnAt.x, y: spawnAt.y, key,
    factionRole: { faction: factionId as FactionId, role: 'staff' },
  })
  ent.add(Guard({
    faction: factionId, slotId: anchor.slotId, detectRadiusPx,
    rectX: anchor.rectX, rectY: anchor.rectY, rectW: anchor.rectW, rectH: anchor.rectH,
    anchorX: anchor.anchorX, anchorY: anchor.anchorY,
    exitX: anchor.exitX, exitY: anchor.exitY, ejecting: false,
  }))
  ent.set(MoveTarget, { x: anchor.anchorX, y: anchor.anchorY })
}

// Spawn one slot's worth of staff + guards at the city arrival point and walk
// them to the anchor (the diegetic "arrived by flight, walked to the post").
function occupySlot(world: World, sceneId: string, anchor: SlotAnchorView, factionId: string): SlotOccupancy {
  const arrival = arrivalPointFor(world, sceneId, anchor.anchorX, anchor.anchorY)
  const seqs = takeSeq(cfg.staffPerSlot + cfg.guardsPerSlot)
  let seqIdx = 0

  const staffKeys: string[] = []
  for (let i = 0; i < cfg.staffPerSlot; i++) {
    const key = `${STAFF_KEY_PREFIX}${seqs[seqIdx++]}`
    spawnSlotPersonnel(world, anchor, factionId, key, arrival, 0, '外交人员', '#8aa0c0')
    staffKeys.push(key)
  }

  const guardKeys: string[] = []
  for (let i = 0; i < cfg.guardsPerSlot; i++) {
    const key = `${GUARD_KEY_PREFIX}${seqs[seqIdx++]}`
    spawnSlotPersonnel(world, anchor, factionId, key, arrival, cfg.guardDetectRadiusPx, '卫兵', '#c08a8a')
    guardKeys.push(key)
  }

  setAnchorOccupant(anchor, factionId)
  const occ: SlotOccupancy = { slotId: anchor.slotId, factionId, staffKeys, guardKeys }
  setOccupancy(occ)
  emitSim('log', { textZh: `战时外交：${factionId} 进驻了冯·布劳恩的一处外交席位。`, atMs: useClock.getState().gameDate.getTime() })
  return occ
}

function findByKey(world: World, key: string): Entity | null {
  for (const e of world.query(EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

// Destroy the slot's staff + guards and free the slot. (We aim them back at the
// city arrival point first only conceptually — at the day-scale cadence the
// despawn is immediate; the MoveTarget set is for the visible-departure case.)
function vacateSlot(world: World, sceneId: string, occ: SlotOccupancy): void {
  const arrival = arrivalPointFor(world, sceneId, 0, 0)
  for (const key of [...occ.staffKeys, ...occ.guardKeys]) {
    const ent = findByKey(world, key)
    if (!ent) continue
    if (ent.has(MoveTarget)) ent.set(MoveTarget, { x: arrival.x, y: arrival.y })
    ent.destroy()
  }
  for (const anchor of slotAnchors(world)) {
    if (anchor.slotId === occ.slotId) setAnchorOccupant(anchor, '')
  }
  clearOccupancy(occ.slotId)
  emitSim('log', { textZh: `战时外交：${occ.factionId} 撤离了冯·布劳恩的外交席位。`, atMs: useClock.getState().gameDate.getTime() })
}

// Re-spawn the staff + guards for every recorded occupancy at their slot
// anchors. Called from the save handler restore: the world save-diff destroys
// reset-unknown entities, so the occupancy record is the authoritative source
// for re-materializing slot personnel after a load.
export function rematerializeOccupancies(): void {
  const world = getWorld(getActiveSceneId())
  const anchorsBySlot = new Map(slotAnchors(world).map((a) => [a.slotId, a]))
  for (const occ of allOccupancies()) {
    const anchor = anchorsBySlot.get(occ.slotId)
    if (!anchor) continue
    setAnchorOccupant(anchor, occ.factionId)
    // Re-spawn at the anchor (no walk-in on load — they're already posted).
    const anchorPos = { x: anchor.anchorX, y: anchor.anchorY }
    for (const key of occ.staffKeys) {
      if (findByKey(world, key)) continue
      spawnSlotPersonnel(world, anchor, occ.factionId, key, anchorPos, 0, '外交人员', '#8aa0c0')
    }
    for (const key of occ.guardKeys) {
      if (findByKey(world, key)) continue
      spawnSlotPersonnel(world, anchor, occ.factionId, key, anchorPos, cfg.guardDetectRadiusPx, '卫兵', '#c08a8a')
    }
  }
}

// The occupancy evaluation, independent of the wartime/cadence gate. For each
// eligible faction: occupy a free slot when strength ≥ threshold and it holds
// none; vacate when strength < threshold and it holds one.
export function occupancyTick(): void {
  const sceneId = getActiveSceneId()
  const world = getWorld(sceneId)
  const anchors = slotAnchors(world)

  for (const factionId of cfg.eligibleFactions) {
    const strong = factionStrength(factionId) >= cfg.consulateThreshold
    const occupies = factionOccupiesAnySlot(factionId)
    if (strong && !occupies) {
      const free = anchors.find((a) => getOccupancy(a.slotId) === null)
      if (free) occupySlot(world, sceneId, free, factionId)
    } else if (!strong && occupies) {
      for (const occ of allOccupancies()) {
        if (occ.factionId === factionId) vacateSlot(world, sceneId, occ)
      }
    }
  }
}

// The cadence-gated daily entry point (boot/diplomaticSlotsTick.ts). Gated on
// wartime in prod; the debug force-handle calls occupancyTick directly.
export function diplomaticSlotsTick(isWar: boolean): void {
  if (!isWar) return
  occupancyTick()
}
