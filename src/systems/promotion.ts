// Player only. Single-toast semantics: noticedRankByFamily tracks the
// highest rank already notified per family.

import type { World, Entity } from 'koota'
import { Job, Workstation } from '../ecs/traits'
import { getJobSpec } from '../data/jobs'
import { jobsConfig } from '../config'
import { meetsRequirements } from './market'
import { emitSim } from '../sim/events'

// player-global: the promotion notice memo applies to the single player;
// only the player has a job-family promotion ladder. Module-scope is safe.
const noticedRankByFamily = new Map<string, number>()

export function resetPromotionNotices() {
  noticedRankByFamily.clear()
}

function familyLadder(family: string): Array<{ rank: number; specId: string }> {
  const out: Array<{ rank: number; specId: string }> = []
  for (const [specId, spec] of Object.entries(jobsConfig.catalog)) {
    if (spec.family === family && typeof spec.rank === 'number') {
      out.push({ rank: spec.rank, specId })
    }
  }
  out.sort((a, b) => a.rank - b.rank)
  return out
}

// Any station of a given specId carries identical gating data.
function anyStationForSpec(world: World, specId: string): Entity | null {
  for (const ws of world.query(Workstation)) {
    const w = ws.get(Workstation)!
    if (w.specId === specId) return ws
  }
  return null
}

export function highestEligibleRank(
  world: World,
  entity: Entity,
  family: string,
  currentRank: number,
): { rank: number; specId: string } | null {
  const ladder = familyLadder(family)
  let best: { rank: number; specId: string } | null = null
  for (const r of ladder) {
    if (r.rank <= currentRank) continue
    const ws = anyStationForSpec(world, r.specId)
    if (!ws) continue
    if (!meetsRequirements(world, entity, ws)) continue
    best = r
  }
  return best
}

export function checkPromotionEligibility(world: World, player: Entity): void {
  const j = player.get(Job)
  const ws = j?.workstation
  if (!ws) return
  const w = ws.get(Workstation)
  if (!w) return
  const spec = getJobSpec(w.specId)
  if (!spec || !spec.family || typeof spec.rank !== 'number') return

  const next = highestEligibleRank(world, player, spec.family, spec.rank)
  if (!next) return

  const lastNoticed = noticedRankByFamily.get(spec.family) ?? spec.rank
  if (next.rank <= lastNoticed) return

  noticedRankByFamily.set(spec.family, next.rank)
  const nextSpec = getJobSpec(next.specId)
  if (!nextSpec) return
  emitSim('toast', {
    textZh: `亚纳海姆电子 · 已达到 ${nextSpec.jobTitle} 晋升条件 — 前往工坊前台申请`,
    durationMs: 8000,
  })
}

export function clearPromotionNoticeForFamily(family: string): void {
  noticedRankByFamily.delete(family)
}
