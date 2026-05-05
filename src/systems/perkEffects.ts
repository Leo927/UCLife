// Resolves the player's purchased perks into multipliers consumed by
// non-stat-sheet systems (skill XP, wage, shop pricing, rent). Pure read
// — no mutation. Cached on a perks-array length change since perks are
// append-only.
//
// vitalDecay perks are sheet-driven now — see src/stats/perkSync.ts; they
// don't flow through this module.

import type { Entity } from 'koota'
import { Ambitions, IsPlayer } from '../ecs/traits'
import { getPerk } from '../character/perks'
import type { SkillId } from '../character/skills'
import { world } from '../ecs/world'

interface PerkMultipliers {
  skillXp: Record<string, number>
  wageMul: number
  shopMul: number
  rentMul: number
}

const DEFAULT: PerkMultipliers = {
  skillXp: {},
  wageMul: 1,
  shopMul: 1,
  rentMul: 1,
}

let cached: { perksLen: number; mul: PerkMultipliers } | null = null

function recompute(perks: readonly string[]): PerkMultipliers {
  const m: PerkMultipliers = {
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
        // Lives in the StatSheet now (perkSync.ts).
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
