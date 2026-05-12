// Phase 5.5.5 — player-faction creation. Until the player confirms the
// secretary's "正式成立faction" verb, the player-faction is a transparent
// alias: PlayerFaction.fund aliases the player's Money, and
// PlayerFaction.facilities aliases the set of buildings owned by the
// player via Owner({kind:'character', entity: player}).
//
// The Faction entity itself is already bootstrapped (see
// src/ecs/ownership.ts :: bootstrapFactions), so the migration only:
//
//   1. Adds the IsPlayerFaction marker — flips the entity from "inert
//      catalog slot" to "officially formed".
//   2. Walks every Building whose Owner is the character alias and
//      re-stamps it to Owner({kind:'faction', entity: playerFaction}).
//   3. Drains the player's Money into Faction.fund, leaving a configurable
//      "stipend" the player keeps as personal spending money.
//
// Idempotent — calling twice once the marker is set is a no-op.

import type { Entity, World } from 'koota'
import {
  Building, Faction, IsPlayerFaction, Money, Owner,
} from './traits'
import { factionKey, findFactionEntity } from './ownership'
import { economicsConfig } from '../config'

export const PLAYER_FACTION_KEY = factionKey('player')

// Find the IsPlayerFaction-marked entity, or null if creation has not
// happened yet. The 'player' Faction entity exists on every world (it's
// bootstrapped alongside anaheim/civilian/etc.) but is inert until the
// marker is set.
export function findPlayerFaction(world: World): Entity | null {
  return world.queryFirst(IsPlayerFaction) ?? null
}

// True after createPlayerFaction has run on this world.
export function hasPlayerFaction(world: World): boolean {
  return findPlayerFaction(world) !== null
}

export interface CreatePlayerFactionResult {
  /** The Faction entity (always non-null post-bootstrap). */
  faction: Entity | null
  /** True only on the first successful creation in this world. */
  created: boolean
  /** Buildings whose Owner edge was migrated to the new faction. */
  migratedBuildings: number
  /** Wallet → fund transfer (post-stipend). */
  walletMigrated: number
  /** Stipend left on the player's Money trait. */
  stipendRemaining: number
}

// Mark the bootstrapped 'player' Faction as officially formed and migrate
// player-aliased state into it. Safe to call on any world; if the player
// has no Money / no owned buildings, the corresponding counters are zero.
export function createPlayerFaction(
  world: World,
  player: Entity,
): CreatePlayerFactionResult {
  const wallet = player.get(Money)?.amount ?? 0

  const faction = findFactionEntity(world, 'player')
  if (!faction) {
    // bootstrapFactions wasn't called for this world (test setup). No-op.
    return {
      faction: null,
      created: false,
      migratedBuildings: 0,
      walletMigrated: 0,
      stipendRemaining: wallet,
    }
  }

  if (faction.has(IsPlayerFaction)) {
    return {
      faction,
      created: false,
      migratedBuildings: 0,
      walletMigrated: 0,
      stipendRemaining: wallet,
    }
  }

  const stipend = Math.min(wallet, economicsConfig.playerFaction.creationStipend)
  const fundSeed = wallet - stipend

  const cur = faction.get(Faction)!
  faction.set(Faction, { ...cur, fund: cur.fund + fundSeed })
  faction.add(IsPlayerFaction)

  let migrated = 0
  for (const b of world.query(Building, Owner)) {
    const o = b.get(Owner)!
    if (o.kind !== 'character') continue
    if (o.entity !== player) continue
    b.set(Owner, { kind: 'faction', entity: faction })
    migrated += 1
  }

  if (player.has(Money)) {
    player.set(Money, { amount: stipend })
  }

  return {
    faction,
    created: true,
    migratedBuildings: migrated,
    walletMigrated: fundSeed,
    stipendRemaining: stipend,
  }
}

// Reverse of the wallet leg: secretary's "拨款到我个人账户" verb
// transfers `amount` from Faction.fund back to the player's Money.
// Returns the actual amount moved (clamped by fund balance) or 0 on
// failure. Used by the SecretaryPanel post-creation panel.
export function withdrawFromPlayerFaction(
  world: World,
  player: Entity,
  amount: number,
): number {
  if (amount <= 0) return 0
  const faction = findPlayerFaction(world)
  if (!faction) return 0
  const f = faction.get(Faction)!
  const moved = Math.min(amount, f.fund)
  if (moved <= 0) return 0
  faction.set(Faction, { ...f, fund: f.fund - moved })
  if (player.has(Money)) {
    const m = player.get(Money)!
    player.set(Money, { amount: m.amount + moved })
  }
  return moved
}
