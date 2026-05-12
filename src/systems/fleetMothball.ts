// Phase 6.2.G — mothball verb side-effect bundle. The roster panel and
// the debug handles both call into `setShipMothballed` so the rules live
// in one place:
//
//   • Flagship cannot be mothballed. The player ship is always operational.
//   • A ship in cross-POI transit cannot be mothballed (it has no hangar
//     to be mothballed in).
//   • Mothballing removes the IsInActiveFleet marker, clears formationSlot,
//     and removes the captain Effect from the ship's StatSheet. The
//     `assignedCaptainId` field is left intact so un-mothballing restores
//     the captain's bonus without forcing the player to rehire.
//   • Un-mothballing restores the captain Effect (if a captain is still
//     assigned). Does NOT auto-add IsInActiveFleet — promoting back into
//     the active fleet is a war-room decision.
//
// Drain skipping happens in fleetSupplyDrain (already gated on
// Ship.mothballed) and fleetCrew.fleetCrewSalarySystem (same). The
// hire-as-captain / hire-as-crew branches filter mothballed ships out
// of their pickers via Ship.mothballed check (see those files).

import type { Entity } from 'koota'
import { Ship, IsFlagshipMark, IsInActiveFleet } from '../ecs/traits'
import {
  captainEffectId, findNpcByKey, findShipByKey,
} from './fleetCrew'
import { addShipEffect, removeShipEffect } from '../ecs/shipEffects'
import { fleetConfig } from '../config'
import { ShipStatSheet, type ShipStatId } from '../ecs/traits'
import { EntityKey, Character } from '../ecs/traits'
import { getSkillXp, levelOf, type SkillId } from '../character/skills'

export type MothballFailReason =
  | 'ship_not_found'
  | 'flagship_locked'
  | 'in_transit'
  | 'already_in_state'

export type MothballResult =
  | { ok: true; shipKey: string; mothballed: boolean }
  | { ok: false; reason: MothballFailReason }

export function setShipMothballed(
  shipEnt: Entity,
  mothballed: boolean,
): MothballResult {
  const s = shipEnt.get(Ship)
  if (!s) return { ok: false, reason: 'ship_not_found' }
  if (shipEnt.has(IsFlagshipMark)) return { ok: false, reason: 'flagship_locked' }
  if (s.transitDestinationId) return { ok: false, reason: 'in_transit' }
  if (s.mothballed === mothballed) return { ok: false, reason: 'already_in_state' }

  const shipKey = shipEnt.get(EntityKey)?.key ?? ''

  if (mothballed) {
    if (shipEnt.has(IsInActiveFleet)) shipEnt.remove(IsInActiveFleet)
    shipEnt.set(Ship, { ...s, mothballed: true, formationSlot: -1 })
    if (s.assignedCaptainId) {
      removeShipEffect(shipEnt, captainEffectId(s.assignedCaptainId))
    }
    return { ok: true, shipKey, mothballed: true }
  }

  shipEnt.set(Ship, { ...s, mothballed: false })
  if (s.assignedCaptainId) {
    reapplyCaptainEffectFor(shipEnt, s.assignedCaptainId)
  }
  return { ok: true, shipKey, mothballed: false }
}

export function setShipMothballedByKey(
  shipKey: string,
  mothballed: boolean,
): MothballResult {
  const ent = findShipByKey(shipKey)
  if (!ent) return { ok: false, reason: 'ship_not_found' }
  return setShipMothballed(ent, mothballed)
}

function reapplyCaptainEffectFor(shipEnt: Entity, captainKey: string): void {
  if (!shipEnt.has(ShipStatSheet)) return
  const hit = findNpcByKey(captainKey)
  if (!hit) return
  const skill = fleetConfig.captainEffectSkill as SkillId
  const lv = levelOf(getSkillXp(hit.entity, skill))
  const value = lv * fleetConfig.captainEffectPerLevel
  addShipEffect(shipEnt, {
    id: captainEffectId(captainKey),
    originId: captainKey,
    family: 'gear',
    modifiers: [
      {
        statId: fleetConfig.captainEffectStat as ShipStatId,
        type: 'percentMult',
        value,
      },
    ],
  })
  void Character
}
