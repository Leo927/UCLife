import type { Entity } from 'koota'
import { getWorld, SCENE_IDS, getActiveSceneId, getSceneDimensions } from '../ecs/world'
import {
  IsPlayer, Position, Money, EntityKey, Attributes, Vitals, Health, Faction, Ship,
  EmployedAsCrew, Building, Owner, Character,
} from '../ecs/traits'
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

export interface CharacterView {
  getId(): string
  getResource(key: string): number
  getStat(statId: string): number
  getPosition(): { scene: string; x: number; y: number }
  getHiredRole(): string | null
  getAssignedShipId(): string | null
}

export interface ShipView {
  getId(): string
  getHullPct(): number
  getDockedAt(): string | null
  getCaptain(): CharacterView | null
  getCrew(): CharacterView[]
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

export interface GameStateView {
  getPlayerCharacter(): CharacterView
  getCharacter(id: string): CharacterView | null
  getShip(idOrName: string): ShipView | null
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
  }
}
