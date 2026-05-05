// Effects trait — round-trips the per-character Effect list. The
// StatSheet's modifier arrays are derived from this list, so on load
// we rewrite the sheet's modifier arrays from the restored effects
// before any system reads getStat(). This keeps Effects.list as the
// single source of truth and the sheet's per-stat `modifiers` arrays
// always in sync with it.
//
// Registration order matters: the Attributes trait writer must run
// before this writer so the sheet exists when we rebuild its
// modifier arrays. The manifest in index.ts orders 'attributes'
// (under attributes.ts) before 'effects'.
//
// Pre-v9 saves carry no Effects field on the EntitySnap. The legacy
// background/perk modifiers live inside the saved StatSheet's
// per-stat modifier arrays and survive the load untouched — there is
// no automatic migration of those into the Effects list. Players who
// re-roll a background or buy/refund a perk after loading an old
// save get a fresh Effect emitted; until then the legacy modifiers
// keep producing the same numbers because the fold math is identical.

import { registerTraitSerializer } from '../../save/traitRegistry'
import { Attributes, Effects, type Effect } from '../../ecs/traits'
import { rebuildSheetFromEffects } from '../../stats/effects'

interface EffectsSnap {
  list: Effect[]
}

registerTraitSerializer<EffectsSnap>({
  id: 'effects',
  trait: Effects,
  read: (e) => {
    const eff = e.get(Effects)!
    // Deep-copy each Effect so a later mutation on the live trait can't
    // mutate the snapshot reference held by superjson.
    return {
      list: eff.list.map((x) => ({ ...x, modifiers: x.modifiers.map((m) => ({ ...m })) })),
    }
  },
  write: (e, v) => {
    const list = v.list.map((x) => ({ ...x, modifiers: x.modifiers.map((m) => ({ ...m })) }))
    if (e.has(Effects)) e.set(Effects, { list })
    else e.add(Effects({ list }))
    // Rewrite the sheet's modifier arrays from the restored Effects so
    // any pre-existing 'eff:*' modifiers carried in by the attributes
    // serializer are replaced by the canonical fold of the Effect list.
    const a = e.get(Attributes)
    if (a) e.set(Attributes, { ...a, sheet: rebuildSheetFromEffects(a.sheet, list) })
  },
  reset: (e) => {
    // setupWorld may not have added the trait (older code paths). Idempotent.
    if (e.has(Effects)) e.set(Effects, { list: [] })
  },
})
