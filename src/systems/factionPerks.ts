// Phase 6.4.E — faction-leader perk spend path + visible-but-locked view.
//
// Faction-leader perks are spent from the SAME Ambition Points pool as every
// other perk (Phase 5.0). The difference is the effect target: instead of
// folding onto the character StatSheet, they emit a FactionEffect onto the
// player-faction's FactionStatSheet, so the perk runs the whole faction
// cheaper. Purchase is gated visible-but-locked behind the 'faction-tier'
// unlock (Phase 6.4.A) — the player can see the goal before reaching it,
// mirroring the research planner's locked-tier rows.
//
// Perf: purchase is on-demand (player-triggered); effects fold via the
// shared rebuildSheetFromEffects. No tick system, no per-frame scan.

import type { Entity } from 'koota'
import { Ambitions, Faction, IsPlayer } from '../ecs/traits'
import { getPerk, PERKS } from '../character/perks'
import { syncPerkModifiers, syncFactionPerks } from '../character/perkSync'
import { hasFactionUnlock } from '../ecs/factionEffects'
import { getWorld, SCENE_IDS } from '../ecs/world'

export type PurchaseRefusal =
  | 'unknown-perk'
  | 'no-player'
  | 'owned'
  | 'locked'
  | 'insufficient-ap'

export interface PurchaseResult {
  ok: boolean
  refusal?: PurchaseRefusal
}

// The player-faction carries the faction-tier unlock and every faction-wide
// stat. Resolved by Faction.id === 'player' to match where factionTierSystem
// writes the unlock (src/systems/factionTier.ts), so the gate check and the
// effect target are always the same entity.
function findPlayerFactionEntity(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Faction)) {
      if (e.get(Faction)!.id === 'player') return e
    }
  }
  return null
}

function findPlayerWithAmbitions(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer, Ambitions)
    if (p) return p
  }
  return null
}

// A perk with a requiresUnlock gate is locked until the player-faction owns
// that unlock. Perks without a gate are never locked.
function isPerkLocked(perkId: string, faction: Entity | null): boolean {
  const def = getPerk(perkId)
  if (!def || !def.requiresUnlock) return false
  return !faction || !hasFactionUnlock(faction, def.requiresUnlock)
}

// Spend AP on a perk. Character perks fold onto the character sheet; faction
// perks additionally fold onto the player-faction sheet. Idempotent guards:
// already-owned, gated-but-locked, or insufficient AP are all refused without
// mutating state. Returns a structured result so the UI and smoke tests can
// branch on the refusal reason.
export function purchasePerk(perkId: string): PurchaseResult {
  const def = getPerk(perkId)
  if (!def) return { ok: false, refusal: 'unknown-perk' }

  const player = findPlayerWithAmbitions()
  if (!player) return { ok: false, refusal: 'no-player' }
  const amb = player.get(Ambitions)!

  if (amb.perks.includes(perkId)) return { ok: false, refusal: 'owned' }

  const faction = findPlayerFactionEntity()
  if (isPerkLocked(perkId, faction)) return { ok: false, refusal: 'locked' }

  if (amb.apBalance < def.apCost) return { ok: false, refusal: 'insufficient-ap' }

  const newPerks = [...amb.perks, perkId]
  player.set(Ambitions, {
    active: amb.active,
    history: amb.history,
    apBalance: amb.apBalance - def.apCost,
    apEarned: amb.apEarned,
    perks: newPerks,
  })
  syncPerkModifiers(player, newPerks)
  if (faction) syncFactionPerks(faction, newPerks)
  return { ok: true }
}

export interface FactionPerkRow {
  id: string
  nameZh: string
  descZh: string
  apCost: number
  requiresUnlock: string | null
  owned: boolean
  locked: boolean
  affordable: boolean
}

// Visible-but-locked store view for the faction-leader perk tier. Iterates
// the full faction-category catalog (not just the unlocked rows) so the UI
// and tests can show locked perks with their gate, mirroring the research
// planner's locked tier rows.
export function factionPerkStoreView(): FactionPerkRow[] {
  const player = findPlayerWithAmbitions()
  const amb = player?.get(Ambitions) ?? null
  const owned = new Set(amb?.perks ?? [])
  const apBalance = amb?.apBalance ?? 0
  const faction = findPlayerFactionEntity()

  const out: FactionPerkRow[] = []
  for (const p of PERKS) {
    if (p.category !== 'faction') continue
    out.push({
      id: p.id,
      nameZh: p.nameZh,
      descZh: p.descZh,
      apCost: p.apCost,
      requiresUnlock: p.requiresUnlock ?? null,
      owned: owned.has(p.id),
      locked: isPerkLocked(p.id, faction),
      affordable: apBalance >= p.apCost,
    })
  }
  return out
}
