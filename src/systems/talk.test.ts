import { afterEach, describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Position, MoveTarget, Action, IsPlayer, QueuedTalk, Character, Health, Appearance,
} from '../ecs/traits'
import { onSim, type SimEventPayloads } from '../sim/events'
import { worldConfig } from '../config'
import { talkSystem } from './talk'

const TALK_RANGE = worldConfig.ranges.playerInteract

interface CapturedOpen { entity: SimEventPayloads['ui:open-dialog-npc']['entity'] }

function captureDialogOpens(): { events: CapturedOpen[]; off: () => void } {
  const events: CapturedOpen[] = []
  const off = onSim('ui:open-dialog-npc', (p) => events.push({ entity: p.entity }))
  return { events, off }
}

function spawnPlayer(world: ReturnType<typeof createWorld>, x: number, y: number) {
  return world.spawn(
    IsPlayer,
    Position({ x, y }),
    MoveTarget({ x, y }),
    Action({ kind: 'idle', remaining: 0, total: 0 }),
  )
}

function spawnNpc(world: ReturnType<typeof createWorld>, x: number, y: number) {
  return world.spawn(
    Character({ name: 'npc', color: '#fff', title: '' }),
    Position({ x, y }),
    Health({ hp: 100, dead: false }),
    Appearance(),
  )
}

describe('talkSystem', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  it('opens the dialog when the player is within talk range and clears QueuedTalk', () => {
    const world = createWorld()
    const npc = spawnNpc(world, 100, 100)
    const player = spawnPlayer(world, 100 + TALK_RANGE - 1, 100)
    player.add(QueuedTalk({ target: npc }))

    const cap = captureDialogOpens()
    cleanup = cap.off

    talkSystem(world)

    expect(cap.events.length).toBe(1)
    expect(cap.events[0].entity).toBe(npc)
    expect(player.has(QueuedTalk)).toBe(false)
  })

  it('does not open the dialog while still walking; updates MoveTarget toward a moved NPC', () => {
    const world = createWorld()
    const npc = spawnNpc(world, 500, 500)
    const player = spawnPlayer(world, 100, 100)
    player.add(QueuedTalk({ target: npc }))
    player.set(MoveTarget, { x: 500, y: 500 })

    const cap = captureDialogOpens()
    cleanup = cap.off

    // First tick: still far, no dialog.
    talkSystem(world)
    expect(cap.events.length).toBe(0)
    expect(player.has(QueuedTalk)).toBe(true)

    // NPC walks far away — talkSystem must re-issue MoveTarget so the player keeps following.
    npc.set(Position, { x: 900, y: 900 })
    talkSystem(world)
    const mt = player.get(MoveTarget)!
    expect(mt.x).toBe(900)
    expect(mt.y).toBe(900)
    expect(cap.events.length).toBe(0)
  })

  it('cancels QueuedTalk and skips dialog if the target NPC died', () => {
    const world = createWorld()
    const npc = spawnNpc(world, 100, 100)
    const player = spawnPlayer(world, 100 + TALK_RANGE - 1, 100)
    player.add(QueuedTalk({ target: npc }))
    npc.set(Health, { hp: 0, dead: true })

    const cap = captureDialogOpens()
    cleanup = cap.off

    talkSystem(world)

    expect(cap.events.length).toBe(0)
    expect(player.has(QueuedTalk)).toBe(false)
  })

  it('blocks dialog when the player is mid-action (not idle/walking)', () => {
    const world = createWorld()
    const npc = spawnNpc(world, 100, 100)
    const player = spawnPlayer(world, 100 + TALK_RANGE - 1, 100)
    player.add(QueuedTalk({ target: npc }))
    player.set(Action, { kind: 'eating', remaining: 30, total: 30 })

    const cap = captureDialogOpens()
    cleanup = cap.off

    talkSystem(world)

    expect(cap.events.length).toBe(0)
    expect(player.has(QueuedTalk)).toBe(true)
  })
})
