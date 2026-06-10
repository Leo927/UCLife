// Phase 5.3 — psychology consumers (Design/social/psychology.md).
// Event-driven only: applyCauseEvent runs when a character takes a
// cause-tagged public action (governance stance today; news/gossip
// channels later), revealNextSympathy on dialog open. No per-tick work.
//
// Perf: applyCauseEvent is O(characters × tagged causes) per event —
// N ≈ a few hundred city NPCs, events are player-paced (council
// resolutions), and the dot product is 4 stat reads. Well under a
// 1ms-per-event budget; nothing here is on the tick or frame path.

import type { Entity, World } from 'koota'
import { Attributes, Character, EntityKey, Psyche } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { psychologyConfig, type CauseId, type CauseTags } from '../config/psychology'
import {
  causeReaction, nextRevealableCause, sympathiesOf,
} from '../character/psychology'
import { applyOpinionDelta } from './relations'
import { gameDayNumber } from '../sim/clock'

export interface CauseEventReaction {
  npcKey: string
  applied: number
}

export interface CauseEventOpts {
  // The character whose public act carries the tags; reactors' opinion
  // of this entity moves.
  actor: Entity
  causeTags: CauseTags
  // zh predicate completing "你<deedZh>。" in the next-talk reveal line.
  deedZh: string
  nowMs: number
  // Defaults to every scene world — "every character who has sympathies
  // on that cause" reacts (relationships.md § Stance reactions).
  worlds?: World[]
}

export function applyCauseEvent(opts: CauseEventOpts): CauseEventReaction[] {
  const cfg = psychologyConfig.reaction
  const actorName = opts.actor.get(Character)?.name ?? '?'
  const worlds = opts.worlds ?? SCENE_IDS.map((id) => getWorld(id))
  const reactions: CauseEventReaction[] = []
  for (const world of worlds) {
    for (const npc of world.query(Psyche, Attributes, Character)) {
      if (npc === opts.actor) continue
      const sheet = npc.get(Attributes)!.sheet
      const delta = causeReaction(sheet, opts.causeTags) * cfg.opinionScale
      if (Math.abs(delta) < cfg.minAbsOpinionDelta) continue
      const applied = applyOpinionDelta(
        npc, opts.actor, delta,
        { actorName, deedZh: opts.deedZh },
        opts.nowMs,
      )
      reactions.push({ npcKey: npc.get(EntityKey)?.key ?? '', applied })
    }
  }
  return reactions
}

export interface SympathyReveal {
  causeId: CauseId
  weight: number
  lineZh: string
}

// zh reveal line voiced in the dialog when a sympathy surfaces.
function revealLineZh(name: string, causeId: CauseId, weight: number): string {
  const causeZh = psychologyConfig.causes[causeId].nameZh
  const strong = Math.abs(weight) >= psychologyConfig.reveal.strongAbsThreshold
  const attitude = weight > 0
    ? (strong ? '满腔热忱' : '颇有好感')
    : (strong ? '深恶痛绝' : '不以为然')
  return `谈话间，${name}对「${causeZh}」似乎${attitude}。`
}

// Deterministic-progressive reveal: the first conversation of each game
// day surfaces the next not-yet-known cause-sympathy, highest magnitude
// first, until exhausted (psychology.md § Reveal). Not a chance roll.
export function revealNextSympathy(npc: Entity, nowMs: number): SympathyReveal | null {
  if (!npc.has(Psyche) || !npc.has(Attributes)) return null
  const psyche = npc.get(Psyche)!
  const day = gameDayNumber(new Date(nowMs))
  if (psyche.lastRevealDay === day) return null
  const sympathies = sympathiesOf(npc.get(Attributes)!.sheet)
  const causeId = nextRevealableCause(sympathies, psyche.revealed)
  if (!causeId) return null
  npc.set(Psyche, {
    revealed: [...psyche.revealed, causeId],
    lastRevealDay: day,
  })
  const weight = sympathies[causeId]!
  const name = npc.get(Character)?.name ?? '?'
  return { causeId, weight, lineZh: revealLineZh(name, causeId, weight) }
}

// Inspector view of a character's psyche: revealed cause tags with their
// weights, in reveal order.
export function revealedSympathyTags(
  npc: Entity,
): Array<{ causeId: CauseId; nameZh: string; weight: number }> {
  if (!npc.has(Psyche) || !npc.has(Attributes)) return []
  const sympathies = sympathiesOf(npc.get(Attributes)!.sheet)
  const out: Array<{ causeId: CauseId; nameZh: string; weight: number }> = []
  for (const causeId of npc.get(Psyche)!.revealed as CauseId[]) {
    const weight = sympathies[causeId]
    if (weight === undefined) continue
    out.push({ causeId, nameZh: psychologyConfig.causes[causeId].nameZh, weight })
  }
  return out
}
