// Phase 4.2 — contagion system. Per active-zone tick, finds every
// symptomatic infectious carrier in the Active set, scans for
// susceptibles within the template's contactRadius (tile-space), rolls
// transmissionRate, and onsets a fresh ConditionInstance on hit.
//
// Active-only by design: the inactive zone gets a coarse-aggregate
// model (see prevalenceForTemplate + the daily aggregate tick) so we
// don't pay per-NPC contact checks for the rest of the city.
//
// Determinism: rolls are seeded by (tickId, carrier key, susceptible
// key, template id), so re-running the same scene with the same world
// seed reproduces the same infection chain.
//
// Perf budget per the design (physiology.md § Contagion):
//   N = 200 active NPCs, up to 50 infectious. Per active-zone tick:
//   ~50 broad-phase queries × ~10 hits = 500 contact rolls. Target
//   <0.3 ms/tick at 1× speed. Set CONTAGION_PROF=1 to log per-tick
//   timings + per-template hit counts to console.
//
// Complexity: O(carriers × actives) distance checks; at N=200 with
// 50 carriers that's 10k float comparisons per tick — well under
// budget. The design calls for an rbush broad-phase if the catalog
// grows; the linear scan is the simplest data structure that
// compiles, with a swap path the same shape as activeZoneSystem.

import type { Entity, World } from 'koota'
import {
  Active, Character, Conditions, EntityKey, Health, Position,
} from '../ecs/traits'
import { CONDITIONS, type ConditionTemplate } from '../character/conditions'
import { onsetCondition } from './physiology'
import { SeededRng } from '../procgen/rng'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

// Snapshot of contagious templates so we don't filter the catalog on
// every tick. Recomputed on demand if a future hot-reload extends the
// catalog at runtime (not a current concern).
let infectiousTemplates: readonly ConditionTemplate[] | null = null

function getInfectiousTemplates(): readonly ConditionTemplate[] {
  if (infectiousTemplates) return infectiousTemplates
  const out: ConditionTemplate[] = []
  for (const t of CONDITIONS) {
    if (t.infectious === true) out.push(t)
  }
  infectiousTemplates = out
  return out
}

// Symptomatic = phase emits modifiers AND the body is actively shedding.
// Incubating carriers have severity 0 and (per the spec) do not transmit;
// recovering carriers still do until severity hits 0 and the instance
// resolves.
function isSymptomatic(phase: string): boolean {
  return phase === 'rising' || phase === 'peak' || phase === 'recovering' || phase === 'stalled'
}

// Stable per-entity key. Falls back to the koota entity id when an
// EntityKey hasn't been added yet (some test spawns skip it).
function keyOf(entity: Entity): string {
  const k = entity.get(EntityKey)
  return k ? k.key : String(entity)
}

// Per-tick rng — same tick + same pair of characters + same template
// always produces the same roll. Lets a smoke test pin a deterministic
// transmission by walking up to an infected NPC at a known game-min.
function pairRng(tickId: number, carrierKey: string, susceptibleKey: string, templateId: string): SeededRng {
  return SeededRng.fromString(`contagion:${tickId}:${carrierKey}:${susceptibleKey}:${templateId}`)
}

// ──────────────────────────────────────────────────────────────────
// Per-tick contagion stats. Enable via CONTAGION_PROF=1 (env var) or
// flip `contagionStats.enabled = true` from devtools.
// ──────────────────────────────────────────────────────────────────
export const contagionStats = {
  enabled: ((): boolean => {
    try {
      return typeof process !== 'undefined' && process.env?.CONTAGION_PROF === '1'
    } catch { return false }
  })(),
  ticks: 0,
  carrierScans: 0,
  contactRolls: 0,
  transmissions: 0,
  totalMs: 0,
}

export function resetContagionStats(): void {
  contagionStats.ticks = 0
  contagionStats.carrierScans = 0
  contagionStats.contactRolls = 0
  contagionStats.transmissions = 0
  contagionStats.totalMs = 0
}

interface ActiveSlot {
  entity: Entity
  x: number
  y: number
  key: string
  carrierTemplates: Map<string, ConditionTemplate>  // templates this entity is symptomatic for
  immune: Set<string>  // template ids the entity already carries (any phase)
}

function collectActiveCharacters(world: World): ActiveSlot[] {
  const out: ActiveSlot[] = []
  const ifx = getInfectiousTemplates()
  if (ifx.length === 0) return out
  for (const entity of world.query(Character, Position, Active)) {
    const h = entity.get(Health)
    if (h?.dead) continue
    const pos = entity.get(Position)!
    const cond = entity.get(Conditions)
    const carrierTemplates = new Map<string, ConditionTemplate>()
    const immune = new Set<string>()
    if (cond) {
      for (const inst of cond.list) {
        immune.add(inst.templateId)
        if (!isSymptomatic(inst.phase)) continue
        for (const t of ifx) {
          if (t.id === inst.templateId) {
            carrierTemplates.set(t.id, t)
            break
          }
        }
      }
    }
    out.push({
      entity,
      x: pos.x,
      y: pos.y,
      key: keyOf(entity),
      carrierTemplates,
      immune,
    })
  }
  return out
}

// Throttle state — same shape as activeZoneSystem. Stored as a module-
// scope Map keyed by World to keep contagion's cadence aligned with
// the active-zone membership tick without depending on activeZoneSystem
// to push it.
const lastContagionTickGameMs = new WeakMap<World, number>()

export function resetContagion(world: World): void {
  lastContagionTickGameMs.delete(world)
}

export function contagionSystem(world: World, gameMs: number, dayNumber: number): void {
  const last = lastContagionTickGameMs.get(world) ?? -Infinity
  if (gameMs - last < TICK_MS) return
  lastContagionTickGameMs.set(world, gameMs)

  const PROF = contagionStats.enabled
  const tStart = PROF ? performance.now() : 0
  if (PROF) contagionStats.ticks++

  const slots = collectActiveCharacters(world)
  if (slots.length === 0) {
    if (PROF) contagionStats.totalMs += performance.now() - tStart
    return
  }

  const tickId = Math.floor(gameMs / TICK_MS)

  for (const carrier of slots) {
    if (carrier.carrierTemplates.size === 0) continue
    if (PROF) contagionStats.carrierScans++
    for (const template of carrier.carrierTemplates.values()) {
      const radiusPx = (template.contactRadius ?? 0) * TILE
      if (radiusPx <= 0) continue
      const rate = template.transmissionRate ?? 0
      if (rate <= 0) continue
      const r2 = radiusPx * radiusPx
      for (const target of slots) {
        if (target === carrier) continue
        if (target.immune.has(template.id)) continue
        const dx = target.x - carrier.x
        const dy = target.y - carrier.y
        if (dx * dx + dy * dy > r2) continue
        if (PROF) contagionStats.contactRolls++
        const rng = pairRng(tickId, carrier.key, target.key, template.id)
        if (rng.uniform() >= rate) continue
        const sourceName = carrier.entity.get(Character)?.name ?? '某人'
        const source = `感染自${sourceName}（${template.displayName}）`
        const spawned = onsetCondition(target.entity, template.id, source, dayNumber, rng)
        if (spawned !== null) {
          target.immune.add(template.id)  // don't re-roll the same target this tick
          if (PROF) contagionStats.transmissions++
        }
      }
    }
  }

  if (PROF) {
    contagionStats.totalMs += performance.now() - tStart
    if (contagionStats.ticks % 60 === 0) {
      console.log('[CONTAGION_PROF]', {
        ticks: contagionStats.ticks,
        carrierScans: contagionStats.carrierScans,
        contactRolls: contagionStats.contactRolls,
        transmissions: contagionStats.transmissions,
        msPerTick: (contagionStats.totalMs / contagionStats.ticks).toFixed(3),
      })
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Inactive-zone aggregate prevalence — a coarse readback the UI uses
// for the "三位同事请病假" workplace log line. Counts both active and
// inactive carriers across the whole scene world; the workplace-entry
// hook compares it against a threshold and emits the log on first
// crossing.
// ──────────────────────────────────────────────────────────────────
export function prevalenceForTemplate(world: World, templateId: string): { carriers: number; total: number } {
  let carriers = 0
  let total = 0
  for (const entity of world.query(Character, Conditions, Health)) {
    const h = entity.get(Health)
    if (h?.dead) continue
    total++
    const list = entity.get(Conditions)!.list
    for (const inst of list) {
      if (inst.templateId !== templateId) continue
      if (!isSymptomatic(inst.phase)) continue
      carriers++
      break
    }
  }
  return { carriers, total }
}
