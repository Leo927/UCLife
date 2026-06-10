// Issue #144 — grievance/credit acknowledgement queue on the Knows edge.
// Eager opinion state + lazy in-character reveal (Design/social/
// relationships.md § Lazy reveal). Pure-logic tests over a koota
// createWorld(), mirroring the research/recruitment test patterns.

import { afterEach, describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Character, EntityKey, Knows, type OpinionCause } from '../ecs/traits'
import {
  applyOpinionDelta, drainAcknowledgements,
  snapshotRelations, restoreRelations,
} from './relations'
import { aiConfig } from '../config'
import type { Entity } from 'koota'

const R = aiConfig.relations
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_750_000_000_000

const createdWorlds: ReturnType<typeof createWorld>[] = []
afterEach(() => {
  while (createdWorlds.length) createdWorlds.pop()!.destroy()
})

function makeWorld() {
  const world = createWorld()
  createdWorlds.push(world)
  const player = world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    EntityKey({ key: 'player' }),
  )
  const npc = world.spawn(
    Character({ name: '凯', color: '#fff', title: '' }),
    EntityKey({ key: 'npc-kai' }),
  )
  return { world, player, npc }
}

const cause = (deedZh: string): OpinionCause => ({ actorName: '玩家', deedZh })

describe('applyOpinionDelta', () => {
  it('applies the delta eagerly and lazily creates the edge', () => {
    const { player, npc } = makeWorld()
    const applied = applyOpinionDelta(npc, player, -18, cause('打断了我弟弟的胳膊'), NOW)
    expect(applied).toBe(-18)
    const e = npc.get(Knows(player))!
    expect(e.opinion, 'opinion must move at action-time, not at reveal').toBe(-18)
  })

  it('clamps at the opinion bound and returns only the applied portion', () => {
    const { player, npc } = makeWorld()
    applyOpinionDelta(npc, player, R.opinionMin + 5, cause('a'), NOW)
    const applied = applyOpinionDelta(npc, player, -10, cause('b'), NOW)
    expect(applied).toBe(-5)
    expect(npc.get(Knows(player))!.opinion).toBe(R.opinionMin)
    // Fully clamped-away writes queue nothing — surfacing a swing that
    // never happened would lie to the player.
    const before = npc.get(Knows(player))!.grievances.length
    const applied2 = applyOpinionDelta(npc, player, -10, cause('c'), NOW)
    expect(applied2).toBe(0)
    expect(npc.get(Knows(player))!.grievances.length).toBe(before)
  })

  it('queues a grievance when |applied| reaches the threshold', () => {
    const { player, npc } = makeWorld()
    applyOpinionDelta(npc, player, -R.ackThresholdAbs, cause('打了我'), NOW)
    const e = npc.get(Knows(player))!
    expect(e.grievances).toHaveLength(1)
    expect(e.credits).toHaveLength(0)
    expect(e.grievances[0]).toEqual({
      cause: { actorName: '玩家', deedZh: '打了我' },
      delta: -R.ackThresholdAbs,
      whenMs: NOW,
    })
  })

  it('queues a credit for a positive delta, symmetrically', () => {
    const { player, npc } = makeWorld()
    applyOpinionDelta(npc, player, R.ackThresholdAbs, cause('帮我搬了行李'), NOW)
    const e = npc.get(Knows(player))!
    expect(e.credits).toHaveLength(1)
    expect(e.grievances).toHaveLength(0)
    expect(e.credits[0].delta).toBe(R.ackThresholdAbs)
  })

  it('queues nothing below the threshold (opinion still moves)', () => {
    const { player, npc } = makeWorld()
    const small = R.ackThresholdAbs - 1
    applyOpinionDelta(npc, player, -small, cause('迟到了'), NOW)
    const e = npc.get(Knows(player))!
    expect(e.opinion).toBe(-small)
    expect(e.grievances).toHaveLength(0)
    expect(e.credits).toHaveLength(0)
  })

  it('caps each queue at ackQueueMax, dropping the oldest first', () => {
    const { player, npc } = makeWorld()
    const extra = 2
    for (let i = 0; i < R.ackQueueMax + extra; i++) {
      // Alternate signs are irrelevant here — keep all negative so one
      // queue absorbs every record.
      applyOpinionDelta(npc, player, -R.ackThresholdAbs, cause(`deed-${i}`), NOW + i)
    }
    const e = npc.get(Knows(player))!
    expect(e.grievances).toHaveLength(R.ackQueueMax)
    expect(e.grievances[0].cause.deedZh).toBe(`deed-${extra}`)
  })

  it('does not share queue arrays between distinct edges', () => {
    const { world, player, npc } = makeWorld()
    const other = world.spawn(
      Character({ name: '另一人', color: '#fff', title: '' }),
      EntityKey({ key: 'npc-other' }),
    )
    applyOpinionDelta(npc, player, -R.ackThresholdAbs, cause('x'), NOW)
    applyOpinionDelta(other, player, R.ackThresholdAbs, cause('y'), NOW)
    expect(npc.get(Knows(player))!.grievances).toHaveLength(1)
    expect(npc.get(Knows(player))!.credits).toHaveLength(0)
    expect(other.get(Knows(player))!.grievances).toHaveLength(0)
    expect(other.get(Knows(player))!.credits).toHaveLength(1)
  })
})

describe('drainAcknowledgements', () => {
  it('voices the deed and the swing, then clears the queue', () => {
    const { player, npc } = makeWorld()
    applyOpinionDelta(npc, player, -18, cause('打断了我弟弟的胳膊'), NOW)
    const lines = drainAcknowledgements(npc, player, NOW)
    expect(lines).toHaveLength(1)
    expect(lines[0].textZh).toContain('打断了我弟弟的胳膊')
    expect(lines[0].textZh).toContain('关系 -18')
    expect(lines[0].textZh).toContain('今天')
    expect(lines[0].delta).toBe(-18)
    const e = npc.get(Knows(player))!
    expect(e.grievances, 'queue must clear once acknowledged').toHaveLength(0)
    expect(drainAcknowledgements(npc, player, NOW)).toHaveLength(0)
  })

  it('thanks credits the same way and orders mixed records by time', () => {
    const { player, npc } = makeWorld()
    applyOpinionDelta(npc, player, -8, cause('抢了我的座位'), NOW - 2 * DAY_MS)
    applyOpinionDelta(npc, player, 12, cause('帮我搬了行李'), NOW - DAY_MS)
    const lines = drainAcknowledgements(npc, player, NOW)
    expect(lines).toHaveLength(2)
    expect(lines[0].textZh).toContain('2 天前')
    expect(lines[0].textZh).toContain('关系 -8')
    expect(lines[1].textZh).toContain('昨天')
    expect(lines[1].textZh).toContain('关系 +12')
    const e = npc.get(Knows(player))!
    expect(e.grievances).toHaveLength(0)
    expect(e.credits).toHaveLength(0)
  })

  it('returns [] when there is no edge', () => {
    const { player, npc } = makeWorld()
    expect(drainAcknowledgements(npc, player, NOW)).toHaveLength(0)
  })
})

describe('save round-trip', () => {
  it('queued records survive snapshot → restore on the relation edge', () => {
    const { world, player, npc } = makeWorld()
    applyOpinionDelta(npc, player, -18, cause('打断了我弟弟的胳膊'), NOW)
    applyOpinionDelta(npc, player, 6, cause('请我喝了一杯'), NOW + 1)
    const snaps = snapshotRelations(world)

    const { world: w2, player: p2, npc: n2 } = makeWorld()
    const byKey = new Map<string, Entity>([['player', p2], ['npc-kai', n2]])
    restoreRelations(w2, byKey, snaps)
    const e = n2.get(Knows(p2))!
    expect(e.opinion).toBe(-12)
    expect(e.grievances).toHaveLength(1)
    expect(e.grievances[0].cause.deedZh).toBe('打断了我弟弟的胳膊')
    expect(e.credits).toHaveLength(1)
    expect(e.credits[0].whenMs).toBe(NOW + 1)
  })

  it('restores pre-queue saves with empty queues', () => {
    const { world: w2, player: p2, npc: n2 } = makeWorld()
    const byKey = new Map<string, Entity>([['player', p2], ['npc-kai', n2]])
    // A snap shaped like a pre-#144 save blob: no queue fields at all.
    restoreRelations(w2, byKey, [{
      srcKey: 'npc-kai', tgtKey: 'player',
      opinion: -3, familiarity: 10, lastSeenMs: NOW, meetCount: 2,
    } as never])
    const e = n2.get(Knows(p2))!
    expect(e.opinion).toBe(-3)
    expect(e.grievances).toHaveLength(0)
    expect(e.credits).toHaveLength(0)
  })
})
