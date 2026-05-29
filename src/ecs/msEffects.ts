// MS-side Effect helpers — Phase 6.2.5.A. Mirrors shipEffects.ts.

import type { Entity } from 'koota'
import { Ms, MsStatSheet, MsEffectsList, type MsStatId } from './traits'
import {
  applyEffectToSheet, removeEffectFromSheet, rebuildSheetFromEffects, type Effect,
} from '../stats/effects'
import { setBase, getStat } from '../stats/sheet'
import { createMsSheet } from '../stats/msSchema'
import { getMsClass, type MsClassDef } from '../data/ms'
import { getMsWeapon } from '../data/ms-weapons'
import { getMsFrameMod, frameModEffectId } from '../data/ms-frame-mods'

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
  // Phase 6.2.5.C — sortie resource caps + frame mod budget. Bases come
  // straight off the MS template; frame mod Effects layer on top via
  // MsEffectsList during install.
  sheet = setBase(sheet, 'propellantStorage', cls.propellantStorage)
  sheet = setBase(sheet, 'lifeSupportMinutes', cls.lifeSupportMinutes)
  sheet = setBase(sheet, 'frameSlots', cls.frameSlots)
  // sortieResupplyMul base 1 = no-op; frame mods + research stack into it
  // multiplicatively (or additively via percentMult on the engine).
  sheet = setBase(sheet, 'sortieResupplyMul', 1)
  return sheet
}

// Phase 6.2.5.C — frame mod install / uninstall helpers. Both write
// through addMsEffect / removeMsEffect so MsStatSheet stays consistent
// with MsEffectsList. The source string is `eff:framemod:<modId>` so
// removeBySource cleanly unwinds one mod without touching siblings.
//
// Caller responsibilities (verb-side; not enforced here):
//   - gate on Ms being at a depot (Design/fleet.md depot-vs-forward).
//   - check frameSlots budget (sum installed slotCount + new ≤ getStat).
//   - debit / credit PlayerPartsInventory.frameMods.
//
// These helpers only touch the per-MS sheet + effects list + Ms.frameMods.
export function installFrameModEffect(ms: Entity, modId: string): boolean {
  const def = getMsFrameMod(modId)
  const cur = ms.get(Ms)
  if (!cur) return false
  if (cur.frameMods.includes(modId)) return false  // idempotent / refuse duplicate
  const effect: MsEffect = {
    id: frameModEffectId(modId),
    originId: modId,
    family: 'gear',
    nameZh: def.nameZh,
    descZh: def.descZh,
    // The data-layer types `FrameModStatId` / `FrameModType` are string-
    // typed mirrors of MsStatId + ModType (the layering rule forbids
    // src/data/ from reaching into src/stats/). Cast through unknown so
    // TS knows the runtime values are the canonical types.
    modifiers: def.effects.map((e) => ({
      statId: e.statId as unknown as MsStatId,
      type: e.type as unknown as MsEffect['modifiers'][number]['type'],
      value: e.value,
    })),
  }
  if (!addMsEffect(ms, effect)) return false
  ms.set(Ms, { ...cur, frameMods: [...cur.frameMods, modId] })
  clampSortieResourcesToCaps(ms)
  return true
}

export function uninstallFrameModEffect(ms: Entity, modId: string): boolean {
  const cur = ms.get(Ms)
  if (!cur) return false
  if (!cur.frameMods.includes(modId)) return false
  if (!removeMsEffect(ms, frameModEffectId(modId))) return false
  ms.set(Ms, { ...cur, frameMods: cur.frameMods.filter((id) => id !== modId) })
  clampSortieResourcesToCaps(ms)
  return true
}

// After a frame mod install / uninstall the sortie-resource caps may
// have shrunk (e.g. uninstalling extPropellantTank). Clamp the current
// values so the runtime stays consistent with the new sheet — players
// don't get to keep overflow propellant just because their tank just
// got smaller.
function clampSortieResourcesToCaps(ms: Entity): void {
  const sheet = ms.get(MsStatSheet)?.sheet
  if (!sheet) return
  const cur = ms.get(Ms)
  if (!cur) return
  const propCap = getStat(sheet, 'propellantStorage')
  const lsCap = getStat(sheet, 'lifeSupportMinutes')
  const nextProp = Math.min(cur.currentPropellant, propCap)
  const nextLs = Math.min(cur.currentLifeSupport, lsCap)
  if (nextProp !== cur.currentPropellant || nextLs !== cur.currentLifeSupport) {
    ms.set(Ms, { ...cur, currentPropellant: nextProp, currentLifeSupport: nextLs })
  }
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
  // Phase 6.2.5.C — seed sortie resources to template caps unless the
  // caller already set them (the save handler runs attachMsStatSheet
  // implicitly during restore; we don't want to clobber a load-time
  // restored value). Zero means "uninitialized" — pre-6.2.5.C saves +
  // every fresh spawn pass through this branch.
  if (m.currentPropellant === 0 && m.currentLifeSupport === 0) {
    msEnt.set(Ms, {
      ...m,
      currentPropellant: cls.propellantStorage,
      currentLifeSupport: cls.lifeSupportMinutes,
      currentAmmoByWeapon: ammoCapsForMs(cls, m.mountedWeapons),
    })
  }
}

// Project the per-MS ammo cap map: for each hardpoint, look up the
// equipped weapon's ammoCapacity and seed currentAmmoByWeapon[hpId] to
// that value. Energy weapons (ammoCapacity = Infinity) seed to Infinity
// and the drain path skips them.
export function ammoCapsForMs(
  cls: MsClassDef, mountedWeapons: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const hp of cls.hardpoints) {
    const wId = mountedWeapons[hp.id] ?? hp.defaultWeaponId
    out[hp.id] = getMsWeapon(wId).ammoCapacity
  }
  return out
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
