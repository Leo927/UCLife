// Modifier-based stat sheet, ported from
// github.com/andykessler/CharacterStats (Stat.cs / StatSheet.cs / StatModifier.cs).
//
// The reference uses C# events to invalidate a cached value whenever a
// modifier or base value changes. We can't use that pattern directly:
// koota traits are immutable POJOs that survive JSON round-trips, and
// references die on every entity.set(). Instead, every mutation returns
// a new sheet snapshot with cleared cache, mirroring the rest of this
// codebase's update-by-replace style.
//
// Computation order matches the reference plus two clamps for situational
// ceilings:
//   val = (formula(base) + Σflat) * (1 + ΣpercentAdd) * Π(1 + percentMult)
//   val = max(val, max(...floors))    — most generous floor wins
//   val = min(val, min(...caps))      — most restrictive cap wins
// Tie rule: when cap < floor, cap wins (disabled trumps inspired).
// Rounded to 4 decimals to mask float-arithmetic noise.

export type ModType = 'flat' | 'percentAdd' | 'percentMult' | 'floor' | 'cap'

export interface Modifier<StatId extends string> {
  statId: StatId
  type: ModType
  value: number
  // String key, not an object reference, so saves are serializable. Use a
  // namespaced form like 'background:soldier', 'perk:long-distance',
  // 'item:belt', 'talent', 'drift' to keep removeBySource() useful.
  source: string
}

export interface StatData<StatId extends string> {
  base: number
  modifiers: Modifier<StatId>[]
}

export type FormulaFn<StatId extends string> = (sheet: StatSheet<StatId>, base: number) => number

export interface FormulaSpec<StatId extends string> {
  deps: StatId[]
  formula: FormulaFn<StatId>
}

export type FormulaTable<StatId extends string> = Record<StatId, FormulaSpec<StatId>>

export interface StatSheet<StatId extends string> {
  stats: Record<StatId, StatData<StatId>>
  // Formula table re-attached after JSON round-trip; not serialized.
  formulas: FormulaTable<StatId>
  // Bumped on every mutation so a side-channel cache can detect staleness
  // without a separate dirty bit per stat.
  version: number
}

// Memo lives in a WeakMap so getStat() is a pure read of the sheet POJO.
// Koota traits are POJO snapshots; mutating a `cache` field on a snapshot
// would alias into koota's stored object — instead the memo is keyed by
// the sheet reference and naturally garbage-collected when the snapshot
// is replaced.
const memo: WeakMap<object, Map<string, { v: number; ver: number }>> = new WeakMap()

export function identityFormulas<StatId extends string>(ids: readonly StatId[]): FormulaTable<StatId> {
  const out = {} as FormulaTable<StatId>
  const spec: FormulaSpec<StatId> = { deps: [], formula: (_s, b) => b }
  for (const id of ids) out[id] = spec
  return out
}

export function createSheet<StatId extends string>(
  ids: readonly StatId[],
  formulas: FormulaTable<StatId>,
  bases?: Partial<Record<StatId, number>>,
): StatSheet<StatId> {
  const stats = {} as Record<StatId, StatData<StatId>>
  for (const id of ids) {
    stats[id] = { base: bases?.[id] ?? 0, modifiers: [] }
  }
  return { stats, formulas, version: 1 }
}

function cloneSheet<StatId extends string>(s: StatSheet<StatId>): StatSheet<StatId> {
  // Shallow on stats record, deep on the StatData entries (modifiers list
  // is mutated through this clone in addModifier/removeBySource — so each
  // entry needs a fresh modifiers array). The formula table is read-only
  // and shared by reference.
  const stats = {} as Record<StatId, StatData<StatId>>
  for (const id of Object.keys(s.stats) as StatId[]) {
    const d = s.stats[id]
    stats[id] = { base: d.base, modifiers: d.modifiers.slice() }
  }
  return { stats, formulas: s.formulas, version: s.version + 1 }
}

export function setBase<StatId extends string>(
  s: StatSheet<StatId>,
  id: StatId,
  base: number,
): StatSheet<StatId> {
  if (s.stats[id].base === base) return s
  const out = cloneSheet(s)
  out.stats[id].base = base
  return out
}

export function getBase<StatId extends string>(s: StatSheet<StatId>, id: StatId): number {
  return s.stats[id].base
}

export function addModifier<StatId extends string>(
  s: StatSheet<StatId>,
  mod: Modifier<StatId>,
): StatSheet<StatId> {
  const out = cloneSheet(s)
  out.stats[mod.statId].modifiers.push(mod)
  return out
}

export function removeBySource<StatId extends string>(
  s: StatSheet<StatId>,
  source: string,
): StatSheet<StatId> {
  let touched = false
  const stats = {} as Record<StatId, StatData<StatId>>
  for (const id of Object.keys(s.stats) as StatId[]) {
    const d = s.stats[id]
    const filtered = d.modifiers.filter((m) => m.source !== source)
    if (filtered.length !== d.modifiers.length) touched = true
    stats[id] = { base: d.base, modifiers: filtered }
  }
  if (!touched) return s
  return { stats, formulas: s.formulas, version: s.version + 1 }
}

function compute<StatId extends string>(s: StatSheet<StatId>, id: StatId): number {
  const data = s.stats[id]
  const spec = s.formulas[id]
  const derivedBase = spec ? spec.formula(s, data.base) : data.base
  let flat = 0
  let pctAdd = 0
  let pctMul = 1
  let floor = -Infinity
  let cap = Infinity
  let hasFloor = false
  let hasCap = false
  for (const m of data.modifiers) {
    if (m.type === 'flat') flat += m.value
    else if (m.type === 'percentAdd') pctAdd += m.value
    else if (m.type === 'percentMult') pctMul *= 1 + m.value
    else if (m.type === 'floor') {
      if (m.value > floor) floor = m.value
      hasFloor = true
    } else if (m.type === 'cap') {
      if (m.value < cap) cap = m.value
      hasCap = true
    }
  }
  let raw = (derivedBase + flat) * (1 + pctAdd) * pctMul
  if (hasFloor && raw < floor) raw = floor
  // Cap last so a cap below the floor wins (disabled trumps inspired).
  if (hasCap && raw > cap) raw = cap
  return Math.round(raw * 10000) / 10000
}

export function getStat<StatId extends string>(s: StatSheet<StatId>, id: StatId): number {
  let bucket = memo.get(s)
  if (bucket) {
    const hit = bucket.get(id)
    if (hit && hit.ver === s.version) return hit.v
  } else {
    bucket = new Map()
    memo.set(s, bucket)
  }
  const v = compute(s, id)
  bucket.set(id, { v, ver: s.version })
  return v
}

// Strip the ephemeral cache + formula table for save/load. Modifier
// arrays are derived from the per-character Effects trait (see
// src/stats/effects.ts) on load — they are NOT serialized into the
// sheet snapshot. Including them would risk a double-stack on load
// (saved modifier + Effect-rebuilt modifier for the same source).
//
// Pair with `attachFormulas()` on load.
export interface SerializedStat {
  base: number
  // Optional only so legacy (pre-v9) saves load — they carry the array
  // and we drop it at attach time. New saves never write this field.
  modifiers?: unknown[]
}

export interface SerializedSheet<StatId extends string> {
  stats: Record<StatId, SerializedStat>
  version: number
}

export function serializeSheet<StatId extends string>(s: StatSheet<StatId>): SerializedSheet<StatId> {
  const stats = {} as Record<StatId, SerializedStat>
  for (const id of Object.keys(s.stats) as StatId[]) {
    stats[id] = { base: s.stats[id].base }
  }
  return { stats, version: s.version }
}

export function attachFormulas<StatId extends string>(
  ids: readonly StatId[],
  formulas: FormulaTable<StatId>,
  saved: SerializedSheet<StatId>,
): StatSheet<StatId> {
  // Always start with empty modifier arrays — Effects are the source
  // of truth and the Effects trait serializer rebuilds the modifier
  // arrays after this runs (see src/boot/traitSerializers/effects.ts).
  // Drops any legacy `bg:*`/`perk:*` modifiers a pre-v9 save may have
  // carried in `saved.stats[id].modifiers` so v9 perk re-emission
  // doesn't double-stack.
  const stats = {} as Record<StatId, StatData<StatId>>
  for (const id of ids) {
    const d = saved.stats[id]
    stats[id] = { base: d ? d.base : 0, modifiers: [] }
  }
  return { stats, formulas, version: saved.version || 1 }
}
