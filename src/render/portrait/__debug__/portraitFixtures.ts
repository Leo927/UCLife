// Synthetic fixtures for the portrait Playwright tests. The HR/Realtor/AE
// conversation panels only render when an NPC is occupying the matching
// workstation in `working` state — too non-deterministic to set up via the
// BT, so we pin it directly. Installs window.uclifePinClerk in dev. Does
// NOT reset the world; tests needing a clean slate must page.goto() first.

import type { Entity } from 'koota'
import { Action, Character, Workstation } from '../../../ecs/traits'
import { world } from '../../../ecs/world'

/**
 * Pin a Character entity onto a workstation matching `specId` in `working`
 * state. Returns the pinned NPC, or null when no matching workstation exists.
 */
export function pinClerkOnShift(specId: string): Entity | null {
  let target: Entity | null = null
  for (const ws of world.query(Workstation)) {
    const w = ws.get(Workstation)
    if (!w) continue
    if (w.specId === specId) {
      target = ws
      break
    }
  }
  if (!target) return null

  const targetTrait = target.get(Workstation)!
  let npc: Entity | null = targetTrait.occupant ?? null
  if (!npc) {
    for (const c of world.query(Character)) {
      if (c === target) continue
      npc = c
      break
    }
  }
  if (!npc) return null

  // Large duration so the action doesn't tick down to idle mid-test.
  target.set(Workstation, { ...targetTrait, occupant: npc })
  if (npc.has(Action)) {
    npc.set(Action, { kind: 'working', remaining: 100000, total: 100000 })
  } else {
    npc.add(Action({ kind: 'working', remaining: 100000, total: 100000 }))
  }
  return npc
}

if (typeof window !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  ;(window as unknown as { uclifePinClerk: (s: string) => Entity | null }).uclifePinClerk = pinClerkOnShift
}
