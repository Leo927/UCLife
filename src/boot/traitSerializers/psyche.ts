// Phase 5.3 — psychology reveal state (Design/social/psychology.md
// § Save contract). The temperament/sympathy Effects themselves ride the
// Effects serializer; this persists only what the player has learned.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Character, Psyche } from '../../ecs/traits'
import { applyPsychology, psychologyForName } from '../../character/psychology'

registerTraitSerializer<TraitInstance<typeof Psyche>>({
  id: 'psyche',
  trait: Psyche,
  read: (e) => ({ ...e.get(Psyche)!, revealed: [...e.get(Psyche)!.revealed] }),
  write: (e, v) => {
    if (!e.has(Psyche)) e.add(Psyche)
    e.set(Psyche, { revealed: [...v.revealed], lastRevealDay: v.lastRevealDay })
  },
  // Pre-psychology save: the Effects serializer (registered earlier, so
  // it has already run for this entity) replaced the spawn-time Effect
  // list with the saved one, stripping the temperament/sympathy Effects
  // spawnNPC applied. Re-derive them so old saves self-heal; reveal
  // state stays at its spawn default (nothing learned yet).
  reset: (e) => {
    if (!e.has(Psyche)) return
    const name = e.get(Character)?.name
    if (!name) return
    applyPsychology(e, psychologyForName(name))
    e.set(Psyche, { revealed: [], lastRevealDay: 0 })
  },
})
