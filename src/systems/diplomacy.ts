// Phase 6.4.D — diplomacy system.
//
// Formal relations with canon factions (nonaggression, trade, mutual
// defense), convened as council scenes alongside governance (6.4.C). The
// player proposes a treaty with a named canon faction, the colony's officers
// argue from their personas (reusing the shared council surface), and the
// player signs or declines. A signed trade pact emits a low-magnitude
// FactionEffect; every treaty carries an INERT post-war escalation
// descriptor that Phase 7 will read.
//
// The meeting-request check runs on day:rollover — O(canon factions), a
// fixed handful, once per game-day. Councils are player-triggered
// (on-demand). No per-frame scan; sub-budget on the daily tick.

import { EntityKey, Character, FactionInterRep } from '../ecs/traits'
import { addFactionEffect } from '../ecs/factionEffects'
import { getAllColonyRecords } from '../sim/colony'
import { factionsConfig } from '../config'
import type { FactionId, TreatyType } from '../config'
import { factionMeta } from '../data/factions'
import type { FactionStatId } from '../stats/factionSchema'
import type { Effect } from '../stats/effects'
import { emitSim } from '../sim/events'
import {
  addTreaty, getMeetingRequest, addMeetingRequest, clearMeetingRequest,
} from '../sim/diplomacy'
import {
  type CouncilStance, findPlayer, findPlayerFaction, gatherAttendees, councilScore,
} from './council'

// Canon factions the player can sign treaties with / receive meetings from.
// The player-faction's own 'player' / 'civilian' ids are excluded.
const CANON_FACTION_IDS: readonly FactionId[] = ['anaheim', 'federation', 'zeon', 'pirate']

export interface DiplomacyAttendeeView {
  npcKey: string
  nameZh: string
  roleZh: string
  stance: CouncilStance
  argumentZh: string
}

export interface DiplomacyCouncilSession {
  poiId: string
  factionId: FactionId
  treatyType: TreatyType
  attendees: DiplomacyAttendeeView[]
}

function treatyEffectId(treatyType: TreatyType, factionId: FactionId): string {
  return `treaty:${treatyType}:${factionId}`
}

// Map a raw council lean into a signing stance. Signing a treaty is the
// "aggressive" action, so a higher score supports it.
function signingStance(score: number): CouncilStance {
  const { stanceMidpoint, stanceNeutralBand } = factionsConfig.diplomacy
  if (Math.abs(score - stanceMidpoint) < stanceNeutralBand) return 'neutral'
  return score > stanceMidpoint ? 'support' : 'oppose'
}

const SUPPORT_ARGS: Record<TreatyType, string> = {
  nonaggression: '签下这份和约能让我们专心经营，省去边境摩擦。',
  trade: '这份贸易协定会带来稳定的物资与收益，值得签署。',
  mutualDefense: '有了共同防御条约，我们的殖民地会安全得多。',
}
const OPPOSE_ARGS: Record<TreatyType, string> = {
  nonaggression: '与他们结约会束缚我们的手脚，我反对。',
  trade: '这份协定让我们过度依赖对方，时机不对。',
  mutualDefense: '共同防御意味着卷入他们的战争，风险太大。',
}
const NEUTRAL_ARGS: Record<TreatyType, string> = {
  nonaggression: '签或不签都各有利弊，听从指挥官决断。',
  trade: '贸易条款尚可，是否签署由您定夺。',
  mutualDefense: '此事干系重大，我无明确倾向。',
}

// Convene a diplomacy council: gather the colony's officers and compute each
// one's stance on signing the proposed treaty. Returns null when the poiId
// is not a player colony or no officers are assigned.
export function conveneDiplomacyCouncil(
  poiId: string,
  factionId: FactionId,
  treatyType: TreatyType,
): DiplomacyCouncilSession | null {
  if (!getAllColonyRecords().some((r) => r.poiId === poiId)) return null
  if (!CANON_FACTION_IDS.includes(factionId)) return null
  const rawAttendees = gatherAttendees(poiId)
  if (rawAttendees.length === 0) return null
  const player = findPlayer()
  const attendees: DiplomacyAttendeeView[] = rawAttendees.map(({ entity, roleZh }) => {
    const score = councilScore(entity, player, factionsConfig.diplomacy.stanceWeights)
    const stance = signingStance(score)
    const nameZh = entity.get(Character)?.name ?? entity.get(EntityKey)?.key ?? '?'
    const argumentZh =
      stance === 'support' ? SUPPORT_ARGS[treatyType]
        : stance === 'oppose' ? OPPOSE_ARGS[treatyType]
          : NEUTRAL_ARGS[treatyType]
    return { npcKey: entity.get(EntityKey)?.key ?? '', nameZh, roleZh, stance, argumentZh }
  })
  return { poiId, factionId, treatyType, attendees }
}

// Sign the proposed treaty: record the diplomatic state, emit the treaty's
// FactionEffect (if any), and clear any pending meeting request from that
// faction. Returns false when no player-faction exists.
export function signTreaty(session: DiplomacyCouncilSession, gameDay: number): boolean {
  const pf = findPlayerFaction()
  if (!pf) return false
  const spec = factionsConfig.diplomacy.treaties[session.treatyType]

  addTreaty(session.factionId, {
    type: session.treatyType,
    signedDay: gameDay,
    postWarEscalation: spec.postWarEscalation,
  })

  const modifiers: Array<{ statId: FactionStatId; type: 'flat'; value: number }> = []
  for (const [statId, value] of Object.entries(spec.effect)) {
    if (typeof value === 'number' && value !== 0) {
      modifiers.push({ statId: statId as FactionStatId, type: 'flat', value })
    }
  }
  if (modifiers.length > 0) {
    const effect: Effect<FactionStatId> = {
      id: treatyEffectId(session.treatyType, session.factionId),
      originId: `treaty:${session.treatyType}`,
      family: 'research',
      modifiers,
      nameZh: `${factionMeta(session.factionId).shortZh}·${spec.labelZh}`,
    }
    addFactionEffect(pf, effect)
  }

  clearMeetingRequest(session.factionId)
  return true
}

// Decline the proposed treaty: a deliberate no-op on diplomatic state. The
// pending meeting request (if any) is cleared so the diplomat stops waiting.
export function declineTreaty(session: DiplomacyCouncilSession): boolean {
  clearMeetingRequest(session.factionId)
  return true
}

// day:rollover hook. For each canon faction whose standing toward the
// player-faction is at or above the configured threshold, raise a diplomat
// meeting request (idempotent — one pending request per faction at a time).
export function diplomacyMeetingRequestTick(gameDay: number): void {
  const pf = findPlayerFaction()
  if (!pf) return
  const interRep = pf.get(FactionInterRep)?.rep ?? {}
  const threshold = factionsConfig.diplomacy.meetingRequestThreshold
  for (const id of CANON_FACTION_IDS) {
    const standing = interRep[id] ?? 0
    if (standing < threshold) continue
    if (getMeetingRequest(id)) continue
    addMeetingRequest({ factionId: id, requestedDay: gameDay })
    emitSim('diplomacy:meeting-requested', { factionId: id, gameDay })
  }
}

// Exposed for the diplomacy debug-handle setter + UI surfacing.
export function diplomacyCanonFactions(): readonly FactionId[] {
  return CANON_FACTION_IDS
}
