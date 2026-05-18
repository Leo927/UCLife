// Off-shift occupants (walking/eating/at home) are skipped — they can't
// actually transact even though the workstation still references them.

import type { Entity, World } from 'koota'
import { Action, Workstation } from '../../../ecs/traits'
import { world } from '../../../ecs/world'

export function findClerkBySpec(w: World, specId: string): Entity | null {
  const stations = w.query(Workstation)
  for (const ws of stations) {
    const wt = ws.get(Workstation)
    if (!wt) continue
    if (wt.specId !== specId) continue
    if (!wt.occupant) continue
    const action = wt.occupant.get(Action)
    if (action?.kind !== 'working') continue
    return wt.occupant
  }
  return null
}

if (typeof window !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  ;(window as unknown as { uclifeFindClerk: (s: string) => Entity | null }).uclifeFindClerk = (specId: string) =>
    findClerkBySpec(world, specId)
}
