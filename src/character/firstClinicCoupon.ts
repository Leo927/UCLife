// Phase 4.0 — first-clinic-visit coupon. Granted implicitly to the
// player (the flag is absent on a fresh save, which reads as "coupon
// available"). The civilian + AE clinic branches read the flag, waive
// the diagnosis fee on the first visit, and consume the coupon.
//
// Stored on the Flags trait so it round-trips through save/load via the
// existing progression serializer.

import type { Entity } from 'koota'
import { Flags } from '../ecs/traits'

export const FIRST_CLINIC_COUPON_FLAG = 'firstClinicCouponUsed'

export function consumeFirstClinicCoupon(player: Entity): void {
  if (!player.has(Flags)) player.add(Flags)
  const f = player.get(Flags)!
  player.set(Flags, { flags: { ...f.flags, [FIRST_CLINIC_COUPON_FLAG]: true } })
}
