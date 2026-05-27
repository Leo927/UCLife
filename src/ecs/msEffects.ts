// MS-side Effect helpers — Phase 6.2.5.A. Mirrors shipEffects.ts.

import type { Entity } from 'koota'
import { Ms, MsStatSheet, MsEffectsList, type MsStatId } from './traits'
import {
  applyEffectToSheet, removeEffectFromSheet, rebuildSheetFromEffects, type Effect,
} from '../stats/effects'
import { setBase } from '../stats/sheet'
import { createMsSheet } from '../stats/msSchema'
import { getMsClass, type MsClassDef } from '../data/ms'

export type MsEffect = Effect<MsStatId>

export function addMsEffect(ms: Entity, effect: MsEffect): boolean {
  if (!ms.has(MsStatSheet)) return false
  if (!ms.has(MsEffectsList)) ms.add(MsEffectsList)
  const cur = ms.get(MsEffectsList)!
  const filtered = cur.list.filter((e) => e.id !== effect.id)
  ms.set(MsEffectsList, { list: [...filtered, effect] })
  const ss = ms.get(MsStatSheet)!
  ms.set(MsStatSheet, { sheet: applyEffectToSheet(ss.sheet, effect) })
  return true
}

export function removeMsEffect(ms: Entity, effectId: string): boolean {
  if (!ms.has(MsEffectsList)) return false
  const cur = ms.get(MsEffectsList)!
  const next = cur.list.filter((e) => e.id !== effectId)
  if (next.length === cur.list.length) return false
  ms.set(MsEffectsList, { list: next })
  const ss = ms.get(MsStatSheet)
  if (ss) ms.set(MsStatSheet, { sheet: removeEffectFromSheet(ss.sheet, effectId) })
  return true
}

export function getMsEffects(ms: Entity): readonly MsEffect[] {
  if (!ms.has(MsEffectsList)) return []
  return ms.get(MsEffectsList)!.list
}

export function projectMsSheet(cls: MsClassDef): ReturnType<typeof createMsSheet> {
  let sheet = createMsSheet()
  sheet = setBase(sheet, 'hullPoints', cls.hullMax)
  sheet = setBase(sheet, 'armorPoints', cls.armorMax)
  sheet = setBase(sheet, 'topSpeed', cls.topSpeed)
  sheet = setBase(sheet, 'maneuverability', cls.angularAccel)
  return sheet
}

export function attachMsStatSheet(msEnt: Entity): void {
  const m = msEnt.get(Ms)
  if (!m) throw new Error('attachMsStatSheet: entity missing Ms trait')
  const cls = getMsClass(m.templateId)
  const sheet = projectMsSheet(cls)
  if (!msEnt.has(MsStatSheet)) {
    msEnt.add(MsStatSheet)
  }
  msEnt.set(MsStatSheet, { sheet })
  if (!msEnt.has(MsEffectsList)) {
    msEnt.add(MsEffectsList)
  }
  msEnt.set(MsEffectsList, { list: [] })
}

export function rebuildMsSheetFromEffects(msEnt: Entity): void {
  const m = msEnt.get(Ms)
  if (!m) return
  const cls = getMsClass(m.templateId)
  const baseSheet = projectMsSheet(cls)
  const effects = msEnt.get(MsEffectsList)?.list ?? []
  const sheet = rebuildSheetFromEffects(baseSheet, effects)
  if (!msEnt.has(MsStatSheet)) msEnt.add(MsStatSheet)
  msEnt.set(MsStatSheet, { sheet })
}
