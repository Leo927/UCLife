// Phase 5.3 — character psychology (Design/social/psychology.md).
// Two independent axes per character: temperament (*how* they react) and
// cause sympathies (*what* they want, -1..+1 per cause). Both live as
// namespaced Effects on the character StatSheet — single channel, no
// second modifier engine. The reaction formula here powers stance
// reactions; consumers wire it in src/systems/psychology.ts.

import type { Entity } from 'koota'
import {
  psychologyConfig, CAUSE_IDS, TEMPERAMENT_IDS,
  type CauseId, type TemperamentId, type CauseTags,
} from '../config/psychology'
import { sympathyStat, type StatId } from '../stats/schema'
import { getStat, type StatSheet } from '../stats/sheet'
import type { Effect } from '../stats/effects'
import { addEffect, getEffects } from './effects'
import { hashSeed, mulberry32 } from './appearanceGen'
import { specialNpcs } from './specialNpcs'

export interface PsychologyAssignment {
  temperament: TemperamentId
  sympathies: CauseTags
}

const TEMPERAMENT_EFFECT_PREFIX = 'temperament:'
const SYMPATHY_EFFECT_PREFIX = 'sym:'

export function temperamentEffect(id: TemperamentId): Effect {
  const t = psychologyConfig.temperaments[id]
  return {
    id: `${TEMPERAMENT_EFFECT_PREFIX}${id}`,
    originId: id,
    family: 'psychology',
    modifiers: [{ statId: 'reactionScale', type: 'flat', value: t.reactionScaleDelta }],
    nameZh: t.nameZh,
  }
}

// Hidden: which sympathies a character holds is information the player
// earns through the daily-reveal loop (Psyche.revealed), never via a
// generic effect listing.
export function sympathyEffect(cause: CauseId, weight: number): Effect {
  return {
    id: `${SYMPATHY_EFFECT_PREFIX}${cause}`,
    originId: cause,
    family: 'psychology',
    modifiers: [{ statId: sympathyStat(cause), type: 'flat', value: weight }],
    nameZh: psychologyConfig.causes[cause].nameZh,
    hidden: true,
  }
}

// Deterministic per name (FNV-1a → mulberry32), mirroring
// generateAppearanceForName: same NPC → same psychology across reloads
// and saves, no RNG plumbing through spawn call sites. The 'psy:' prefix
// decorrelates the stream from the appearance roll for the same name.
export function generatePsychologyForName(name: string): PsychologyAssignment {
  const cfg = psychologyConfig.procgen
  const rng = mulberry32(hashSeed(`psy:${name}`))
  const temperament = TEMPERAMENT_IDS[Math.floor(rng() * TEMPERAMENT_IDS.length)]

  const span = cfg.sympathyCountMax - cfg.sympathyCountMin
  const count = cfg.sympathyCountMin + Math.floor(rng() * (span + 1))
  const pool = [...CAUSE_IDS]
  const sympathies: CauseTags = {}
  for (let i = 0; i < count && pool.length > 0; i++) {
    const cause = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    const steps = Math.round((cfg.magnitudeMax - cfg.magnitudeMin) / cfg.magnitudeStep)
    const magnitude = cfg.magnitudeMin + cfg.magnitudeStep * Math.floor(rng() * (steps + 1))
    const sign = rng() < cfg.negativeChance ? -1 : 1
    // Snap to the step grid — float artifacts would leak into save files.
    sympathies[cause] = Math.round(sign * magnitude * 100) / 100
  }
  return { temperament, sympathies }
}

const authoredByName = new Map<string, Partial<PsychologyAssignment>>()
for (const sn of specialNpcs) {
  if (sn.temperament !== undefined || sn.sympathies !== undefined) {
    authoredByName.set(sn.name, {
      temperament: sn.temperament,
      sympathies: sn.sympathies,
    })
  }
}

// Authored values from special-npcs.json5 win per-field; procgen fills
// whatever the author left out.
export function psychologyForName(name: string): PsychologyAssignment {
  const generated = generatePsychologyForName(name)
  const authored = authoredByName.get(name)
  if (!authored) return generated
  return {
    temperament: authored.temperament ?? generated.temperament,
    sympathies: authored.sympathies ?? generated.sympathies,
  }
}

export function applyPsychology(entity: Entity, psy: PsychologyAssignment): void {
  addEffect(entity, temperamentEffect(psy.temperament))
  for (const cause of CAUSE_IDS) {
    const w = psy.sympathies[cause]
    if (w !== undefined && w !== 0) addEffect(entity, sympathyEffect(cause, w))
  }
}

export function temperamentOf(entity: Entity): TemperamentId | null {
  for (const e of getEffects(entity)) {
    if (e.family === 'psychology' && e.id.startsWith(TEMPERAMENT_EFFECT_PREFIX)) {
      return e.originId as TemperamentId
    }
  }
  return null
}

// Nonzero sympathies, read back off the StatSheet fold.
export function sympathiesOf(sheet: StatSheet<StatId>): CauseTags {
  const out: CauseTags = {}
  for (const cause of CAUSE_IDS) {
    const w = getStat(sheet, sympathyStat(cause))
    if (w !== 0) out[cause] = w
  }
  return out
}

// The doc's reaction formula:
//   reaction = dot(event.causeTags, character.sympathies) × temperamentScale
// Unscaled — the opinion consumer multiplies by reaction.opinionScale.
export function causeReaction(sheet: StatSheet<StatId>, causeTags: CauseTags): number {
  let dot = 0
  for (const cause of CAUSE_IDS) {
    const tag = causeTags[cause]
    if (tag === undefined || tag === 0) continue
    dot += tag * getStat(sheet, sympathyStat(cause))
  }
  if (dot === 0) return 0
  return dot * getStat(sheet, 'reactionScale')
}

// Deterministic-progressive reveal order: highest |weight| first, ties
// broken by CAUSE_IDS declaration order. Null when every held sympathy
// is already known.
export function nextRevealableCause(
  sympathies: CauseTags,
  revealed: readonly string[],
): CauseId | null {
  let best: CauseId | null = null
  let bestAbs = 0
  for (const cause of CAUSE_IDS) {
    const w = sympathies[cause]
    if (w === undefined || w === 0 || revealed.includes(cause)) continue
    const abs = Math.abs(w)
    if (abs > bestAbs) {
      best = cause
      bestAbs = abs
    }
  }
  return best
}
