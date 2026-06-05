import json5 from 'json5'
import raw from './perks.json5?raw'
import { STAT_IDS, type StatId } from '../stats/schema'
import { FACTION_STAT_IDS, type FactionStatId } from '../stats/factionSchema'
import type { ModType } from '../stats/sheet'

// Sims-style aspiration-reward catalog. Player spends Ambition Points
// (AP) earned from any ambition's stage payoffs on perks from this
// universal list. Permanent once purchased — no respec.
//
// Each perk lists a flat array of stat modifiers, identical in shape to
// backgrounds.json5. Sync code (src/character/perkSync.ts) folds them into
// the character's StatSheet under source `perk:<id>`. Perks whose
// downstream consumer hasn't shipped yet (Phase 5.2 social, Phase 6.1
// combat) carry an empty modifiers array — the sync still namespaces
// them so they round-trip correctly through saves.

export type PerkCategory = 'vital' | 'skill' | 'social' | 'economic' | 'combat' | 'faction'

export interface PerkModifier {
  statId: StatId
  type: ModType
  value: number
}

// Phase 6.4.E — faction-leader perks emit modifiers against the
// per-faction StatSheet (src/stats/factionSchema.ts) instead of the
// character sheet, so buying one runs the whole faction cheaper.
export interface FactionPerkModifier {
  statId: FactionStatId
  type: ModType
  value: number
}

export interface PerkDef {
  id: string
  nameZh: string
  descZh: string
  apCost: number
  category: PerkCategory
  modifiers: PerkModifier[]
  // Faction-wide levers — only faction-leader perks carry these. Folded
  // onto the player-faction's FactionStatSheet under `perk:<id>`.
  factionModifiers?: FactionPerkModifier[]
  // Gate id (a FactionUnlock) that must be present before this perk is
  // purchasable. Visible-but-locked until then. Faction-leader perks set
  // this to 'faction-tier' (Phase 6.4.A).
  requiresUnlock?: string
}

interface PerksFile {
  perks: PerkDef[]
}

const parsed = json5.parse(raw) as PerksFile

const VALID_CATEGORIES: ReadonlySet<PerkCategory> = new Set<PerkCategory>([
  'vital', 'skill', 'social', 'economic', 'combat', 'faction',
])
const VALID_STAT_IDS: ReadonlySet<string> = new Set<string>(STAT_IDS)
const VALID_FACTION_STAT_IDS: ReadonlySet<string> = new Set<string>(FACTION_STAT_IDS)
const VALID_TYPES: ReadonlySet<ModType> = new Set<ModType>([
  'flat', 'percentAdd', 'percentMult', 'floor', 'cap',
])

const seen = new Set<string>()
for (const p of parsed.perks) {
  if (!p.id) throw new Error('perks.json5: perk missing id')
  if (seen.has(p.id)) throw new Error(`perks.json5: duplicate perk id "${p.id}"`)
  seen.add(p.id)
  if (!p.nameZh) throw new Error(`perks.json5: perk "${p.id}" missing nameZh`)
  if (typeof p.apCost !== 'number' || p.apCost <= 0) {
    throw new Error(`perks.json5: perk "${p.id}" apCost must be > 0`)
  }
  if (!VALID_CATEGORIES.has(p.category)) {
    throw new Error(`perks.json5: perk "${p.id}" invalid category "${p.category}"`)
  }
  if (!Array.isArray(p.modifiers)) {
    throw new Error(`perks.json5: perk "${p.id}" modifiers must be an array`)
  }
  for (const m of p.modifiers) {
    if (!VALID_STAT_IDS.has(m.statId)) {
      throw new Error(`perks.json5: perk "${p.id}" unknown statId "${m.statId}"`)
    }
    if (!VALID_TYPES.has(m.type)) {
      throw new Error(`perks.json5: perk "${p.id}" unknown modifier type "${m.type}"`)
    }
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      throw new Error(`perks.json5: perk "${p.id}" non-finite value`)
    }
  }
  if (p.factionModifiers !== undefined) {
    if (!Array.isArray(p.factionModifiers)) {
      throw new Error(`perks.json5: perk "${p.id}" factionModifiers must be an array`)
    }
    for (const m of p.factionModifiers) {
      if (!VALID_FACTION_STAT_IDS.has(m.statId)) {
        throw new Error(`perks.json5: perk "${p.id}" unknown faction statId "${m.statId}"`)
      }
      if (!VALID_TYPES.has(m.type)) {
        throw new Error(`perks.json5: perk "${p.id}" unknown faction modifier type "${m.type}"`)
      }
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
        throw new Error(`perks.json5: perk "${p.id}" non-finite faction value`)
      }
    }
  }
  if (p.requiresUnlock !== undefined && typeof p.requiresUnlock !== 'string') {
    throw new Error(`perks.json5: perk "${p.id}" requiresUnlock must be a string`)
  }
}

export const PERKS: readonly PerkDef[] = parsed.perks

const byId: Record<string, PerkDef> = Object.fromEntries(parsed.perks.map((p) => [p.id, p]))

export function getPerk(id: string): PerkDef | undefined {
  return byId[id]
}

export function isPerkId(id: string): boolean {
  return id in byId
}

export function perkSource(id: string): string {
  return `perk:${id}`
}

// True when a perk carries faction-wide levers (Phase 6.4.E). Such perks
// fold onto the player-faction's FactionStatSheet rather than the
// character sheet.
export function isFactionPerk(def: PerkDef): boolean {
  return Array.isArray(def.factionModifiers) && def.factionModifiers.length > 0
}
