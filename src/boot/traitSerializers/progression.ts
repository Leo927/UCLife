// Player progression: Ambitions + Flags. Both player-only — added by
// the player bootstrap, not by spawnNPC. reset() removes the trait so
// loading a save from before the player picked / unlocked anything
// doesn't leave a stale copy.
//
// Ambitions has a post-write side effect: re-sync perk modifiers onto
// the StatSheet. That depends on Attributes already being patched for
// this entity, which holds because the per-entity overlay loop iterates
// serializers in registration order and Attributes is registered first
// (see boot/traitSerializers/index.ts).

import { registerTraitSerializer } from '../../save/traitRegistry'
import {
  Ambitions, Attributes, Flags, SkillPerkState,
  type AmbitionHistoryEntry, type AmbitionSlot,
} from '../../ecs/traits'
import { syncPerkModifiers } from '../../character/perkSync'

interface AmbitionsSnap {
  active: AmbitionSlot[]
  history: AmbitionHistoryEntry[]
  apBalance: number
  apEarned: number
  perks: string[]
}

registerTraitSerializer<AmbitionsSnap>({
  id: 'ambitions',
  trait: Ambitions,
  read: (e) => {
    const a = e.get(Ambitions)!
    return {
      active: a.active.map((s) => ({ ...s })),
      history: a.history.map((h) => ({ ...h })),
      apBalance: a.apBalance,
      apEarned: a.apEarned,
      perks: [...a.perks],
    }
  },
  write: (e, v) => {
    const payload = {
      active: v.active.map((s) => ({ ...s })),
      history: v.history.map((h) => ({ ...h })),
      apBalance: v.apBalance ?? 0,
      apEarned: v.apEarned ?? 0,
      perks: v.perks ? [...v.perks] : [],
    }
    if (e.has(Ambitions)) e.set(Ambitions, payload)
    else e.add(Ambitions(payload))
    // Re-derive sheet modifiers from perks. Skip if the entity has no
    // Attributes — only player-side perks land on the sheet anyway.
    if (e.has(Attributes)) syncPerkModifiers(e, payload.perks)
  },
  reset: (e) => { if (e.has(Ambitions)) e.remove(Ambitions) },
})

// Issue #142 — skill-perk respec count. The picks themselves ride the
// Effects serializer; only the cost-curve counter needs its own field.
interface SkillPerkSnap { respecCount: number }
registerTraitSerializer<SkillPerkSnap>({
  id: 'skillPerkState',
  trait: SkillPerkState,
  read: (e) => ({ respecCount: e.get(SkillPerkState)!.respecCount }),
  write: (e, v) => {
    const payload = { respecCount: v.respecCount ?? 0 }
    if (e.has(SkillPerkState)) e.set(SkillPerkState, payload)
    else e.add(SkillPerkState(payload))
  },
  reset: (e) => { if (e.has(SkillPerkState)) e.remove(SkillPerkState) },
})

interface FlagsSnap { flags: Record<string, boolean> }
registerTraitSerializer<FlagsSnap>({
  id: 'flags',
  trait: Flags,
  read: (e) => ({ flags: { ...e.get(Flags)!.flags } }),
  write: (e, v) => {
    const payload = { flags: { ...v.flags } }
    if (e.has(Flags)) e.set(Flags, payload)
    else e.add(Flags(payload))
  },
  reset: (e) => { if (e.has(Flags)) e.remove(Flags) },
})
