import json5 from 'json5'
import raw from './encounters.json5?raw'

// Encounter template library. See encounters.json5 header for the
// authoring contract; see Design/encounters.md for the form rationale.
//
// This module is pure data + types. It does NOT import from src/ecs,
// src/sim, src/systems, src/render, or starmap -- those are sibling
// slices that consume this catalog via the engine in Slice F.

// Qualifier — what gates a blue option from rendering. Engine code in
// Slice F resolves each qualifier against captain / ship / crew state
// and only emits the choice when satisfied.
export type Qualifier =
  | { kind: 'skill'; skillId: string; threshold: number }
  | { kind: 'system'; systemId: string; minLevel?: number }
  | { kind: 'crewSpec'; specId: string }
  | { kind: 'factionRep'; faction: string; threshold: number }
  | { kind: 'inventory'; itemId: string; minCount?: number }
  | { kind: 'origin'; originTrait: 'spacenoid' | 'earthnoid' }

// Outcome — what happens when a choice resolves (post-roll if a roll is
// present). `combat` and `branch` are control-flow outcomes; the rest
// mutate scalar state.
export type Outcome =
  | { kind: 'combat'; enemyShipId: string }
  | { kind: 'fiat'; delta: number }
  | { kind: 'fuel'; delta: number }
  | { kind: 'hull'; delta: number }
  | { kind: 'item'; itemId: string; delta: number }
  | { kind: 'log'; textZh: string }
  | { kind: 'branch'; nextTemplateId: string }
  | { kind: 'nothing' }

// Roll — optional gating between choice and outcome. `on` describes
// what's being rolled against (engine reads the value off captain/ship
// state). `successThreshold` is 0–100, compared to Math.random()*100.
export interface Roll {
  on: Qualifier
  successThreshold: number
  successOutcomes: Outcome[]
  failureOutcomes: Outcome[]
}

export interface Choice {
  id: string
  textZh: string
  qualifier?: Qualifier
  unavailableInSpine?: boolean
  roll?: Roll
  outcomes?: Outcome[]
}

export interface EncounterTemplate {
  id: string
  nodeTypes?: string[]
  textZh: string
  choices: Choice[]
}

interface EncounterFile {
  templates: EncounterTemplate[]
}

const parsed = json5.parse(raw) as EncounterFile

if (!Array.isArray(parsed.templates) || parsed.templates.length === 0) {
  throw new Error('encounters.json5 must declare at least one template')
}

const byId = new Map<string, EncounterTemplate>()
for (const t of parsed.templates) {
  if (byId.has(t.id)) {
    throw new Error(`encounters.json5: duplicate template id "${t.id}"`)
  }
  if (!Array.isArray(t.choices) || t.choices.length === 0) {
    throw new Error(`encounters.json5: template "${t.id}" must declare at least one choice`)
  }
  byId.set(t.id, t)
}

// Validate per-choice invariants and branch resolution.
for (const t of parsed.templates) {
  const seenChoiceIds = new Set<string>()
  for (const c of t.choices) {
    if (seenChoiceIds.has(c.id)) {
      throw new Error(
        `encounters.json5: template "${t.id}" has duplicate choice id "${c.id}"`,
      )
    }
    seenChoiceIds.add(c.id)

    const hasRoll = c.roll != null
    const hasOutcomes = Array.isArray(c.outcomes) && c.outcomes.length > 0
    if (hasRoll === hasOutcomes) {
      throw new Error(
        `encounters.json5: choice "${t.id}.${c.id}" must set exactly one of \`roll\` or \`outcomes\` (got roll=${hasRoll}, outcomes=${hasOutcomes})`,
      )
    }

    const branchTargets: Outcome[] = []
    if (c.outcomes) branchTargets.push(...c.outcomes)
    if (c.roll) {
      branchTargets.push(...c.roll.successOutcomes, ...c.roll.failureOutcomes)
    }
    for (const o of branchTargets) {
      if (o.kind === 'branch' && !byId.has(o.nextTemplateId)) {
        throw new Error(
          `encounters.json5: choice "${t.id}.${c.id}" branches to unknown template "${o.nextTemplateId}"`,
        )
      }
    }
  }
}

export const ENCOUNTERS: Record<string, EncounterTemplate> = Object.fromEntries(
  parsed.templates.map((t) => [t.id, t]),
)

export function getTemplate(id: string): EncounterTemplate {
  const t = byId.get(id)
  if (!t) throw new Error(`Unknown encounter template id: ${id}`)
  return t
}
