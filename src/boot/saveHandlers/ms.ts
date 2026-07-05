// MS roster save handler — Phase 6.2.5.A; extended at Phase 6.2.5.B with
// depot-storage + pilot-reference + transit fields on Ms entities.
//
// Snapshot/restore the Ms entity roster and PlayerPartsInventory in the
// playerShipInterior world. Pre-6.2.5.A saves (missing 'ms' block) auto-
// grant the starter MS on restore.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import { Ms, PlayerPartsInventory, EntityKey, MsStatSheet, MsEffectsList } from '../../ecs/traits'
import type { MsStatId } from '../../stats/msSchema'
import { MS_STAT_IDS, MS_STAT_FORMULAS } from '../../stats/msSchema'
import { attachFormulas, serializeSheet, type SerializedSheet } from '../../stats/sheet'
import { rebuildSheetFromEffects, type Effect } from '../../stats/effects'
import { attachMsStatSheet, ammoCapsForMs } from '../../ecs/msEffects'
import { getMsClass } from '../../data/ms'
import { refreshMsLayout, refreshAllDepotMsLayouts } from '../../ecs/spawn'
import { computeMsDamageState, type MsDamageState } from '../../ecs/msDamage'

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'

interface MsBlock {
  entityKey: string
  templateId: string
  name: string
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  mountedWeapons: Record<string, string>
  storedOnShipKey: string
  bayIndex: number
  // Phase 6.2.5.B — depot storage + pilot reference + transit fields.
  // Optional so pre-6.2.5.B saves round-trip cleanly (default to '').
  dockedAtPoiId?: string
  pilotId?: string
  transitDestinationId?: string
  transitArrivalDay?: number
  statSheet?: SerializedSheet<MsStatId>
  effects?: Effect<MsStatId>[]
  // Phase 6.2.5.C — per-sortie resources + frame mods. Optional so pre-
  // 6.2.5.C saves load cleanly (resource fields default to caps on
  // restore, frameMods to []). Note: transient combat-time state
  // (HangarDoorStates, ResupplyState, RecoveryTugState) is intentionally
  // NOT persisted — Design/sortie.md § Save / load makes tactical state
  // session-bound. Only the durable Ms-side resource fields persist.
  currentPropellant?: number
  // currentAmmoByWeapon stores Infinity for energy weapons; JSON can't
  // round-trip Infinity directly, so we save the sentinel string 'Inf'
  // for those entries and convert back on restore.
  currentAmmoByWeapon?: Record<string, number | 'Inf'>
  currentLifeSupport?: number
  frameMods?: string[]
  // Task 9 (W1 playable-loop) — repair-lifecycle state. Optional so pre-
  // Task-9 saves round-trip cleanly; restoreMs recomputes it from
  // hull/armor + dockedAtPoiId when absent (computeMsDamageState is a
  // pure function of exactly those fields, so this is never stale).
  damageState?: MsDamageState
}

interface PartsBlock {
  weapons: Record<string, number>
  // Phase 6.2.5.C — frame mod parts inventory. Optional so pre-6.2.5.C
  // saves round-trip cleanly (defaults to {} on restore).
  frameMods?: Record<string, number>
}

interface MsRosterBlock {
  roster: MsBlock[]
  parts?: PartsBlock
}

function snapshotMs(): MsRosterBlock | undefined {
  const w = getWorld(SHIP_SCENE_ID)
  const roster: MsBlock[] = []
  for (const ent of w.query(Ms, EntityKey)) {
    const ms = ent.get(Ms)!
    const key = ent.get(EntityKey)!.key
    const ssRaw = ent.get(MsStatSheet)?.sheet
    const effects = ent.get(MsEffectsList)?.list
    const ammoSerialized: Record<string, number | 'Inf'> = {}
    for (const [hpId, count] of Object.entries(ms.currentAmmoByWeapon)) {
      ammoSerialized[hpId] = Number.isFinite(count) ? count : 'Inf'
    }
    roster.push({
      entityKey: key,
      templateId: ms.templateId,
      name: ms.name,
      hullCurrent: ms.hullCurrent,
      hullMax: ms.hullMax,
      armorCurrent: ms.armorCurrent,
      armorMax: ms.armorMax,
      mountedWeapons: { ...ms.mountedWeapons },
      storedOnShipKey: ms.storedOnShipKey,
      bayIndex: ms.bayIndex,
      dockedAtPoiId: ms.dockedAtPoiId || undefined,
      pilotId: ms.pilotId || undefined,
      transitDestinationId: ms.transitDestinationId || undefined,
      transitArrivalDay: ms.transitArrivalDay || undefined,
      statSheet: ssRaw ? serializeSheet(ssRaw) : undefined,
      effects: effects ? [...effects] : undefined,
      currentPropellant: ms.currentPropellant,
      currentAmmoByWeapon: ammoSerialized,
      currentLifeSupport: ms.currentLifeSupport,
      frameMods: ms.frameMods.length > 0 ? [...ms.frameMods] : undefined,
      damageState: ms.damageState,
    })
  }
  if (roster.length === 0) return undefined

  let partsBlock: PartsBlock | undefined
  for (const ent of w.query(PlayerPartsInventory)) {
    const inv = ent.get(PlayerPartsInventory)!
    partsBlock = {
      weapons: { ...inv.weapons },
      frameMods: Object.keys(inv.frameMods).length > 0 ? { ...inv.frameMods } : undefined,
    }
    break
  }

  return { roster, parts: partsBlock }
}

function restoreMs(saved: unknown): void {
  const w = getWorld(SHIP_SCENE_ID)

  // Destroy any existing Ms entities before restoring.
  const doomed = []
  for (const ent of w.query(Ms)) doomed.push(ent)
  for (const ent of w.query(PlayerPartsInventory)) doomed.push(ent)
  for (const ent of doomed) ent.destroy()

  // W1 Task 5 — a save with no MS roster (a no-MS game, or a pre-6.2.5 save)
  // restores to an empty roster. The starter MS is no longer auto-granted
  // here; it's earned aboard the player's first bought hull.
  if (!saved || typeof saved !== 'object') {
    refreshMsLayout()
    refreshAllDepotMsLayouts()
    return
  }

  const block = saved as MsRosterBlock
  if (!Array.isArray(block.roster) || block.roster.length === 0) {
    refreshMsLayout()
    refreshAllDepotMsLayouts()
    return
  }

  for (const b of block.roster) {
    // Convert ammo 'Inf' sentinels back to Infinity. Missing / empty
    // means pre-6.2.5.C save — initialize from template caps via
    // attachMsStatSheet's zero-detect branch below.
    let ammoRestored: Record<string, number> = {}
    if (b.currentAmmoByWeapon) {
      for (const [hpId, count] of Object.entries(b.currentAmmoByWeapon)) {
        ammoRestored[hpId] = count === 'Inf' ? Infinity : (count as number)
      }
    }
    const dockedAtPoiId = b.dockedAtPoiId ?? ''
    const damageState = b.damageState ?? computeMsDamageState({
      hullCurrent: b.hullCurrent, hullMax: b.hullMax,
      armorCurrent: b.armorCurrent, armorMax: b.armorMax,
      dockedAtPoiId,
    })
    const msEnt = w.spawn(
      Ms({
        templateId: b.templateId,
        name: b.name ?? b.templateId,
        hullCurrent: b.hullCurrent,
        hullMax: b.hullMax,
        armorCurrent: b.armorCurrent,
        armorMax: b.armorMax,
        mountedWeapons: b.mountedWeapons ?? {},
        storedOnShipKey: b.storedOnShipKey ?? '',
        bayIndex: b.bayIndex ?? 0,
        dockedAtPoiId,
        pilotId: b.pilotId ?? '',
        transitDestinationId: b.transitDestinationId ?? '',
        transitArrivalDay: b.transitArrivalDay ?? 0,
        // Phase 6.2.5.C — sortie resources. Zero on restore triggers the
        // attachMsStatSheet seeding branch (template caps). A finite
        // saved value passes through as-is.
        currentPropellant: b.currentPropellant ?? 0,
        currentAmmoByWeapon: ammoRestored,
        currentLifeSupport: b.currentLifeSupport ?? 0,
        frameMods: b.frameMods ?? [],
        damageState,
      }),
      EntityKey({ key: b.entityKey }),
    )
    if (b.statSheet) {
      msEnt.add(MsStatSheet)
      msEnt.add(MsEffectsList)
      const effects = b.effects ?? []
      msEnt.set(MsEffectsList, { list: effects })
      const sheet = attachFormulas(MS_STAT_IDS, MS_STAT_FORMULAS, b.statSheet)
      const rebuilt = rebuildSheetFromEffects(sheet, effects)
      msEnt.set(MsStatSheet, { sheet: rebuilt })
      // Pre-6.2.5.C save: no resource fields persisted. Re-seed from
      // the MS template's caps; for ammo, project from the current
      // mountedWeapons map. ammoCapacity is a per-weapon template stat,
      // not a per-MS stat, so frame mod effects don't touch ammo caps.
      const cur = msEnt.get(Ms)!
      if (cur.currentPropellant === 0 && cur.currentLifeSupport === 0) {
        const cls = getMsClass(cur.templateId)
        msEnt.set(Ms, {
          ...cur,
          currentPropellant: cls.propellantStorage,
          currentLifeSupport: cls.lifeSupportMinutes,
          currentAmmoByWeapon: ammoCapsForMs(cls, cur.mountedWeapons),
        })
      }
    } else {
      attachMsStatSheet(msEnt)
    }
  }

  // Restore parts inventory.
  const partsKey = 'player-parts-inv'
  if (block.parts) {
    w.spawn(
      PlayerPartsInventory({
        weapons: { ...block.parts.weapons },
        frameMods: { ...(block.parts.frameMods ?? {}) },
      }),
      EntityKey({ key: partsKey }),
    )
  } else {
    // Pre-parts-inventory save — start with empty inventory.
    w.spawn(
      PlayerPartsInventory({ weapons: {}, frameMods: {} }),
      EntityKey({ key: partsKey }),
    )
  }

  refreshMsLayout()
  refreshAllDepotMsLayouts()
}

function resetMs(): void {
  const w = getWorld(SHIP_SCENE_ID)
  const doomed = []
  for (const ent of w.query(Ms)) doomed.push(ent)
  for (const ent of w.query(PlayerPartsInventory)) doomed.push(ent)
  for (const ent of doomed) ent.destroy()
  // W1 Task 5 — a fresh world owns no ship, so no starter MS is granted at
  // reset. It arrives with the player's first bought hull. Refresh clears
  // any stale MS sprites left over from the previous world.
  refreshMsLayout()
  refreshAllDepotMsLayouts()
}

registerSaveHandler({
  id: 'ms',
  phase: 'post',
  snapshot: snapshotMs,
  restore: restoreMs,
  reset: resetMs,
})
