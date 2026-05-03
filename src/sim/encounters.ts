// Encounter engine — Slice F. Reads templates declared in src/data/encounters.ts
// (Slice C), evaluates blue-option qualifiers, runs choices, dispatches
// outcomes. Owns its own zustand store; does NOT touch src/ui/uiStore.ts.
//
// Pause-on-event: opening an encounter forces speed=0 (Design/encounters.md).
// Outcome dispatch is responsible for the post-modal clock state — by default
// we resume to speed 1; the `combat` outcome flips clock.mode to 'combat'
// instead, where Slice G's bridge overlay takes over.

import { create } from 'zustand'
import {
  getTemplate,
  type EncounterTemplate,
  type Choice,
  type Outcome,
  type Qualifier,
} from '../data/encounters'
import { useClock } from './clock'
import { world } from '../ecs/world'
import { IsPlayer, Money, Skills, Inventory, Reputation } from '../ecs/traits'
import { spendFuel, damageHull, getShipState } from './ship'
import { logEvent } from '../ui/EventLog'

export interface EncounterContext {
  // Where the encounter is happening — useful for routing combat to the right
  // enemy ship spawn template later. For 6.0 spine, just the node id.
  nodeId?: string
}

export interface EncounterRuntime {
  templateId: string
  template: EncounterTemplate
  ctx: EncounterContext
  // Choices that pass qualifier evaluation — what gets shown to the player.
  visibleChoices: Choice[]
}

interface EncounterState {
  current: EncounterRuntime | null
  trigger: (templateId: string, ctx?: EncounterContext) => void
  resolveChoice: (choiceId: string) => void
  close: () => void
}

// Trampoline used by `branch` outcomes; the store reads + clears it after
// running outcomes so a single choice resolution can swap the active template.
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

// Top-level helper for systems to dispatch from outside React.
export function triggerEncounter(templateId: string, ctx: EncounterContext = {}): void {
  useEncounter.getState().trigger(templateId, ctx)
}

function isChoiceVisible(c: Choice): boolean {
  if (c.unavailableInSpine) return false
  if (!c.qualifier) return true
  return evaluateQualifier(c.qualifier).met
}

export interface QualifierResult {
  met: boolean
  // Short zh-CN-ish hint shown as a badge on satisfied blue options.
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
    case 'system': {
      // Phase 6.0 spine — installed-systems lookup not yet wired. The
      // encounters that *need* this branch are flagged unavailableInSpine in
      // Slice C, so they never reach this code path. Returning false here is
      // the safe default for any qualifier that slips through (e.g. used as a
      // roll's `on` field, where a false met just falls through to the RNG
      // path). Slice 6.2 lifts the actual ShipSystemState lookup here.
      void getShipState()
      const minLevel = q.minLevel ?? 1
      return { met: false, label: `system ${q.systemId} ≥ ${minLevel}` }
    }
    case 'crewSpec':
      return { met: false, label: `crew: ${q.specId}` } // Phase 6.1 wires
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
      return { met: false } // origin trait not yet on entities
  }
}

function runChoiceOutcomes(choice: Choice, ctx: EncounterContext): void {
  if (choice.outcomes) {
    for (const o of choice.outcomes) applyOutcome(o, ctx)
    return
  }
  if (choice.roll) {
    const roll = choice.roll
    // Spine roll model: a satisfied qualifier auto-succeeds; otherwise a flat
    // 0-100 RNG roll vs. successThreshold. Phase 6.1 layers in skill-value-
    // modulated rolls so a partial qualifier (skill at 90% of the bar) still
    // helps.
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
      // ship.spendFuel deducts a positive amount; negative inputs add. delta
      // semantics on outcomes are signed (delta < 0 = loss) so we negate.
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
    case 'combat': {
      // Slice G: replace this stub with bridge-overlay activation +
      // EnemyShipState spawn keyed off `o.enemyShipId`. The `combat` mode
      // flip is what the loop reads to switch to slow-real-time pacing.
      logEvent('战斗触发 (Slice G 待接入)')
      useClock.getState().setMode('combat')
      return
    }
  }
}
