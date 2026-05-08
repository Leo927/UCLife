// Phase 5.5.6 faction-side traits — StatSheet + Effects + Unlocks +
// Research queue. Mirrors the per-character attributes/effects pair: the
// sheet's modifier arrays are derived from the FactionEffects list, so on
// load we restore the effects first and rebuild the sheet's modifier
// arrays from them.
//
// Each serializer lands as its own entry so the on-disk shape stays
// readable: a faction's snap carries one `factionSheet`, one
// `factionEffects`, one `factionUnlocks`, one `factionResearch` field.
//
// Registration order (in index.ts): factionSheet must run BEFORE
// factionEffects so the sheet exists when the effects writer rebuilds
// its modifier arrays.

import { registerTraitSerializer } from '../../save/traitRegistry'
import {
  FactionSheet, FactionEffectsList, FactionUnlocks, FactionResearch,
  type FactionStatId,
} from '../../ecs/traits'
import {
  attachFormulas, serializeSheet, type SerializedSheet,
} from '../../stats/sheet'
import {
  FACTION_STAT_IDS, FACTION_STAT_FORMULAS,
} from '../../stats/factionSchema'
import { rebuildSheetFromEffects, type Effect } from '../../stats/effects'

interface FactionSheetSnap {
  sheet: SerializedSheet<FactionStatId>
}

registerTraitSerializer<FactionSheetSnap>({
  id: 'factionSheet',
  trait: FactionSheet,
  read: (e) => ({ sheet: serializeSheet(e.get(FactionSheet)!.sheet) }),
  write: (e, v) => {
    const sheet = attachFormulas(FACTION_STAT_IDS, FACTION_STAT_FORMULAS, v.sheet)
    if (e.has(FactionSheet)) e.set(FactionSheet, { sheet })
    else e.add(FactionSheet({ sheet }))
  },
  reset: (e) => {
    // setupWorld may not have added the trait on a non-bootstrapped Faction
    // (defensive). If it did, leaving the freshly-built sheet alone is
    // correct behavior — load with no factionSheet field on a Faction snap
    // is a fresh-start signal.
    if (!e.has(FactionSheet)) return
  },
})

interface FactionEffectsSnap {
  list: Effect<FactionStatId>[]
}

registerTraitSerializer<FactionEffectsSnap>({
  id: 'factionEffects',
  trait: FactionEffectsList,
  read: (e) => {
    const f = e.get(FactionEffectsList)!
    return {
      list: f.list.map((x) => ({ ...x, modifiers: x.modifiers.map((m) => ({ ...m })) })),
    }
  },
  write: (e, v) => {
    const list = v.list.map((x) => ({ ...x, modifiers: x.modifiers.map((m) => ({ ...m })) }))
    if (e.has(FactionEffectsList)) e.set(FactionEffectsList, { list })
    else e.add(FactionEffectsList({ list }))
    // Rewrite the sheet's modifier arrays from the restored effects.
    const fs = e.get(FactionSheet)
    if (fs) e.set(FactionSheet, { sheet: rebuildSheetFromEffects(fs.sheet, list) })
  },
  reset: (e) => {
    if (e.has(FactionEffectsList)) e.set(FactionEffectsList, { list: [] })
  },
})

interface FactionUnlocksSnap {
  ids: string[]
}

registerTraitSerializer<FactionUnlocksSnap>({
  id: 'factionUnlocks',
  trait: FactionUnlocks,
  read: (e) => ({ ids: e.get(FactionUnlocks)!.ids.slice() }),
  write: (e, v) => {
    const ids = v.ids.slice()
    if (e.has(FactionUnlocks)) e.set(FactionUnlocks, { ids })
    else e.add(FactionUnlocks({ ids }))
  },
  reset: (e) => {
    if (e.has(FactionUnlocks)) e.set(FactionUnlocks, { ids: [] })
  },
})

interface FactionResearchSnap {
  queue: string[]
  accumulated: number
  yesterdayPerDay: number
  lostOverflowToday: number
  completed: string[]
}

registerTraitSerializer<FactionResearchSnap>({
  id: 'factionResearch',
  trait: FactionResearch,
  read: (e) => {
    const f = e.get(FactionResearch)!
    return {
      queue: f.queue.slice(),
      accumulated: f.accumulated,
      yesterdayPerDay: f.yesterdayPerDay,
      lostOverflowToday: f.lostOverflowToday,
      completed: f.completed.slice(),
    }
  },
  write: (e, v) => {
    const next = {
      queue: v.queue.slice(),
      accumulated: v.accumulated,
      yesterdayPerDay: v.yesterdayPerDay,
      lostOverflowToday: v.lostOverflowToday,
      completed: v.completed.slice(),
    }
    if (e.has(FactionResearch)) e.set(FactionResearch, next)
    else e.add(FactionResearch(next))
  },
  reset: (e) => {
    if (e.has(FactionResearch)) {
      e.set(FactionResearch, {
        queue: [], accumulated: 0, yesterdayPerDay: 0,
        lostOverflowToday: 0, completed: [],
      })
    }
  },
})
