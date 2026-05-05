// Attributes carries the modifier-driven StatSheet plus a per-attribute
// drift map. v7+ snapshots store a SerializedSheet directly; pre-v7
// (legacy) bundles store the old { value, talent, recentUse, recentStress }
// shape and are migrated here on write.
//
// Always present on every Character post-setupWorld, so reset() is a
// no-op — the loader keeps the freshly-rebuilt attribute trait intact
// when a save predates this entity's spawn.

import { registerTraitSerializer } from '../../save/traitRegistry'
import { Attributes, type AttributeDrift } from '../../ecs/traits'
import {
  serializeSheet, attachFormulas, setBase, type SerializedSheet,
} from '../../stats/sheet'
import {
  STAT_IDS, STAT_FORMULAS, ATTRIBUTE_IDS, SKILL_IDS, createCharacterSheet,
  type StatId, type SkillStatId,
} from '../../stats/schema'

type AttrId = 'strength' | 'endurance' | 'charisma' | 'intelligence' | 'reflex' | 'resolve'

interface AttrSnap {
  sheet: SerializedSheet<StatId>
  drift: Record<AttrId, AttributeDrift>
  lastDriftDay: number
}

// Pre-v7 shape, kept here so the loader can migrate older bundles into
// the modifier-based sheet without dragging the type into save/index.ts.
interface LegacyStatState {
  value: number
  talent: number
  recentUse: number
  recentStress: number
}
type LegacyAttrSnap = Record<AttrId, LegacyStatState> & { lastDriftDay: number }

function isLegacy(raw: unknown): raw is LegacyAttrSnap {
  return !!raw && typeof raw === 'object' && !('sheet' in (raw as object))
}

registerTraitSerializer<AttrSnap>({
  id: 'attributes',
  trait: Attributes,
  read: (e) => {
    const a = e.get(Attributes)!
    return {
      sheet: serializeSheet(a.sheet),
      drift: {
        strength: { ...a.drift.strength },
        endurance: { ...a.drift.endurance },
        charisma: { ...a.drift.charisma },
        intelligence: { ...a.drift.intelligence },
        reflex: { ...a.drift.reflex },
        resolve: { ...a.drift.resolve },
      },
      lastDriftDay: a.lastDriftDay,
    }
  },
  write: (e, v, ctx) => {
    if (ctx.version < 7 || isLegacy(v)) {
      // Legacy: lift the six { value, talent, recentUse, recentStress }
      // entries into a fresh sheet (value -> base) plus the new drift map.
      const legacy = v as unknown as LegacyAttrSnap
      let sheet = createCharacterSheet()
      for (const id of ATTRIBUTE_IDS) {
        sheet = setBase(sheet, id, legacy[id].value)
      }
      e.set(Attributes, {
        sheet,
        drift: {
          strength:     { recentUse: legacy.strength.recentUse,     recentStress: legacy.strength.recentStress,     talent: legacy.strength.talent },
          endurance:    { recentUse: legacy.endurance.recentUse,    recentStress: legacy.endurance.recentStress,    talent: legacy.endurance.talent },
          charisma:     { recentUse: legacy.charisma.recentUse,     recentStress: legacy.charisma.recentStress,     talent: legacy.charisma.talent },
          intelligence: { recentUse: legacy.intelligence.recentUse, recentStress: legacy.intelligence.recentStress, talent: legacy.intelligence.talent },
          reflex:       { recentUse: legacy.reflex.recentUse,       recentStress: legacy.reflex.recentStress,       talent: legacy.reflex.talent },
          resolve:      { recentUse: legacy.resolve.recentUse,      recentStress: legacy.resolve.recentStress,      talent: legacy.resolve.talent },
        },
        lastDriftDay: legacy.lastDriftDay,
      })
      return
    }
    const sheet = attachFormulas(STAT_IDS, STAT_FORMULAS, v.sheet)
    e.set(Attributes, {
      sheet,
      drift: {
        strength: { ...v.drift.strength },
        endurance: { ...v.drift.endurance },
        charisma: { ...v.drift.charisma },
        intelligence: { ...v.drift.intelligence },
        reflex: { ...v.drift.reflex },
        resolve: { ...v.drift.resolve },
      },
      lastDriftDay: v.lastDriftDay,
    })
  },
})

// Legacy `skills` snapshot — pre-v8 saves carry skill XP in its own
// top-level trait. v8+ folds skill XP into the Attributes sheet as a
// stat base. This serializer lifts the legacy snap onto the sheet on
// load; on save it returns undefined so new bundles don't repeat the
// data. Bound to `Attributes` so its write runs only after the
// attributes serializer has rebuilt the sheet (registration order).
registerTraitSerializer<Partial<Record<SkillStatId, number>>>({
  id: 'skills',
  trait: Attributes,
  read: () => undefined,
  write: (e, v, ctx) => {
    if (ctx.version >= 8) return
    const a = e.get(Attributes)
    if (!a) return
    let sheet = a.sheet
    for (const id of SKILL_IDS) {
      const xp = v[id] ?? 0
      sheet = setBase(sheet, id, xp)
    }
    if (sheet !== a.sheet) e.set(Attributes, { ...a, sheet })
  },
})
