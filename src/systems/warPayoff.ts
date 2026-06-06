// warPayoff resolution (Phase 7.0.D). The prologue payoff: when the war fires
// (UC 0079.01.03), every active ambition's long-inert `warPayoff` route
// resolves — the years-old promise the design names as Phase 7's reason for
// being. Subscribes to the 7.0.B `war:transition` event (wired in
// boot/warPayoffBinding.ts).
//
// Reuses the ambition-resolution path (Design/social/ambitions.md): each
// route credits a log line, unlock flags, and AP; the MOST-PROGRESSED active
// ambition additionally claims the title spotlight (the headline payoff),
// while concurrently-active lesser ambitions resolve without it.
//
// One-shot, idempotent: the warState `warPayoffResolved` latch guards against
// re-firing. Perks are preserved verbatim — the transition must not strip the
// faction-leader / personal perks the player earned pre-war.
//
// Perf: O(active ambitions on the single player) on the one transition tick.
// No per-frame scan. The wartime-ambition tier itself unlocks off isWartime()
// in availableAmbitions(); this system only resolves the routes + latches.

import type { Entity } from 'koota'
import { IsPlayer, Ambitions, Flags, Character, type AmbitionSlot } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getAmbition, getWarPayoffRoute } from '../character/ambitions'
import { markWarPayoffResolved } from '../sim/warState'
import { emitSim } from '../sim/events'

export interface WarPayoffResult {
  // warPayoff route ids resolved this call (empty if already latched or no
  // active ambitions).
  resolved: string[]
  // The ambition id that claimed the title spotlight, or null.
  headlineAmbitionId: string | null
}

// One resolved route, ready to apply to the player.
export interface WarPayoffEntry {
  ambitionId: string
  routeId: string
  logZh: string
  unlocks: string[]
  ap: number
  // True for the single most-progressed ambition — it claims the title.
  isHeadline: boolean
}

export interface WarPayoffPlan {
  entries: WarPayoffEntry[]
  headlineAmbitionId: string | null
  // The title the headline ambition's route overrides Character.title with.
  titleZh: string | null
  totalAp: number
}

// Pure resolution core: given the active ambition slots, decide which routes
// fire, which one is the headline (most-progressed = highest current stage,
// ties → first), and the AP total. Reads only the module-global catalog, so
// it unit-tests without a world.
export function planWarPayoff(active: readonly AmbitionSlot[]): WarPayoffPlan {
  if (active.length === 0) {
    return { entries: [], headlineAmbitionId: null, titleZh: null, totalAp: 0 }
  }

  let headlineIdx = 0
  for (let i = 1; i < active.length; i++) {
    if (active[i].currentStage > active[headlineIdx].currentStage) headlineIdx = i
  }

  const entries: WarPayoffEntry[] = []
  let totalAp = 0
  let headlineAmbitionId: string | null = null
  let titleZh: string | null = null

  for (let i = 0; i < active.length; i++) {
    const def = getAmbition(active[i].id)
    if (!def) continue
    const route = getWarPayoffRoute(def.warPayoff)
    if (!route) continue
    const ap = route.ap ?? 0
    const isHeadline = i === headlineIdx
    entries.push({
      ambitionId: def.id,
      routeId: def.warPayoff,
      logZh: route.logZh,
      unlocks: route.unlocks ? [...route.unlocks] : [],
      ap,
      isHeadline,
    })
    totalAp += ap
    if (isHeadline) {
      headlineAmbitionId = def.id
      titleZh = route.titleZh
    }
  }

  return { entries, headlineAmbitionId, titleZh, totalAp }
}

function findPlayerWithAmbitions(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer, Ambitions)
    if (p) return p
  }
  return null
}

export function warPayoffSystem(gameDate: Date): WarPayoffResult {
  // One-shot latch — also covers the wartime-tier unlock (which derives from
  // isWartime()), so even a player with no active ambitions latches cleanly.
  if (!markWarPayoffResolved()) return { resolved: [], headlineAmbitionId: null }

  const player = findPlayerWithAmbitions()
  if (!player) return { resolved: [], headlineAmbitionId: null }

  const amb = player.get(Ambitions)!
  const plan = planWarPayoff(amb.active)
  if (plan.entries.length === 0) return { resolved: [], headlineAmbitionId: null }

  const currentMs = gameDate.getTime()
  const flagsTrait = player.get(Flags)
  const nextFlags = flagsTrait ? { ...flagsTrait.flags } : null

  for (const e of plan.entries) {
    emitSim('log', { textZh: e.logZh, atMs: currentMs })
    if (nextFlags) for (const f of e.unlocks) nextFlags[f] = true
  }

  if (nextFlags && flagsTrait) player.set(Flags, { flags: nextFlags })
  // Preserve active / history / perks; only AP changes. Perks staying intact
  // is the "perks survive the flip" guarantee.
  player.set(Ambitions, {
    active: amb.active,
    history: amb.history,
    apBalance: amb.apBalance + plan.totalAp,
    apEarned: amb.apEarned + plan.totalAp,
    perks: amb.perks,
  })
  if (plan.titleZh !== null) {
    const ch = player.get(Character)
    if (ch) player.set(Character, { ...ch, title: plan.titleZh })
  }

  return { resolved: plan.entries.map((e) => e.routeId), headlineAmbitionId: plan.headlineAmbitionId }
}
