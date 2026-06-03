// Phase 6.4.A faction-tier gate. Runs once per game-day on
// day:rollover:settled — O(1) over the single player-faction entity.
//
// Gate: minColonies AND minShips AND minCanonRepSum must all be met on
// the same day:rollover. Once flipped the gate is one-way for this
// slice — demotion machinery lands in Phase 7+.
//
// On flip: adds the 'faction-tier' unlock to the player-faction entity
// and seeds FactionInterRep from the player's accumulated personal
// canon-faction standing, capped at the regional-power ceiling.

import type { Entity } from 'koota'
import { IsPlayer, Reputation, Faction, FactionInterRep, Ship } from '../ecs/traits'
import { addFactionUnlock, hasFactionUnlock } from '../ecs/factionEffects'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getAllColonyRecords } from '../sim/colony'
import { factionsConfig } from '../config'
import type { FactionId } from '../data/factions'

export const FACTION_TIER_UNLOCK_ID = 'faction-tier'

const CANON_FACTION_IDS: readonly FactionId[] = ['anaheim', 'federation', 'zeon', 'pirate']

function findPlayerFactionAcrossScenes(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Faction)) {
      if (e.get(Faction)!.id === 'player') return e
    }
  }
  return null
}

function countActiveShips(): number {
  const w = getWorld('playerShipInterior')
  let count = 0
  for (const e of w.query(Ship)) {
    if (!e.get(Ship)!.mothballed) count++
  }
  return count
}

function sumPlayerCanonRep(): number {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    const rep = p.get(Reputation)
    if (!rep) return 0
    let total = 0
    for (const id of CANON_FACTION_IDS) total += rep.rep[id] ?? 0
    return total
  }
  return 0
}

function getPlayerCanonRepMap(): Partial<Record<FactionId, number>> {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    return p.get(Reputation)?.rep ?? {}
  }
  return {}
}

function seedInterRep(playerFactionEnt: Entity): void {
  const ceiling = factionsConfig.factionTierGate.regionalPowerCeiling
  const playerRep = getPlayerCanonRepMap()
  const cur = playerFactionEnt.get(FactionInterRep)
  if (!cur) return
  const next: Partial<Record<FactionId, number>> = { ...cur.rep }
  for (const id of CANON_FACTION_IDS) {
    if (next[id] !== undefined) continue
    const personal = playerRep[id] ?? 0
    next[id] = Math.min(personal, ceiling)
  }
  playerFactionEnt.set(FactionInterRep, { rep: next })
}

export function factionTierSystem(_gameDay: number): void {
  const gate = factionsConfig.factionTierGate

  const playerFactionEnt = findPlayerFactionAcrossScenes()
  if (!playerFactionEnt) return

  if (hasFactionUnlock(playerFactionEnt, FACTION_TIER_UNLOCK_ID)) return

  if (getAllColonyRecords().length < gate.minColonies) return
  if (countActiveShips() < gate.minShips) return
  if (sumPlayerCanonRep() < gate.minCanonRepSum) return

  addFactionUnlock(playerFactionEnt, FACTION_TIER_UNLOCK_ID)
  seedInterRep(playerFactionEnt)
}
