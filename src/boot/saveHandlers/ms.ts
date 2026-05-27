// MS roster save handler — Phase 6.2.5.A.
//
// Snapshot/restore the Ms entity roster and PlayerPartsInventory in the
// playerShipInterior world. Pre-6.2.5.A saves (missing 'ms' block) auto-
// grant the starter MS on restore.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import { Ms, PlayerPartsInventory, EntityKey, MsStatSheet, MsEffectsList } from '../../ecs/traits'
import type { MsStatId } from '../../stats/msSchema'
import { MS_STAT_FORMULAS } from '../../stats/msSchema'
import { attachFormulas, serializeSheet, type SerializedSheet } from '../../stats/sheet'
import { rebuildSheetFromEffects, type Effect } from '../../stats/effects'
import { attachMsStatSheet } from '../../ecs/msEffects'
import { grantStarterMsToFlagship, refreshMsLayout } from '../../ecs/spawn'

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
  statSheet?: SerializedSheet<MsStatId>
  effects?: Effect<MsStatId>[]
}

interface PartsBlock {
  weapons: Record<string, number>
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
      statSheet: ssRaw ? serializeSheet(ssRaw) : undefined,
      effects: effects ? [...effects] : undefined,
    })
  }
  if (roster.length === 0) return undefined

  let partsBlock: PartsBlock | undefined
  for (const ent of w.query(PlayerPartsInventory)) {
    partsBlock = { weapons: { ...ent.get(PlayerPartsInventory)!.weapons } }
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

  if (!saved || typeof saved !== 'object') {
    grantStarterMsToFlagship()
    refreshMsLayout()
    return
  }

  const block = saved as MsRosterBlock
  if (!Array.isArray(block.roster) || block.roster.length === 0) {
    grantStarterMsToFlagship()
    refreshMsLayout()
    return
  }

  for (const b of block.roster) {
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
      }),
      EntityKey({ key: b.entityKey }),
    )
    if (b.statSheet) {
      msEnt.add(MsStatSheet)
      msEnt.add(MsEffectsList)
      const effects = b.effects ?? []
      msEnt.set(MsEffectsList, { list: effects })
      const sheet = attachFormulas(MS_STAT_FORMULAS, b.statSheet)
      const rebuilt = rebuildSheetFromEffects(sheet, effects)
      msEnt.set(MsStatSheet, { sheet: rebuilt })
    } else {
      attachMsStatSheet(msEnt)
    }
  }

  // Restore parts inventory.
  const partsKey = 'player-parts-inv'
  if (block.parts) {
    w.spawn(
      PlayerPartsInventory({ weapons: { ...block.parts.weapons } }),
      EntityKey({ key: partsKey }),
    )
  } else {
    // Pre-parts-inventory save — start with empty inventory.
    w.spawn(
      PlayerPartsInventory({ weapons: {} }),
      EntityKey({ key: partsKey }),
    )
  }

  refreshMsLayout()
}

function resetMs(): void {
  const w = getWorld(SHIP_SCENE_ID)
  const doomed = []
  for (const ent of w.query(Ms)) doomed.push(ent)
  for (const ent of w.query(PlayerPartsInventory)) doomed.push(ent)
  for (const ent of doomed) ent.destroy()
  grantStarterMsToFlagship()
  refreshMsLayout()
}

registerSaveHandler({
  key: 'ms',
  phase: 'post',
  snapshot: snapshotMs,
  restore: restoreMs,
  reset: resetMs,
})
