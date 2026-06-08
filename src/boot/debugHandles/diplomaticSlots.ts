// Phase 7.0.E.4 — diplomatic-slot debug handles for deterministic smoke tests.
// Force-runs the occupancy eval (bypassing the wartime/cadence gate), reads the
// slot occupancy + the positions of each slot's staff/guards, sets the player's
// faction alignment, overrides a faction's member count, and reads the eject
// count.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS, getActiveSceneId } from '../../ecs/world'
import {
  IsPlayer, FactionRole, EntityKey, Position, DiplomaticSlot, MoveTarget,
} from '../../ecs/traits'
import type { FactionId } from '../../config'
import {
  occupancyTick, factionStrength, factionMemberCount,
  setFactionMemberCountOverride,
} from '../../systems/diplomaticSlots'
import { allOccupancies, getEjectCount } from '../../sim/diplomaticSlotState'

// Run the occupancy evaluation once at the current date, bypassing the
// wartime/cadence gate (the daily cadence would need many days of advance).
registerDebugHandle('forceSlotOccupancyTick', () => {
  occupancyTick()
  return true
})

// The slot occupancy surface: each slot's id + occupant faction (from the live
// anchor entity) + the EntityKeys and pixel positions of its staff/guards, so
// the smoke can assert "staff reached the anchor".
registerDebugHandle('getDiplomaticSlotState', () => {
  const world = getWorld(getActiveSceneId())
  const anchorBySlot = new Map<string, {
    occupant: string; anchorX: number; anchorY: number; exitX: number; exitY: number
  }>()
  for (const e of world.query(DiplomaticSlot)) {
    const d = e.get(DiplomaticSlot)!
    anchorBySlot.set(d.slotId, {
      occupant: d.occupantFaction, anchorX: d.anchorX, anchorY: d.anchorY, exitX: d.exitX, exitY: d.exitY,
    })
  }

  let playerMoveTarget: { x: number; y: number } | null = null
  {
    const p = world.queryFirst(IsPlayer)
    const mt = p?.get(MoveTarget)
    if (mt) playerMoveTarget = { x: mt.x, y: mt.y }
  }

  const posOf = (key: string): { x: number; y: number } | null => {
    for (const sceneId of SCENE_IDS) {
      const w = getWorld(sceneId)
      for (const e of w.query(EntityKey, Position)) {
        if (e.get(EntityKey)!.key === key) {
          const p = e.get(Position)!
          return { x: p.x, y: p.y }
        }
      }
    }
    return null
  }

  const slots = Array.from(anchorBySlot.entries()).map(([slotId, a]) => {
    const occ = allOccupancies().find((o) => o.slotId === slotId) ?? null
    return {
      slotId,
      occupant: a.occupant === '' ? null : a.occupant,
      anchor: { x: a.anchorX, y: a.anchorY },
      exit: { x: a.exitX, y: a.exitY },
      staff: (occ?.staffKeys ?? []).map((k) => ({ key: k, pos: posOf(k) })),
      guards: (occ?.guardKeys ?? []).map((k) => ({ key: k, pos: posOf(k) })),
    }
  })
  return { slots, ejectCount: getEjectCount(), playerMoveTarget }
})

// Set (or clear) the player's faction alignment. Neutral = null → removes the
// FactionRole so the guard reads the player as unaligned (passes freely).
registerDebugHandle('setPlayerAlignment', (factionId: FactionId | null) => {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    if (factionId === null) {
      if (p.has(FactionRole)) p.remove(FactionRole)
    } else if (p.has(FactionRole)) {
      p.set(FactionRole, { faction: factionId, role: 'staff' })
    } else {
      p.add(FactionRole({ faction: factionId, role: 'staff' }))
    }
    return true
  }
  return false
})

// Read the player's faction alignment (the FactionRole faction id, or null
// when neutral/unaligned). Lets the smoke assert alignment survives save/load.
registerDebugHandle('getPlayerAlignment', () => {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    const fr = p.get(FactionRole)
    return fr ? fr.faction : null
  }
  return null
})

// Override (or clear, with null) a faction's effective member count so the
// smoke can push it above / below the consulate threshold deterministically.
registerDebugHandle('setFactionMemberCountForTest', (factionId: string, count: number | null) => {
  setFactionMemberCountOverride(factionId, count)
  return true
})

// Read the strength surface for assertions.
registerDebugHandle('getFactionStrength', (factionId: string) => ({
  memberCount: factionMemberCount(factionId),
  strength: factionStrength(factionId),
}))
