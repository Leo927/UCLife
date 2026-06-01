// Issue #64 — AE MS-parts broker transaction.
//
// Shared by the aePartsSales dialogue branch (player click) and the
// buyPartCheat debug handle (smoke). Validates that the part is in the
// dealer's catalog, that the player can afford the derived unit price,
// then debits Money and credits PlayerPartsInventory immediately — parts
// are crates, so unlike the ship / vehicle brokers there is no delivery
// queue or hangar slot.

import { getWorld } from '../ecs/world'
import { IsPlayer, Money, PlayerPartsInventory } from '../ecs/traits'
import { fleetConfig } from '../config'
import { partPrice, type PartKind } from '../data/partsPricing'

const SHIP_SCENE_ID = 'playerShipInterior'

export type BuyPartResult =
  | { ok: true; price: number; count: number }
  | { ok: false; reason: 'unknown_dealer' | 'not_in_catalog' | 'no_player' | 'no_inventory' | 'insufficient_funds' }

function catalogHasPart(specId: string, kind: PartKind, partId: string): boolean {
  const entry = fleetConfig.partsSalesCatalog[specId]
  if (!entry) return false
  const ids = kind === 'weapon' ? entry.weapons : entry.frameMods
  return ids.includes(partId)
}

function findPlayer() {
  for (const id of [SHIP_SCENE_ID, 'vonBraunCity', 'zumCity']) {
    const p = getWorld(id).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

function findPartsInventory() {
  // The PlayerPartsInventory singleton lives in the ship-interior world
  // alongside the player's MS roster.
  for (const ent of getWorld(SHIP_SCENE_ID).query(PlayerPartsInventory)) return ent
  return null
}

// Run the purchase. `specId` is the dealer's workstation spec (catalog key).
export function buyPart(specId: string, kind: PartKind, partId: string): BuyPartResult {
  if (!fleetConfig.partsSalesCatalog[specId]) return { ok: false, reason: 'unknown_dealer' }
  if (!catalogHasPart(specId, kind, partId)) return { ok: false, reason: 'not_in_catalog' }

  const player = findPlayer()
  if (!player) return { ok: false, reason: 'no_player' }
  const invEnt = findPartsInventory()
  if (!invEnt) return { ok: false, reason: 'no_inventory' }

  const price = partPrice(kind, partId)
  const m = player.get(Money) ?? { amount: 0 }
  if (m.amount < price) return { ok: false, reason: 'insufficient_funds' }

  player.set(Money, { amount: m.amount - price })

  const inv = invEnt.get(PlayerPartsInventory)!
  if (kind === 'weapon') {
    const next = { ...inv.weapons, [partId]: (inv.weapons[partId] ?? 0) + 1 }
    invEnt.set(PlayerPartsInventory, { ...inv, weapons: next })
    return { ok: true, price, count: next[partId] }
  }
  const next = { ...inv.frameMods, [partId]: (inv.frameMods[partId] ?? 0) + 1 }
  invEnt.set(PlayerPartsInventory, { ...inv, frameMods: next })
  return { ok: true, price, count: next[partId] }
}
