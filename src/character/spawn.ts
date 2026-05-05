// Player + NPC spawn helpers. Owns the trait set every character entity
// carries, plus appearance setup. Scene-bootstrap callers (founding
// civilians, AE workforce, special NPCs) live in src/ecs/spawn.ts and
// invoke spawnNPC / spawnPlayer from here.

import type { Entity, World } from 'koota'
import {
  Character, Position, MoveTarget, Vitals, Health, Action, Money, Skills,
  Inventory, Job, JobPerformance, Attributes, Reputation, JobTenure,
  Ambitions, Flags, IsPlayer, EntityKey, FactionRole, Appearance,
  type Gender,
} from '../ecs/traits'
import type { FactionId } from '../data/factions'
import type { SkillId } from './skills'
import { getAppearanceOverride } from './appearance'
import { generateAppearanceForName } from './appearanceGen'

const ZERO_SKILLS: Record<SkillId, number> = {
  mechanics: 0, marksmanship: 0, athletics: 0, cooking: 0, medicine: 0,
  computers: 0, piloting: 0, bartending: 0, engineering: 0,
}

export interface NPCSpec {
  name: string
  color: string
  title?: string
  x: number
  y: number
  fatigue?: number
  hunger?: number
  thirst?: number
  money?: number
  skills?: Partial<Record<SkillId, number>>
  key?: string
  factionRole?: { faction: FactionId; role: 'staff' | 'manager' | 'board' }
  gender?: Gender
}

export interface PlayerSpec {
  x: number
  y: number
  name?: string
  color?: string
  title?: string
  startingMoney?: number
  startingInventory?: { water?: number; meal?: number; books?: number }
}

export function setupAppearance(ent: Entity, name: string, gender?: Gender): void {
  const override = getAppearanceOverride(name)
  const genderForGen = gender ?? (override?.gender as Gender | undefined)
  const base = generateAppearanceForName(name, { gender: genderForGen })
  ent.add(Appearance({ ...base, ...override }))
}

export function spawnNPC(world: World, spec: NPCSpec): Entity {
  const fr = spec.factionRole ?? { faction: 'civilian' as FactionId, role: 'staff' as const }
  const ent = world.spawn(
    Character({ name: spec.name, color: spec.color, title: spec.title ?? '市民' }),
    Position({ x: spec.x, y: spec.y }),
    MoveTarget({ x: spec.x, y: spec.y }),
    Action,
    Vitals({
      hunger: spec.hunger ?? 0,
      thirst: spec.thirst ?? 0,
      fatigue: spec.fatigue ?? 0,
      hygiene: 0,
    }),
    Health,
    Money({ amount: spec.money ?? 50 }),
    Skills({ ...ZERO_SKILLS, ...spec.skills }),
    Inventory({ water: 2, meal: 2, books: 0 }),
    Job,
    JobPerformance,
    Attributes,
    FactionRole({ faction: fr.faction, role: fr.role }),
    EntityKey({ key: spec.key ?? `npc-anon-${Math.random().toString(36).slice(2, 8)}` }),
  )
  setupAppearance(ent, spec.name, spec.gender)
  return ent
}

export function spawnPlayer(world: World, spec: PlayerSpec): Entity {
  const name = spec.name ?? '新人'
  const inv = spec.startingInventory ?? {}
  const ent = world.spawn(
    IsPlayer,
    Character({ name, color: spec.color ?? '#4ade80', title: spec.title ?? '市民' }),
    Position({ x: spec.x, y: spec.y }),
    MoveTarget({ x: spec.x, y: spec.y }),
    Vitals,
    Health,
    Action,
    Money({ amount: spec.startingMoney ?? 30 }),
    Skills,
    Inventory({ water: inv.water ?? 1, meal: inv.meal ?? 1, books: inv.books ?? 0 }),
    Job,
    JobPerformance,
    Attributes,
    Reputation,
    JobTenure,
    Ambitions,
    Flags,
    EntityKey({ key: 'player' }),
  )
  setupAppearance(ent, name)
  return ent
}
