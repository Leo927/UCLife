// Phase 5.5.6 facility-tier infrastructure (Design/social/facility-tiers.md,
// issue #141). Four universal tier knobs per owned facility, research-gated,
// paid in credits + downtime. Tier 1 is the pre-tier baseline: a Building
// without the FacilityTiers trait behaves exactly as before, so the system
// is zero-cost until the player starts an upgrade.
//
// Perf: tier reads are per-shift / per-day formula inputs (O(1) ladder
// lookups); facilityTierDowntimeSystem walks only Buildings carrying the
// trait, once per day rollover. N = owned facilities (tens). No per-tick
// or per-frame work.

import type { Entity, World } from 'koota'
import {
  Building, EntityKey, Faction, FacilityTiers, FactionUnlocks, Interactable,
  Owner, Position, TemplateRef, Wall, Workstation,
  type FacilityTierUpgrade,
} from '../ecs/traits'
import {
  facilityTierLadder, TIER_KNOBS, type TierKnob, type TierRow,
} from '../data/facilityTypes'
import { getObjectTemplate, type ObjectTemplateId } from '../data/objectTemplates'
import { researchCatalog } from '../data/research'
import { hasFactionUnlock } from '../ecs/factionEffects'
import { applyOwnerFundDelta, ownerCanPay } from '../ecs/ownership'
import { worldConfig } from '../config'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

const TILE = worldConfig.tilePx

export const TIER_KNOB_LABEL_ZH: Record<TierKnob, string> = {
  jobSiteCount: '岗位数量',
  efficiency: '工位效率',
  operatingHours: '营业时间',
  loyaltyDrift: '在岗忠诚',
}

// ── Read-side helpers ───────────────────────────────────────────────────

function currentTier(building: Entity, knob: TierKnob): number {
  if (!building.has(FacilityTiers)) return 1
  return building.get(FacilityTiers)![knob]
}

// The whole facility is offline while an install with downtime is running:
// seats produce no output and pay no salary; maintenance still applies
// (workSystem gates on this; dailyEconomics charges maintenance regardless).
export function isFacilityInDowntime(building: Entity): boolean {
  if (!building.has(FacilityTiers)) return false
  const up = building.get(FacilityTiers)!.upgrade
  return up !== null && up.daysRemaining > 0
}

// Efficiency multiplier folded into every per-shift output formula
// (work revenue, research progress). Tier-1 mul is authored as 1.0, and a
// missing ladder/trait reads as 1.0 — pre-tier behavior.
export function facilityEfficiencyMul(building: Entity): number {
  const ladder = facilityTierLadder(building.get(Building)?.typeId ?? '')
  if (!ladder) return 1.0
  const tier = currentTier(building, 'efficiency')
  return ladder.efficiency.find((r) => r.tier === tier)?.mul ?? 1.0
}

// Resolve the FactionUnlocks carrier the tier gates check — same routing
// as researchSystem: faction owners use their own unlock set; character
// owners (the pre-faction-creation player) use the 'civilian' alias the
// research spine stamps unlocks onto.
function resolveUnlockFaction(world: World, building: Entity): Entity | null {
  const owner = building.get(Owner)
  if (!owner) return null
  if (owner.kind === 'faction' && owner.entity?.has(FactionUnlocks)) return owner.entity
  if (owner.kind === 'character') {
    for (const fEnt of world.query(Faction, FactionUnlocks)) {
      if (fEnt.get(Faction)!.id === 'civilian') return fEnt
    }
  }
  return null
}

function researchNameForUnlock(unlockId: string): string | null {
  for (const spec of researchCatalog) {
    if (spec.unlocks.includes(unlockId)) return spec.nameZh
  }
  return null
}

// ── Panel view ──────────────────────────────────────────────────────────

export type TierRowState = 'locked' | 'available' | 'inProgress' | 'done'

export interface TierRowView {
  knob: TierKnob
  knobLabelZh: string
  tier: number
  state: TierRowState
  // locked rows stay visible with the gate named inline — a silent gate
  // is a bug (doc § Gate states the panel exposes).
  gateTextZh?: string
  creditCost?: number
  downtimeDays?: number
  daysRemaining?: number
  affordable?: boolean
}

export function tierPanelView(world: World, building: Entity): TierRowView[] {
  const ladder = facilityTierLadder(building.get(Building)?.typeId ?? '')
  if (!ladder) return []
  const unlockFaction = resolveUnlockFaction(world, building)
  const upgrade = building.has(FacilityTiers)
    ? building.get(FacilityTiers)!.upgrade
    : null

  const rows: TierRowView[] = []
  for (const knob of TIER_KNOBS) {
    const cur = currentTier(building, knob)
    for (const row of ladder[knob]) {
      const base: TierRowView = {
        knob, knobLabelZh: TIER_KNOB_LABEL_ZH[knob], tier: row.tier, state: 'done',
      }
      if (row.tier <= cur) {
        rows.push(base)
        continue
      }
      if (upgrade && upgrade.knob === knob && upgrade.toTier === row.tier) {
        rows.push({ ...base, state: 'inProgress', daysRemaining: upgrade.daysRemaining })
        continue
      }
      if (row.tier > cur + 1) {
        rows.push({
          ...base, state: 'locked',
          gateTextZh: `需要先完成 ${TIER_KNOB_LABEL_ZH[knob]} ${row.tier - 1} 级`,
        })
        continue
      }
      const unlockMissing = !!row.requiresUnlock
        && (!unlockFaction || !hasFactionUnlock(unlockFaction, row.requiresUnlock))
      if (unlockMissing) {
        const name = researchNameForUnlock(row.requiresUnlock!)
        rows.push({
          ...base, state: 'locked',
          gateTextZh: name ? `需要研究: ${name}` : `需要解锁: ${row.requiresUnlock}`,
        })
        continue
      }
      rows.push({
        ...base, state: 'available',
        creditCost: row.creditCost, downtimeDays: row.downtimeDays,
        affordable: ownerCanPay(building, row.creditCost ?? 0),
      })
    }
  }
  return rows
}

// ── Upgrade flow ────────────────────────────────────────────────────────

export interface StartUpgradeResult {
  ok: boolean
  reason?: 'no-ladder' | 'no-row' | 'not-next' | 'busy' | 'locked' | 'fund'
}

export function startTierUpgrade(
  world: World,
  building: Entity,
  knob: TierKnob,
  toTier: number,
): StartUpgradeResult {
  const ladder = facilityTierLadder(building.get(Building)?.typeId ?? '')
  if (!ladder) return { ok: false, reason: 'no-ladder' }
  const row = ladder[knob].find((r) => r.tier === toTier)
  if (!row) return { ok: false, reason: 'no-row' }
  if (toTier !== currentTier(building, knob) + 1) return { ok: false, reason: 'not-next' }

  if (!building.has(FacilityTiers)) building.add(FacilityTiers)
  const tiers = building.get(FacilityTiers)!
  if (tiers.upgrade !== null) return { ok: false, reason: 'busy' }

  if (row.requiresUnlock) {
    const unlockFaction = resolveUnlockFaction(world, building)
    if (!unlockFaction || !hasFactionUnlock(unlockFaction, row.requiresUnlock)) {
      return { ok: false, reason: 'locked' }
    }
  }

  const cost = row.creditCost ?? 0
  if (!ownerCanPay(building, cost)) return { ok: false, reason: 'fund' }
  applyOwnerFundDelta(building, -cost)

  const upgrade: FacilityTierUpgrade = {
    knob, toTier, daysRemaining: row.downtimeDays ?? 0,
  }
  if (upgrade.daysRemaining <= 0) {
    // Zero-downtime rows (e.g. a culture program) install on the spot.
    building.set(FacilityTiers, { ...tiers, upgrade: null })
    applyTier(world, building, knob, row)
    return { ok: true }
  }
  building.set(FacilityTiers, { ...tiers, upgrade })
  return { ok: true }
}

export interface DowntimeResult {
  // EntityKeys of buildings whose upgrade completed this rollover.
  applied: string[]
}

// Day-rollover countdown. Runs right after dailyEconomicsSystem so a
// completed install's new tier values are live for the *next* day's
// shifts and economics tick.
export function facilityTierDowntimeSystem(world: World): DowntimeResult {
  const result: DowntimeResult = { applied: [] }
  for (const building of world.query(Building, FacilityTiers)) {
    const tiers = building.get(FacilityTiers)!
    if (tiers.upgrade === null) continue
    const daysRemaining = tiers.upgrade.daysRemaining - 1
    if (daysRemaining > 0) {
      building.set(FacilityTiers, {
        ...tiers, upgrade: { ...tiers.upgrade, daysRemaining },
      })
      continue
    }
    const { knob, toTier } = tiers.upgrade
    const ladder = facilityTierLadder(building.get(Building)?.typeId ?? '')
    const row = ladder?.[knob].find((r) => r.tier === toTier)
    building.set(FacilityTiers, { ...tiers, upgrade: null })
    if (row) applyTier(world, building, knob, row)
    result.applied.push(building.get(EntityKey)?.key ?? '')
    emitSim('log', {
      textZh: `「${building.get(Building)?.label ?? '设施'}」升级完成：${TIER_KNOB_LABEL_ZH[knob]} ${toTier} 级`,
      atMs: useClock.getState().gameDate.getTime(),
    })
  }
  return result
}

function applyTier(world: World, building: Entity, knob: TierKnob, row: TierRow): void {
  const tiers = building.get(FacilityTiers)!
  building.set(FacilityTiers, { ...tiers, [knob]: row.tier })
  if (knob === 'jobSiteCount') spawnTierSeats(world, building, row)
}

// ── Runtime seat spawn (jobSiteCount payload) ───────────────────────────

function tierSeatKey(buildingKey: string, tier: number, idx: number): string {
  return `ws-tier-${buildingKey}-t${tier}-${idx}`
}

// Idempotent: a seat whose deterministic EntityKey already exists is not
// spawned again (restore re-runs this for completed tiers on load).
function spawnTierSeats(world: World, building: Entity, row: TierRow): void {
  const buildingKey = building.get(EntityKey)?.key ?? ''
  const existing = new Set<string>()
  for (const e of world.query(Workstation, EntityKey)) {
    existing.add(e.get(EntityKey)!.key)
  }
  const stations = row.addStations ?? []
  const spots = findOpenSeatTiles(world, building, stations.length)
  for (let i = 0; i < stations.length; i++) {
    const key = tierSeatKey(buildingKey, row.tier, i)
    if (existing.has(key)) continue
    const pos = spots.shift()
    if (!pos) break
    const templateId = stations[i] as ObjectTemplateId
    const template = getObjectTemplate(templateId)
    if (template.kind !== 'workstation') continue
    world.spawn(
      Position(pos),
      Interactable({ kind: template.interactableKind ?? 'work', label: template.labelZh ?? '工位' }),
      Workstation({ specId: template.specId, occupant: null }),
      EntityKey({ key }),
      TemplateRef({ id: templateId }),
    )
  }
}

// Pick free interior tiles for new seats: prefer tiles adjacent to an
// existing workstation on the open floor (guaranteed walkable
// neighborhood), skipping tiles already holding a positioned entity,
// tiles inside Wall rects, and the 1-tile border band (exterior walls).
// Deterministic: iteration order is query order + fixed offsets.
function findOpenSeatTiles(
  world: World,
  building: Entity,
  count: number,
): { x: number; y: number }[] {
  const bld = building.get(Building)!
  const occupied = new Set<string>()
  for (const e of world.query(Position)) {
    const p = e.get(Position)!
    if (!insideBuilding(bld, p.x, p.y)) continue
    occupied.add(tileKeyOf(p.x, p.y))
  }
  const walls: { x: number; y: number; w: number; h: number }[] = []
  for (const e of world.query(Wall)) {
    walls.push(e.get(Wall)!)
  }

  const out: { x: number; y: number }[] = []
  const offsets = [
    { dx: TILE, dy: 0 }, { dx: -TILE, dy: 0 },
    { dx: 0, dy: TILE }, { dx: 0, dy: -TILE },
    { dx: TILE, dy: TILE }, { dx: -TILE, dy: TILE },
  ]
  const tryTake = (x: number, y: number): boolean => {
    if (out.length >= count) return true
    if (!insideInterior(bld, x, y)) return false
    const key = tileKeyOf(x, y)
    if (occupied.has(key)) return false
    if (walls.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h)) return false
    occupied.add(key)
    out.push({ x, y })
    return out.length >= count
  }

  for (const ws of world.query(Workstation, Position)) {
    const p = ws.get(Position)!
    if (!insideBuilding(bld, p.x, p.y)) continue
    for (const o of offsets) {
      if (tryTake(p.x + o.dx, p.y + o.dy)) return out
    }
  }
  // Fallback: scan the interior grid.
  for (let ty = bld.y + TILE; ty < bld.y + bld.h - TILE; ty += TILE) {
    for (let tx = bld.x + TILE; tx < bld.x + bld.w - TILE; tx += TILE) {
      if (tryTake(tx + TILE / 2, ty + TILE / 2)) return out
    }
  }
  return out
}

function insideBuilding(
  bld: { x: number; y: number; w: number; h: number },
  x: number, y: number,
): boolean {
  return x >= bld.x && x < bld.x + bld.w && y >= bld.y && y < bld.y + bld.h
}

function insideInterior(
  bld: { x: number; y: number; w: number; h: number },
  x: number, y: number,
): boolean {
  return x >= bld.x + TILE && x < bld.x + bld.w - TILE
    && y >= bld.y + TILE && y < bld.y + bld.h - TILE
}

function tileKeyOf(x: number, y: number): string {
  return `${Math.floor(x / TILE)}:${Math.floor(y / TILE)}`
}

// ── Save contract (per-Building EntityKey) ──────────────────────────────

export interface FacilityTierSnap {
  buildingKey: string
  jobSiteCount: number
  efficiency: number
  operatingHours: number
  loyaltyDrift: number
  upgrade: FacilityTierUpgrade | null
}

export function snapshotFacilityTiers(world: World): FacilityTierSnap[] {
  const out: FacilityTierSnap[] = []
  for (const b of world.query(Building, FacilityTiers, EntityKey)) {
    const t = b.get(FacilityTiers)!
    out.push({
      buildingKey: b.get(EntityKey)!.key,
      jobSiteCount: t.jobSiteCount,
      efficiency: t.efficiency,
      operatingHours: t.operatingHours,
      loyaltyDrift: t.loyaltyDrift,
      upgrade: t.upgrade ? { ...t.upgrade } : null,
    })
  }
  return out
}

// The world rebuilds from seed on load, so tier-added seats don't exist
// yet — re-apply each completed jobSiteCount tier (idempotent via the
// deterministic seat EntityKeys). Seat occupancy is not restored; workers
// re-fill through the normal roster flows.
export function restoreFacilityTiers(world: World, snaps: FacilityTierSnap[]): void {
  const byKey = new Map<string, Entity>()
  for (const b of world.query(Building, EntityKey)) {
    byKey.set(b.get(EntityKey)!.key, b)
  }
  for (const s of snaps) {
    const building = byKey.get(s.buildingKey)
    if (!building) continue
    if (!building.has(FacilityTiers)) building.add(FacilityTiers)
    building.set(FacilityTiers, {
      jobSiteCount: s.jobSiteCount,
      efficiency: s.efficiency,
      operatingHours: s.operatingHours,
      loyaltyDrift: s.loyaltyDrift,
      upgrade: s.upgrade ? { ...s.upgrade } : null,
    })
    const ladder = facilityTierLadder(building.get(Building)?.typeId ?? '')
    if (!ladder) continue
    for (const row of ladder.jobSiteCount) {
      if (row.tier > 1 && row.tier <= s.jobSiteCount) {
        spawnTierSeats(world, building, row)
      }
    }
  }
}
