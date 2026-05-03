// Encounter engine. Reads templates declared in src/data/encounters.ts,
// evaluates blue-option qualifiers, runs choices, dispatches outcomes.
// Owns its own zustand store.
//
// Pause-on-event: opening an encounter forces speed=0 (Design/encounters.md).
// Outcome dispatch is responsible for the post-modal clock state — by default
// we resume to speed 1; the `combat` outcome flips clock.mode to 'combat'
// so the Starsector tactical view takes over.

import { create } from 'zustand'
import {
  ENCOUNTERS,
  getTemplate,
  type EncounterTemplate,
  type Choice,
  type Outcome,
  type Qualifier,
} from '../data/encounters'
import { getPoi, getRegion } from '../data/starmap'
import { useClock } from './clock'
import { world } from '../ecs/world'
import { IsPlayer, Money, Skills, Inventory, Reputation } from '../ecs/traits'
import { spendFuel, damageHull } from './ship'
import { logEvent } from '../ui/EventLog'
import { startCombat } from '../systems/combat'

export interface EncounterContext {
  poiId?: string
}

export interface EncounterRuntime {
  templateId: string
  template: EncounterTemplate
  ctx: EncounterContext
  visibleChoices: Choice[]
}

interface EncounterState {
  current: EncounterRuntime | null
  trigger: (templateId: string, ctx?: EncounterContext) => void
  resolveChoice: (choiceId: string) => void
  close: () => void
}

let lastBranchedTemplate: string | null = null

export const useEncounter = create<EncounterState>((set, get) => ({
  current: null,
  trigger: (templateId, ctx = {}) => {
    const tpl = getTemplate(templateId)
    if (!tpl) return
    const visibleChoices = tpl.choices.filter(isChoiceVisible)
    set({ current: { templateId, template: tpl, ctx, visibleChoices } })
    useClock.getState().setSpeed(0)
  },
  resolveChoice: (choiceId) => {
    const cur = get().current
    if (!cur) return
    const choice = cur.template.choices.find((c) => c.id === choiceId)
    if (!choice) return
    runChoiceOutcomes(choice, cur.ctx)

    const branched = lastBranchedTemplate
    lastBranchedTemplate = null
    if (branched) {
      const tpl = getTemplate(branched)
      set({
        current: {
          templateId: branched,
          template: tpl,
          ctx: cur.ctx,
          visibleChoices: tpl.choices.filter(isChoiceVisible),
        },
      })
      return
    }

    set({ current: null })
    const c = useClock.getState()
    if (c.mode !== 'combat' && c.speed === 0) c.setSpeed(1)
  },
  close: () => {
    set({ current: null })
    const c = useClock.getState()
    if (c.mode !== 'combat' && c.speed === 0) c.setSpeed(1)
  },
}))

export function triggerEncounter(templateId: string, ctx: EncounterContext = {}): void {
  useEncounter.getState().trigger(templateId, ctx)
}

// Phase 6.0 spine: resolves a POI arrival into an encounter template
// rolled against the POI's region pool. POIs with `encounterPoolId`
// override the region roll (e.g. derelict-flagged POIs always pull
// from the derelict pool). Dockable POIs (sceneId set) skip the
// encounter layer entirely — the player walks into the city scene.
export function triggerEncounterAtPoi(poiId: string): void {
  const poi = getPoi(poiId)
  if (!poi) return
  if (poi.sceneId) return  // Dockable POI — walk in instead.

  // POI-specific override (`encounterPoolId`) — Phase 6.1+ wires the
  // forward-looking pool ids to real templates. Spine treats it as a
  // direct templateId, with the `_pool` suffix optionally stripped.
  if (poi.encounterPoolId) {
    const direct = resolvePoolToTemplate(poi.encounterPoolId)
    if (direct) {
      triggerEncounter(direct, { poiId })
      return
    }
  }

  const region = getRegion(poi.region)
  if (!region) return
  const eligible = region.encounterPool.filter((e) =>
    (!e.conditions?.warPhase || e.conditions.warPhase === 'pre')
    && ENCOUNTERS[e.templateId] != null,
  )
  if (eligible.length === 0) return
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0)
  if (totalWeight <= 0) return
  let r = Math.random() * totalWeight
  for (const e of eligible) {
    r -= e.weight
    if (r <= 0) {
      triggerEncounter(e.templateId, { poiId })
      return
    }
  }
}

function resolvePoolToTemplate(poolId: string): string | null {
  if (ENCOUNTERS[poolId]) return poolId
  if (poolId.endsWith('_pool')) {
    const stripped = poolId.slice(0, -'_pool'.length)
    if (ENCOUNTERS[stripped]) return stripped
  }
  return null
}

function isChoiceVisible(c: Choice): boolean {
  if (c.unavailableInSpine) return false
  if (!c.qualifier) return true
  return evaluateQualifier(c.qualifier).met
}

export interface QualifierResult {
  met: boolean
  label?: string
}

export function evaluateQualifier(q: Qualifier): QualifierResult {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { met: false }
  switch (q.kind) {
    case 'skill': {
      const s = player.get(Skills) as Record<string, number> | undefined
      if (!s) return { met: false }
      const v = s[q.skillId] ?? 0
      return { met: v >= q.threshold, label: `${q.skillId} ≥ ${q.threshold}` }
    }
    case 'system':
      // FTL-era ship-system qualifier. Phase 6.0 Starsector pivot drops
      // ship "systems" as installed levels — the equivalents are now
      // outfitting / hardpoint loadout (Phase 6.2). Returning false here
      // is the safe default for any qualifier still authored against the
      // old schema; encounters.json5 flags these as unavailableInSpine.
      return { met: false, label: `system ${q.systemId}` }
    case 'crewSpec':
      return { met: false, label: `crew: ${q.specId}` }
    case 'factionRep': {
      const r = player.get(Reputation)
      if (!r) return { met: false }
      const v = (r.rep[q.faction as never] as number | undefined) ?? 0
      return { met: v >= q.threshold, label: `${q.faction} ≥ ${q.threshold}` }
    }
    case 'inventory': {
      const inv = player.get(Inventory) as Record<string, number> | undefined
      if (!inv) return { met: false }
      const v = inv[q.itemId] ?? 0
      return { met: v >= (q.minCount ?? 1), label: `${q.itemId}` }
    }
    case 'origin':
      return { met: false }
  }
}

function runChoiceOutcomes(choice: Choice, ctx: EncounterContext): void {
  if (choice.outcomes) {
    for (const o of choice.outcomes) applyOutcome(o, ctx)
    return
  }
  if (choice.roll) {
    const roll = choice.roll
    const q = evaluateQualifier(roll.on)
    const success = q.met || Math.random() * 100 < roll.successThreshold
    const outcomes = success ? roll.successOutcomes : roll.failureOutcomes
    for (const o of outcomes) applyOutcome(o, ctx)
  }
}

function applyOutcome(o: Outcome, _ctx: EncounterContext): void {
  const player = world.queryFirst(IsPlayer)
  switch (o.kind) {
    case 'fiat': {
      if (!player) return
      const m = player.get(Money) ?? { amount: 0 }
      player.set(Money, { amount: m.amount + o.delta })
      logEvent(o.delta >= 0 ? `获得 ¥${o.delta}` : `支出 ¥${-o.delta}`)
      return
    }
    case 'fuel':
      spendFuel(-o.delta)
      return
    case 'hull':
      damageHull(-o.delta)
      return
    case 'item': {
      if (!player) return
      const inv = player.get(Inventory) as Record<string, number> | undefined
      if (!inv) return
      const next = { ...inv, [o.itemId]: (inv[o.itemId] ?? 0) + o.delta }
      player.set(Inventory, next as never)
      return
    }
    case 'log':
      logEvent(o.textZh)
      return
    case 'branch':
      lastBranchedTemplate = o.nextTemplateId
      return
    case 'nothing':
      return
    case 'combat':
      startCombat(o.enemyShipId)
      return
  }
}
