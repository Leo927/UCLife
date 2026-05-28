// MS entity traits — Phase 6.2.5.A.
//
// Each owned MS is a persistent ECS entity in playerShipInterior.
// `Ms` holds the per-instance state; `MsStatSheet` + `MsEffectsList`
// mirror the ship-side stat/effect engine.
// `PlayerPartsInventory` is a singleton on the player entity
// (or on a dedicated entity keyed 'player-parts-inv') holding
// { [msWeaponId]: count } for the weapon-swap retrofit verb.
// `MsRef` rides on the hangar-bay sprite + terminal entities so the
// interaction handler can find which Ms entity to target.

import { trait } from 'koota'
import { createMsSheet, type MsStatId } from '../../stats/msSchema'
import type { StatSheet } from '../../stats/sheet'
import type { Effect } from '../../stats/effects'

export type { MsStatId }

export const Ms = trait({
  templateId: '',
  name: '',
  hullCurrent: 0,
  hullMax: 0,
  armorCurrent: 0,
  armorMax: 0,
  // hardpointId → msWeaponId. Record mutated by the retrofit panel.
  mountedWeapons: {} as Record<string, string>,
  // EntityKey of the Ship whose hangar bay holds this MS. Empty = not
  // currently stored aboard any ship.
  storedOnShipKey: '',
  // Index into the ship's hangar bay slots (drives sprite position).
  bayIndex: 0,
  // Phase 6.2.5.B — POI id where this MS is parked when not aboard a ship.
  // Exactly one of storedOnShipKey / dockedAtPoiId is non-empty for a
  // stored MS; both empty means in-transit (transitDestinationId set).
  dockedAtPoiId: '',
  // Phase 6.2.5.B — EntityKey of the hired NPC piloting this MS. Empty
  // = unpiloted (player-piloted by default via climbIntoMs, or idle).
  pilotId: '',
  // Phase 6.2.5.B — transit destination POI id while the MS is in
  // transit between hangars. Empty = not in transit.
  transitDestinationId: '',
  // Phase 6.2.5.B — game day on which an in-transit MS lands at its
  // destination. Read by msTransitSystem on day-rollover.
  transitArrivalDay: 0,
  // Phase 6.2.5.C — per-sortie resources. Capped by the corresponding
  // stat on MsStatSheet (which projects from template + frame mod effects).
  //   currentPropellant     — drains under thrust; 0 = stranded (drift).
  //   currentAmmoByWeapon   — per-hardpoint shot count; 0 = weapon disabled.
  //                           Energy weapons (ammoCapacity = Infinity) are
  //                           initialized to Infinity and the drain loop
  //                           never decrements them.
  //   currentLifeSupport    — pilot oxygen minutes; only `eject + drift`
  //                           events test the floor.
  // All three reset to their caps on dock-resupply complete.
  currentPropellant: 0,
  currentAmmoByWeapon: {} as Record<string, number>,
  currentLifeSupport: 0,
  // Phase 6.2.5.C — installed frame mod ids. Sum of slotCount over the
  // installed mods must be ≤ MsStatSheet getStat('frameSlots'). Each
  // installed mod also seeds an Effect on MsEffectsList with source
  // `eff:framemod:<id>` (see ecs/msEffects.ts).
  frameMods: [] as string[],
})

export const MsStatSheet = trait(() => ({
  sheet: createMsSheet(),
}))
export type MsStatSheetT = StatSheet<MsStatId>

export const MsEffectsList = trait(() => ({
  list: [] as Effect<MsStatId>[],
}))

// Singleton. Spawned once on a dedicated entity keyed 'player-parts-inv'.
// Maps msWeaponId → count of parts in the player's stockpile. Frame mod
// inventory is on the same singleton (separate map) since both come from
// the same conceptual depot parts stash. Phase 6.2.5.C added frameMods.
export const PlayerPartsInventory = trait(() => ({
  weapons: {} as Record<string, number>,
  frameMods: {} as Record<string, number>,
}))

// On the hangar-bay sprite and terminal entities. Binds them back to
// their MS entity so the interaction handler can resolve which Ms to
// operate on.
export const MsRef = trait({
  msKey: '',
})
