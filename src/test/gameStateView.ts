import type { Entity } from 'koota'
import { getWorld, SCENE_IDS, getActiveSceneId, getSceneDimensions } from '../ecs/world'
import {
  IsPlayer, Position, Money, EntityKey, Attributes, Vitals, Health, Faction, Ship,
  EmployedAsCrew, Building, Owner, Character, CouncilDissentMood, Knows, Psyche,
} from '../ecs/traits'
import { temperamentOf, sympathiesOf } from '../character/psychology'
import { getStat, type StatSheet } from '../stats/sheet'
import { useUI } from '../ui/uiStore'
import { factionsConfig, type FactionId } from '../config'
import {
  isPlayerColony, getColonyRecord, getColonyEconomics, getDetentionOccupants, getDetentionCapacity,
  getColonyThreatState,
  type WarehouseItem,
  type ColonyThreatState,
} from '../sim/colony'
import { computeAdminLoadStatus, type AdminLoadStatus } from '../systems/colonyAdmin'
import { getAllActivePolicies, getDissentRecord, type PolicyRecord, type DissentRecord } from '../sim/governance'
import {
  getAllDiplomaticRecords, getDiplomaticRecord, getAllMeetingRequests,
  type DiplomaticRecord, type MeetingRequest,
} from '../sim/diplomacy'
import { getFleetPool, getDockedPoiId as getFleetDockedPoiId } from '../sim/ship'
import { useEngagement } from '../sim/engagement'
import { IsPlayerFaction, FactionEffectsList, FactionSheet } from '../ecs/traits'
import { factionPerkStoreView, type FactionPerkRow } from '../systems/factionPerks'
import type { FactionStatId } from '../stats/factionSchema'

export interface CharacterView {
  getId(): string
  getResource(key: string): number
  getStat(statId: string): number
  getPosition(): { scene: string; x: number; y: number }
  getHiredRole(): string | null
  getAssignedShipId(): string | null
  // Issue #144 — this character's (eagerly-moved) opinion of the player;
  // null when no Knows edge exists yet.
  getOpinionOfPlayer(): number | null
  // Issue #144 — unacknowledged grievance/credit records on this
  // character's edge to the player, awaiting the next-talk reveal.
  getPendingAcks(): { grievances: number; credits: number }
  // Phase 5.3 — psychology: temperament, nonzero cause sympathies, and
  // which sympathies the player has learned (reveal order). Null when
  // the character carries no Psyche (the player, pre-5.3 entities).
  getPsyche(): {
    temperament: string | null
    sympathies: Record<string, number>
    revealed: string[]
    lastRevealDay: number
  } | null
}

export interface ShipView {
  getId(): string
  getHullPct(): number
  getDockedAt(): string | null
  getCaptain(): CharacterView | null
  getCrew(): CharacterView[]
}

// W1 Task 5 — the player's owned hulls. getShipCount() is 0 on a fresh
// boot now that the flagship is bought, not boot-granted.
// W1 Task 6 — getFuel()/getDockedPoiId() read the flagship's live fleet-
// pool fuel and the campaign-world dock binding, for smokes driving the
// starmap navigation/dock loop deterministically.
// W1 Task 7 — getFuel() returns both current and max so a budget smoke
// can assert fuel spent against tank capacity without a second call.
export interface FleetView {
  getShipCount(): number
  getFuel(): { current: number; max: number }
  getDockedPoiId(): string | null
}

// W1 Task 6 — space-engagement modal state (src/sim/engagement.ts),
// surfaced read-only for smokes that drive an intercept course to
// contact without clicking through the modal itself.
export interface EngagementView {
  isOpen(): boolean
  getEnemyKey(): string | null
}

export interface FactionView {
  getId(): string
  getResource(key: string): number
  ownsBuilding(buildingKey: string): boolean
}

export interface DialogueView {
  getWithNpcId(): string | null
  getActiveOptionKeys(): string[]
}

export interface SceneBuildingView {
  typeId: string
  key: string
}

export interface SceneView {
  getId(): string
  getDimensions(): { tilesX: number; tilesY: number }
  getBuildings(): SceneBuildingView[]
}

export interface ColonyOwnershipView {
  isPlayerOwned: boolean
  adminEntityKey: string | null
}

// Phase 6.3.B — colony economics view for smoke tests.
export interface ColonyEconomicsView {
  stabilityScore: number
  accumulatedIncome: number
  warehouseContents: WarehouseItem[]
  lastRolloverDay: number
}

// Phase 6.3.D — colony roles + detention view.
export interface ColonyRolesView {
  administratorKey: string
  leadEngineerKey: string
  garrisonCommanderKey: string
  detentionOccupants: string[]
  detentionCapacity: number
}

// Phase 6.3.E — colony threat state view for smoke tests.
export type { ColonyThreatState as ColonyThreatView }

// Phase 6.4.C — governance council state views.
export interface CouncilDissentView {
  moodDelta: number
  expiresDay: number
  policyKind: string
}

export interface GameStateView {
  getPlayerCharacter(): CharacterView
  getCharacter(id: string): CharacterView | null
  getShip(idOrName: string): ShipView | null
  // W1 Task 5 — the player's fleet (owned Ship entities). Used by the
  // no-ship-start smoke to prove a fresh boot owns nothing.
  getPlayerFleet(): FleetView
  // W1 Task 6 — read-only space-engagement modal state.
  getEngagement(): EngagementView
  getFaction(id: string): FactionView | null
  getDialogue(): DialogueView | null
  getScene(): SceneView
  // Phase 6.3.A — colony ownership query.
  // Returns null when the poiId is not a known claimable colony.
  // Returns { isPlayerOwned: false, adminEntityKey: null } while unowned.
  getColonyOwnership(poiId: string): ColonyOwnershipView
  // Phase 6.3.B — colony economics state query.
  // Returns null when the poiId is not a player-owned colony.
  getColonyEconomics(poiId: string): ColonyEconomicsView | null
  // Phase 6.3.D — admin-load status across all player colonies.
  getColonyAdminLoad(): AdminLoadStatus
  // Phase 6.3.D — officer roles + detention state for a colony.
  // Returns null when the poiId is not a player-owned colony.
  getColonyRoles(poiId: string): ColonyRolesView | null
  // Phase 6.3.E — threat state for a colony (raid cooldown + collapse grace).
  // Returns a fresh (zero) state when the colony is player-owned but has no
  // prior threat activity; returns null when the colony is not player-owned.
  getColonyThreatState(poiId: string): ColonyThreatState | null
  // Phase 6.4.C — all active faction policies.
  getFactionPolicies(): PolicyRecord[]
  // Phase 6.4.C — dissent state for an NPC (from registry).
  // Returns null when the NPC has no active dissent record.
  getCouncilDissentState(npcKey: string): DissentRecord | null
  // Phase 6.4.C — CouncilDissentMood from the live ECS entity.
  // Returns null when the NPC entity isn't loaded or has no trait.
  getCouncilDissentTrait(npcKey: string): CouncilDissentView | null
  // Phase 6.4.D — all signed diplomatic records (treaties per canon faction).
  getDiplomaticRecords(): DiplomaticRecord[]
  // Phase 6.4.D — the diplomatic record for one canon faction (null when none).
  getDiplomaticRecord(factionId: string): DiplomaticRecord | null
  // Phase 6.4.D — pending diplomat meeting requests.
  getDiplomacyMeetingRequests(): MeetingRequest[]
  // Phase 6.4.D — active FactionEffect ids on the player-faction (verifies
  // a signed trade treaty's effect landed). Empty when no player-faction.
  getPlayerFactionEffectIds(): string[]
  // Phase 6.4.E — faction-leader perk store rows (owned / locked / affordable),
  // mirroring the research visible-but-locked tier view.
  getFactionPerkStore(): FactionPerkRow[]
  // Phase 6.4.E — read a faction-wide stat off the player-faction sheet
  // (verifies a faction-leader perk's FactionEffect folded in). Returns the
  // schema default (1.0) when no player-faction or no sheet is present.
  getPlayerFactionStat(statId: string): number
}

const FACTION_IDS: ReadonlySet<string> = new Set(Object.keys(factionsConfig.catalog))

function findEntityByKey(key: string): { entity: Entity; sceneId: string } | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(EntityKey)) {
      if (e.get(EntityKey)!.key === key) return { entity: e, sceneId }
    }
  }
  return null
}

function findPlayerEntity(): { entity: Entity; sceneId: string } | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return { entity: p, sceneId }
  }
  return null
}

function characterResource(entity: Entity, key: string): number {
  if (key === 'Money') return entity.get(Money)?.amount ?? 0
  if (key === 'HP') return entity.get(Health)?.hp ?? 0
  const vitals = entity.get(Vitals)
  if (vitals) {
    if (key === 'hunger') return vitals.hunger
    if (key === 'thirst') return vitals.thirst
    if (key === 'fatigue') return vitals.fatigue
    if (key === 'hygiene') return vitals.hygiene
    if (key === 'boredom') return vitals.boredom
  }
  return 0
}

function characterStat(entity: Entity, statId: string): number {
  const a = entity.get(Attributes)
  if (!a) return 0
  return getStat(a.sheet as StatSheet<string>, statId as never)
}

function makeCharacterView(entity: Entity, sceneId: string): CharacterView {
  return {
    getId(): string {
      return entity.get(EntityKey)?.key ?? ''
    },
    getResource(key: string): number {
      return characterResource(entity, key)
    },
    getStat(statId: string): number {
      return characterStat(entity, statId)
    },
    getPosition(): { scene: string; x: number; y: number } {
      const p = entity.get(Position)
      return { scene: sceneId, x: p?.x ?? 0, y: p?.y ?? 0 }
    },
    getHiredRole(): string | null {
      const emp = entity.get(EmployedAsCrew)
      return emp ? emp.role : null
    },
    getAssignedShipId(): string | null {
      const emp = entity.get(EmployedAsCrew)
      return emp && emp.shipKey ? emp.shipKey : null
    },
    getOpinionOfPlayer(): number | null {
      const p = findPlayerEntity()
      if (!p || !entity.has(Knows(p.entity))) return null
      return entity.get(Knows(p.entity))!.opinion
    },
    getPendingAcks(): { grievances: number; credits: number } {
      const p = findPlayerEntity()
      if (!p || !entity.has(Knows(p.entity))) return { grievances: 0, credits: 0 }
      const e = entity.get(Knows(p.entity))!
      return { grievances: e.grievances.length, credits: e.credits.length }
    },
    getPsyche() {
      if (!entity.has(Psyche) || !entity.has(Attributes)) return null
      const p = entity.get(Psyche)!
      return {
        temperament: temperamentOf(entity),
        sympathies: sympathiesOf(entity.get(Attributes)!.sheet) as Record<string, number>,
        revealed: [...p.revealed],
        lastRevealDay: p.lastRevealDay,
      }
    },
  }
}

function findCharacterByKey(key: string): CharacterView | null {
  const hit = findEntityByKey(key)
  if (!hit) return null
  if (!hit.entity.has(Character) && !hit.entity.has(IsPlayer)) return null
  return makeCharacterView(hit.entity, hit.sceneId)
}

function findShipByKey(key: string): { entity: Entity; sceneId: string } | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Ship, EntityKey)) {
      if (e.get(EntityKey)!.key === key) return { entity: e, sceneId }
    }
  }
  return null
}

// Count the player's owned hulls across all scene worlds. Player ships
// carry Owner{ kind: 'character' }; enemy / neutral hulls do not.
function countPlayerShips(): number {
  let n = 0
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Ship, Owner)) {
      if (e.get(Owner)!.kind === 'character') n += 1
    }
  }
  return n
}

function makeShipView(entity: Entity): ShipView {
  return {
    getId(): string {
      return entity.get(EntityKey)?.key ?? ''
    },
    getHullPct(): number {
      const s = entity.get(Ship)!
      return s.hullMax > 0 ? s.hullCurrent / s.hullMax : 0
    },
    getDockedAt(): string | null {
      const s = entity.get(Ship)!
      return s.dockedAtPoiId !== '' ? s.dockedAtPoiId : null
    },
    getCaptain(): CharacterView | null {
      const s = entity.get(Ship)!
      if (!s.assignedCaptainId) return null
      return findCharacterByKey(s.assignedCaptainId)
    },
    getCrew(): CharacterView[] {
      const s = entity.get(Ship)!
      const out: CharacterView[] = []
      for (const id of s.crewIds) {
        const v = findCharacterByKey(id)
        if (v) out.push(v)
      }
      return out
    },
  }
}

function findFactionEntity(factionId: string): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Faction)) {
      if (e.get(Faction)!.id === factionId) return e
    }
  }
  return null
}

function makeFactionView(factionId: FactionId): FactionView {
  return {
    getId(): string {
      return factionId
    },
    getResource(key: string): number {
      if (key !== 'Money') return 0
      const e = findFactionEntity(factionId)
      return e ? e.get(Faction)!.fund : 0
    },
    ownsBuilding(buildingKey: string): boolean {
      const factionEnt = findFactionEntity(factionId)
      if (!factionEnt) return false
      for (const sceneId of SCENE_IDS) {
        const w = getWorld(sceneId)
        for (const b of w.query(Building, Owner, EntityKey)) {
          if (b.get(EntityKey)!.key !== buildingKey) continue
          const o = b.get(Owner)!
          return o.kind === 'faction' && o.entity === factionEnt
        }
      }
      return false
    },
  }
}

function makeDialogueView(npc: Entity): DialogueView {
  return {
    getWithNpcId(): string | null {
      return npc.get(EntityKey)?.key ?? null
    },
    getActiveOptionKeys(): string[] {
      throw new Error('not yet wired')
    },
  }
}

function makeSceneView(sceneId: string): SceneView {
  return {
    getId(): string {
      return sceneId
    },
    getDimensions(): { tilesX: number; tilesY: number } {
      return getSceneDimensions(sceneId)
    },
    getBuildings(): SceneBuildingView[] {
      const out: SceneBuildingView[] = []
      for (const e of getWorld(sceneId).query(Building)) {
        // Ship-interior rooms reuse the Building trait with an empty
        // typeId (see traits/world.ts) — not listable buildings.
        const typeId = e.get(Building)!.typeId
        if (typeId === '') continue
        out.push({ typeId, key: e.get(EntityKey)?.key ?? '' })
      }
      return out
    },
  }
}

export function getGameState(): GameStateView {
  return {
    getPlayerCharacter(): CharacterView {
      const hit = findPlayerEntity()
      if (!hit) throw new Error('getGameState().getPlayerCharacter(): no IsPlayer entity in any scene')
      return makeCharacterView(hit.entity, hit.sceneId)
    },
    getCharacter(id: string): CharacterView | null {
      return findCharacterByKey(id)
    },
    getShip(idOrName: string): ShipView | null {
      const hit = findShipByKey(idOrName)
      if (!hit) return null
      return makeShipView(hit.entity)
    },
    getPlayerFleet(): FleetView {
      return {
        getShipCount: countPlayerShips,
        getFuel: () => {
          const pool = getFleetPool()
          return { current: pool.fuelCurrent, max: pool.fuelMax }
        },
        getDockedPoiId: getFleetDockedPoiId,
      }
    },
    getEngagement(): EngagementView {
      return {
        isOpen: () => useEngagement.getState().open,
        getEnemyKey: () => useEngagement.getState().enemyKey,
      }
    },
    getFaction(id: string): FactionView | null {
      if (!FACTION_IDS.has(id)) return null
      return makeFactionView(id as FactionId)
    },
    getDialogue(): DialogueView | null {
      const npc = useUI.getState().dialogNPC
      if (!npc) return null
      return makeDialogueView(npc)
    },
    getScene(): SceneView {
      return makeSceneView(getActiveSceneId())
    },
    getColonyOwnership(poiId: string): ColonyOwnershipView {
      if (isPlayerColony(poiId)) {
        const rec = getColonyRecord(poiId)
        return { isPlayerOwned: true, adminEntityKey: rec?.adminEntityKey ?? null }
      }
      return { isPlayerOwned: false, adminEntityKey: null }
    },
    getColonyEconomics(poiId: string): ColonyEconomicsView | null {
      if (!isPlayerColony(poiId)) return null
      const econ = getColonyEconomics(poiId)
      if (!econ) return null
      return {
        stabilityScore: econ.stabilityScore,
        accumulatedIncome: econ.accumulatedIncome,
        warehouseContents: econ.warehouseContents,
        lastRolloverDay: econ.lastRolloverDay,
      }
    },
    getColonyAdminLoad(): AdminLoadStatus {
      return computeAdminLoadStatus()
    },
    getColonyRoles(poiId: string): ColonyRolesView | null {
      if (!isPlayerColony(poiId)) return null
      const rec = getColonyRecord(poiId)
      if (!rec) return null
      return {
        administratorKey: rec.administratorKey,
        leadEngineerKey: rec.leadEngineerKey,
        garrisonCommanderKey: rec.garrisonCommanderKey,
        detentionOccupants: getDetentionOccupants(poiId),
        detentionCapacity: getDetentionCapacity(),
      }
    },
    getColonyThreatState(poiId: string): ColonyThreatState | null {
      if (!isPlayerColony(poiId)) return null
      return getColonyThreatState(poiId)
    },
    getFactionPolicies(): PolicyRecord[] {
      return getAllActivePolicies()
    },
    getCouncilDissentState(npcKey: string): DissentRecord | null {
      return getDissentRecord(npcKey)
    },
    getCouncilDissentTrait(npcKey: string): CouncilDissentView | null {
      for (const sceneId of SCENE_IDS) {
        const w = getWorld(sceneId)
        for (const e of w.query(EntityKey, CouncilDissentMood)) {
          if (e.get(EntityKey)!.key === npcKey) {
            const d = e.get(CouncilDissentMood)!
            return { moodDelta: d.moodDelta, expiresDay: d.expiresDay, policyKind: d.policyKind }
          }
        }
      }
      return null
    },
    getDiplomaticRecords(): DiplomaticRecord[] {
      return getAllDiplomaticRecords()
    },
    getDiplomaticRecord(factionId: string): DiplomaticRecord | null {
      return getDiplomaticRecord(factionId as FactionId)
    },
    getDiplomacyMeetingRequests(): MeetingRequest[] {
      return getAllMeetingRequests()
    },
    getPlayerFactionEffectIds(): string[] {
      for (const sceneId of SCENE_IDS) {
        const w = getWorld(sceneId)
        for (const e of w.query(FactionEffectsList)) {
          if (e.has(IsPlayerFaction)) return e.get(FactionEffectsList)!.list.map((eff) => eff.id)
        }
      }
      return []
    },
    getFactionPerkStore(): FactionPerkRow[] {
      return factionPerkStoreView()
    },
    getPlayerFactionStat(statId: string): number {
      const e = findFactionEntity('player')
      const fs = e?.get(FactionSheet)
      if (!fs) return 1.0
      return getStat(fs.sheet, statId as FactionStatId)
    },
  }
}
