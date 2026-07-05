// MS damage-state derivation — Task 9 (W1 playable-loop). Shared by every
// write site that touches an Ms entity's hull/armor or custody location
// (ecs/spawn.ts, systems/hangarRepair.ts, systems/msCustody.ts,
// systems/msTransfer.ts, systems/msDelivery.ts, boot/saveHandlers/ms.ts) so
// `Ms.damageState` never drifts from the fields it's derived from.
//
// 'in-repair' iff the MS carries hull/armor deficit AND currently sits at a
// depot (dockedAtPoiId set). An MS damaged while still aboard a ship (mid-
// deployment, no repair crew touching it) stays 'ready'-with-deficit until
// custody moves it to a depot — see Design/fleet.md's supply-drain note:
// `supplyPerRepairDay` only bills while a hangar crew is actually working
// the hull, not for the entire time it happens to be damaged.
export type MsDamageState = 'ready' | 'in-repair'

export interface MsDamageFields {
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  dockedAtPoiId: string
}

export function computeMsDamageState(m: MsDamageFields): MsDamageState {
  const damaged = m.hullCurrent < m.hullMax || m.armorCurrent < m.armorMax
  return damaged && m.dockedAtPoiId !== '' ? 'in-repair' : 'ready'
}
