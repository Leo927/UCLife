// Conscription (Phase 7.0.C). Once wartime, a periodic draft roll may issue
// the player a draft notice — a stat-checked refusal roll they can dodge with
// Federation standing, Charisma, a clinic medical letter, and a cash bribe.
// An active mw_pilot / zeon_volunteer ambition biases the roll hard toward
// acceptance (those players want in). On the same cadence, combatant-eligible
// named NPCs churn out of the city. Conscription is the one way war forces
// itself on a player who never trained piloting or bought a ship
// (Design/combat.md § Settled commitments, item 5).
//
// Subscribes to day:rollover:settled (boot/conscriptionTick.ts), gated on
// isWartime(). The refusal-roll math is a pure function (refusalChance) so it
// unit-tests without a world; the roll itself and the NPC churn use the seeded
// sim RNG for determinism.
//
// Perf: O(eligible named NPCs + the single player) once per cadence interval
// on the daily tick. No per-frame scan. Target N: the named-NPC roster (tens).

import type { Entity } from 'koota'
import { IsPlayer, Character, Money, Ambitions } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { statValue } from './attributes'
import { getRep } from './reputation'
import { specialNpcs } from '../character/specialNpcs'
import { getSimRng } from '../sim/rng'
import { emitSim } from '../sim/events'
import { isWartime } from '../sim/warState'
import {
  hasDraftNotice, getLastRollDay, markRollDay, issueDraftNotice,
  resolveDraftNotice, hasMedicalLetter, getCooldownUntilDay,
} from '../sim/conscriptionState'
import { conscriptionConfig } from '../config'

const PRO_PILOT_AMBITIONS = new Set(['mw_pilot', 'zeon_volunteer'])

export interface RefusalInputs {
  federationRep: number
  charisma: number
  medicalLetter: boolean
  bribe: boolean
  proPilotAmbition: boolean
}

// Pure refusal-success probability (0–1), clamped to the configured bounds.
// Higher = more likely to dodge the draft.
export function refusalChance(inputs: RefusalInputs): number {
  const c = conscriptionConfig.refusal
  let p = c.base
  p += inputs.federationRep * c.federationRepWeight
  p += inputs.charisma * c.charismaWeight
  if (inputs.medicalLetter) p += c.medicalLetterBonus
  if (inputs.bribe) p += c.bribeBonus
  if (inputs.proPilotAmbition) p += c.proPilotAmbitionBias
  return Math.min(c.ceil, Math.max(c.floor, p))
}

function findPlayer(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

function hasProPilotAmbition(player: Entity): boolean {
  const amb = player.get(Ambitions)
  if (!amb) return false
  return amb.active.some((s) => PRO_PILOT_AMBITIONS.has(s.id))
}

// The refusal odds for the current player state, sans bribe (the UI offers the
// bribe as an additive choice). Exposed so the draft-notice panel can show the
// odds before the player decides.
export function currentRefusalChance(player: Entity, bribe: boolean): number {
  return refusalChance({
    federationRep: getRep(player, 'federation'),
    charisma: statValue(player, 'charisma'),
    medicalLetter: hasMedicalLetter(),
    bribe,
    proPilotAmbition: hasProPilotAmbition(player),
  })
}

// ── Draft roll (player notice + NPC churn) ───────────────────────────────────

export interface ConscriptionRollResult {
  noticeIssued: boolean
  draftedNpcs: string[]
}

// The roll itself, independent of cadence (so a debug force-tick can drive it
// without advancing many days). Issues a player notice when none is
// outstanding and the cooldown has elapsed, and churns named NPCs.
export function conscriptionRoll(gameDay: number, gameMs: number): ConscriptionRollResult {
  const draftedNpcs = churnNamedNpcsLogged(gameDay, gameMs)

  let noticeIssued = false
  const player = findPlayer()
  if (
    player
    && !hasDraftNotice()
    && gameDay >= getCooldownUntilDay()
    && getSimRng().next() < conscriptionConfig.noticeChance
  ) {
    issueDraftNotice(gameDay)
    noticeIssued = true
    const chance = currentRefusalChance(player, false)
    const money = player.get(Money)?.amount ?? 0
    emitSim('ui:draft-notice', {
      refusalChance: chance,
      bribeCost: conscriptionConfig.bribeCost,
      canBribe: money >= conscriptionConfig.bribeCost,
    })
    emitSim('log', { textZh: '一纸征召令送到你手上。', atMs: gameMs })
  }

  return { noticeIssued, draftedNpcs }
}

function churnNamedNpcsLogged(_gameDay: number, gameMs: number): string[] {
  const eligible = new Set(
    specialNpcs.filter((n) => n.combatantEligible).map((n) => n.name),
  )
  if (eligible.size === 0) return []
  const rng = getSimRng()
  const drafted: { entity: Entity; name: string }[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Character)) {
      if (e.has(IsPlayer)) continue
      const name = e.get(Character)!.name
      if (!eligible.has(name)) continue
      if (rng.next() < conscriptionConfig.npcDraftChance) drafted.push({ entity: e, name })
    }
  }
  for (const d of drafted) {
    d.entity.destroy()
    emitSim('log', { textZh: `征召令：${d.name} 被征往前线，离开了冯·布劳恩。`, atMs: gameMs })
  }
  return drafted.map((d) => d.name)
}

// Cadence-gated daily entry point (boot/conscriptionTick.ts).
export function conscriptionTick(gameDay: number, gameMs: number): void {
  if (!isWartime()) return
  if (gameDay - getLastRollDay() < conscriptionConfig.rollCadenceDays) return
  markRollDay(gameDay)
  conscriptionRoll(gameDay, gameMs)
}

// ── Resolution (player choice) ───────────────────────────────────────────────

export type DraftChoice = 'accept' | 'refuse' | 'bribe'

export interface DraftOutcome {
  outcome: 'civilian' | 'drafted'
  refusalChance: number
}

// Resolve the outstanding draft notice. 'accept' goes straight to the front;
// 'refuse' rolls the stat check; 'bribe' spends the bribe cost (if affordable)
// then rolls with the bribe bonus. Failure (or accept) fires the
// perspective-shift routing point. The medical letter is consumed on any roll.
export function resolveDraft(choice: DraftChoice, gameDay: number, gameMs: number): DraftOutcome {
  const player = findPlayer()
  const cooldownUntilDay = gameDay + conscriptionConfig.cooldownDays

  if (!player || !hasDraftNotice()) {
    return { outcome: 'civilian', refusalChance: 0 }
  }

  if (choice === 'accept') {
    resolveDraftNotice('drafted', cooldownUntilDay, false)
    emitSim('conscription:drafted', { gameDay })
    emitSim('log', { textZh: '你接受了征召。视角即将转向前线。', atMs: gameMs })
    return { outcome: 'drafted', refusalChance: 0 }
  }

  let bribe = false
  if (choice === 'bribe') {
    const money = player.get(Money)
    if (money && money.amount >= conscriptionConfig.bribeCost) {
      player.set(Money, { amount: money.amount - conscriptionConfig.bribeCost })
      bribe = true
      emitSim('log', { textZh: `你递出 ¥${conscriptionConfig.bribeCost} 打点关系。`, atMs: gameMs })
    }
  }

  const letterUsed = hasMedicalLetter()
  const chance = currentRefusalChance(player, bribe)
  const success = getSimRng().next() < chance

  if (success) {
    resolveDraftNotice('refused', cooldownUntilDay, letterUsed)
    emitSim('log', { textZh: '你躲过了这一次征召，暂时还是个平民。', atMs: gameMs })
    return { outcome: 'civilian', refusalChance: chance }
  }

  resolveDraftNotice('drafted', cooldownUntilDay, letterUsed)
  emitSim('conscription:drafted', { gameDay })
  emitSim('log', { textZh: '逃避失败。征召令生效,视角即将转向前线。', atMs: gameMs })
  return { outcome: 'drafted', refusalChance: chance }
}
