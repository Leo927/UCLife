// Resolves the player's purchased perks into multipliers consumed by other
// systems (vitals decay, skill XP, wage, shop pricing, rent). Pure read —
// no mutation. Called per-tick in hot paths, so we cache the resolved
// multipliers on the player entity each frame; cache invalidates on a
// length change of the perks array (perks are append-only — no respec).

import type { Entity } from 'koota'
import { Ambitions, IsPlayer } from '../ecs/traits'
import { getPerk } from '../data/perks'
import type { VitalKey } from '../data/perks'
import type { SkillId } from '../data/skills'
import { world } from '../ecs/world'

interface PerkMultipliers {
  vitalDecay: Record<VitalKey, number>
  skillXp: Record<string, number>
  wageMul: number
  shopMul: number
  rentMul: number
}

const DEFAULT: PerkMultipliers = {
  vitalDecay: { hunger: 1, thirst: 1, fatigue: 1, hygiene: 1, boredom: 1, all: 1 },
  skillXp: {},
  wageMul: 1,
  shopMul: 1,
  rentMul: 1,
}

let cached: { perksLen: number; mul: PerkMultipliers } | null = null

function recompute(perks: readonly string[]): PerkMultipliers {
  const m: PerkMultipliers = {
    vitalDecay: { ...DEFAULT.vitalDecay },
    skillXp: {},
    wageMul: 1,
    shopMul: 1,
    rentMul: 1,
  }
  for (const id of perks) {
    const p = getPerk(id)
    if (!p) continue
    switch (p.effect.kind) {
      case 'vitalDecay':
        m.vitalDecay[p.effect.vital] *= p.effect.mul
        break
      case 'skillXpMul': {
        const cur = m.skillXp[p.effect.skill] ?? 1
        m.skillXp[p.effect.skill] = cur * p.effect.mul
        break
      }
      case 'wageMul':
        m.wageMul *= p.effect.mul
        break
      case 'shopDiscountMul':
        m.shopMul *= p.effect.mul
        break
      case 'rentMul':
        m.rentMul *= p.effect.mul
        break
      case 'placeholder':
        break
    }
  }
  return m
}

function getPlayerEntity(): Entity | undefined {
  return world.queryFirst(IsPlayer, Ambitions)
}

function getMultipliers(): PerkMultipliers {
  const player = getPlayerEntity()
  if (!player) return DEFAULT
  const a = player.get(Ambitions)
  if (!a) return DEFAULT
  if (cached && cached.perksLen === a.perks.length) return cached.mul
  const mul = recompute(a.perks)
  cached = { perksLen: a.perks.length, mul }
  return mul
}

export function invalidatePerkCache(): void {
  cached = null
}

// Apply vital-decay perks to a per-tick decay magnitude. The 'all' bucket
// stacks multiplicatively with per-vital buckets, mirroring the design's
// "long distance" perk that affects every vital simultaneously.
export function applyVitalDecayMul(vital: VitalKey, base: number): number {
  if (vital === 'all') return base
  const m = getMultipliers()
  return base * m.vitalDecay[vital] * m.vitalDecay.all
}

export function applySkillXpMul(skill: SkillId, base: number): number {
  const m = getMultipliers()
  return base * (m.skillXp[skill] ?? 1)
}

export function getWageMul(): number {
  return getMultipliers().wageMul
}

export function getShopMul(): number {
  return getMultipliers().shopMul
}

export function getRentMul(): number {
  return getMultipliers().rentMul
}
