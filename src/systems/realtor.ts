// Phase 5.5.1 realtor system. Walks the active world's Building entities and
// produces a categorized listing for the realtor UI; closes direct-seller
// transactions; computes flagger asking prices via the seller's opinion +
// the player's faction rep.
//
// Apartment + luxury buildings list metadata only; the unit-level rent /
// buy flow continues to live in the bed-row UI (RealtorConversation's
// existing surface).

import type { Entity, World } from 'koota'
import {
  Building, Owner, Position, Money, Character, EntityKey, Knows, Bed,
} from '../ecs/traits'
import {
  getRealtyType, realtyConfig, type ListingCategory,
} from '../config'
import { getRep } from './reputation'
import { worldConfig } from '../config'
import type { FactionId } from '../data/factions'
import { bedActiveOccupant } from './bed'

const TILE = worldConfig.tilePx

export interface RealtyListing {
  building: Entity
  buildingKey: string
  typeId: string
  labelZh: string
  category: ListingCategory
  // Building rect in pixels — drives the map flag + walk-to action.
  rect: { x: number; y: number; w: number; h: number }
  // Owner kind at the time the listing was built. UI uses this to decide
  // whether to show the direct-seller close ('state') vs the flagger
  // surface ('character'). Faction-owned buildings are always 'hidden';
  // players don't transact AE's HQ at the realtor desk.
  ownerKind: 'state' | 'faction' | 'character'
  // Seller name + entity for character-owned listings. null for state.
  seller: { name: string; entity: Entity } | null
  // Listed asking price. For lease-only types (apartment / luxury), this
  // is null — the bed-row UI prices each unit individually.
  askingPrice: number | null
  // Whether the listing supports an apartment-style lease flow.
  lease: boolean
}

export interface ListingFilter {
  categories?: ListingCategory[]
}

function tilesArea(rect: { w: number; h: number }): number {
  return Math.max(1, Math.round(rect.w / TILE)) * Math.max(1, Math.round(rect.h / TILE))
}

// Asking price for a state / foreclosed / direct-seller listing. Apartments
// and luxury return null — those route through the bed-row UI.
export function listedPriceFor(typeId: string, rect: { w: number; h: number }): number | null {
  const spec = getRealtyType(typeId)
  if (!spec) return null
  if (!spec.buyable) return null
  if (spec.lease && (typeId === 'apartment' || typeId === 'luxury')) return null
  const mul = spec.buildingPriceTilesMul ?? 0
  if (mul === 0) return null
  const base = mul * tilesArea(rect)
  return Math.round(base * realtyConfig.listingMul.state)
}

// Flagger asking price: the seller's opinion + player rep moves the price
// inside `talkSale.priceBand`. Higher opinion → lower asking price.
export function privateAskingPrice(
  player: Entity,
  seller: Entity,
  typeId: string,
  rect: { w: number; h: number },
  factionRepBonus: { faction: FactionId } | null = null,
): number | null {
  const spec = getRealtyType(typeId)
  if (!spec) return null
  if (!spec.buyable) return null
  const mul = spec.buildingPriceTilesMul ?? 0
  if (mul === 0) return null
  const base = mul * tilesArea(rect) * realtyConfig.listingMul.private

  // Opinion is the seller's edge value toward the player. The Knows relation
  // is asymmetric — read seller→player, not player→seller.
  const edge = seller.has(Knows(player)) ? seller.get(Knows(player)) : null
  let opinion = edge?.opinion ?? 0
  if (factionRepBonus) {
    opinion += getRep(player, factionRepBonus.faction) * realtyConfig.talkSale.factionRepWeight
  }
  // Map opinion in [-100, +100] to [bandMin, bandMax]. bandMin > bandMax
  // because higher opinion = lower price.
  const t = Math.max(0, Math.min(1, (opinion + 100) / 200))
  const band = realtyConfig.talkSale.priceBand
  const mulOpinion = band.min + (band.max - band.min) * t
  return Math.max(1, Math.round(base * mulOpinion))
}

export function gatherListings(world: World, filter?: ListingFilter): RealtyListing[] {
  const out: RealtyListing[] = []
  const wantCats = filter?.categories ? new Set(filter.categories) : null

  for (const ent of world.query(Building, Owner, EntityKey)) {
    const b = ent.get(Building)!
    const typeId = b.typeId
    if (!typeId) continue
    const spec = getRealtyType(typeId)
    if (!spec) continue
    if (spec.category === 'hidden') continue
    if (wantCats && !wantCats.has(spec.category)) continue

    const o = ent.get(Owner)!
    if (o.kind === 'faction') continue

    // The aeComplex is faction-owned but tagged 'hidden' anyway for safety.
    let seller: RealtyListing['seller'] = null
    if (o.kind === 'character' && o.entity) {
      const ch = o.entity.get(Character)
      if (ch) seller = { name: ch.name, entity: o.entity }
    }

    let asking: number | null = null
    if (o.kind === 'state') {
      asking = listedPriceFor(typeId, { w: b.w, h: b.h })
    }

    out.push({
      building: ent,
      buildingKey: ent.get(EntityKey)!.key,
      typeId,
      labelZh: spec.labelZh ?? b.label,
      category: spec.category,
      rect: { x: b.x, y: b.y, w: b.w, h: b.h },
      ownerKind: o.kind,
      seller,
      askingPrice: asking,
      lease: !!spec.lease,
    })
  }

  // Stable sort: category band, then label, then key. UI relies on this for
  // the deterministic-ordering rule the existing bed-row UI follows.
  const order: Record<ListingCategory, number> = {
    residential: 0, commercial: 1, factionMisc: 2, civic: 3, hidden: 4,
  }
  out.sort((a, b) => {
    if (a.category !== b.category) return order[a.category] - order[b.category]
    if (a.labelZh !== b.labelZh) return a.labelZh.localeCompare(b.labelZh)
    return a.buildingKey.localeCompare(b.buildingKey)
  })
  return out
}

// Direct-seller close. Debits player wallet, transfers Owner. Returns the
// purchase price on success, null on insufficient funds or invalid state.
export function buyFromState(player: Entity, listing: RealtyListing): number | null {
  if (listing.ownerKind !== 'state') return null
  if (listing.askingPrice === null) return null
  const m = player.get(Money)
  if (!m || m.amount < listing.askingPrice) return null
  player.set(Money, { amount: m.amount - listing.askingPrice })
  listing.building.set(Owner, { kind: 'character', entity: player })
  return listing.askingPrice
}

// Flagger / private close. Debits player wallet, transfers Owner from
// seller to player. Caller computes the price via privateAskingPrice() and
// passes it in — keeps the talk-verb in charge of the negotiation rather
// than re-deriving the number here.
export function buyFromOwner(player: Entity, listing: RealtyListing, price: number): boolean {
  if (listing.ownerKind !== 'character') return false
  if (!listing.seller) return false
  const m = player.get(Money)
  if (!m || m.amount < price) return false
  player.set(Money, { amount: m.amount - price })
  // Seller's wallet receives the proceeds — feeds the flavor that an NPC
  // who liquidates a facility now has cash to spend in town.
  const sellerMoney = listing.seller.entity.get(Money)
  if (sellerMoney) {
    listing.seller.entity.set(Money, { amount: sellerMoney.amount + price })
  }
  listing.building.set(Owner, { kind: 'character', entity: player })
  return true
}

// Find the on-screen listing the player should walk to to negotiate the
// private sale of `listing`. Returns the seller's current Position for the
// flagger flow's "找业主" button. null if the seller has no Position (e.g.
// despawned mid-load).
export function sellerLocation(listing: RealtyListing): { x: number; y: number } | null {
  if (!listing.seller) return null
  const p = listing.seller.entity.get(Position)
  if (!p) return null
  return { x: p.x, y: p.y }
}

// True once every available bed in the building is owned by the player —
// listed under a residential entry. The realtor's residential listing
// hides apartments whose every bed is already player-owned, since there's
// nothing left to do there.
export function residentialAllOwnedByPlayer(world: World, listing: RealtyListing, player: Entity, gameMs: number): boolean {
  if (!listing.lease) return false
  let saw = 0
  let owned = 0
  for (const bedEnt of world.query(Bed, Position)) {
    const bed = bedEnt.get(Bed)!
    const pos = bedEnt.get(Position)!
    if (pos.x < listing.rect.x || pos.x > listing.rect.x + listing.rect.w) continue
    if (pos.y < listing.rect.y || pos.y > listing.rect.y + listing.rect.h) continue
    saw++
    const occ = bedActiveOccupant(bed, gameMs)
    if (bed.owned && occ === player) owned++
  }
  return saw > 0 && saw === owned
}
