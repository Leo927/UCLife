// Newsfeed system tests — pure koota, no clock/loop/save harness. Each test
// seeds a world with a player at a position, sets the barCounter landmark, and
// drives newsfeedSystem for an authored UC date.

import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import { IsPlayer, Position, Character, EntityKey } from '../ecs/traits'
import { setLandmark, clearLandmarks } from '../data/landmarks'
import {
  newsfeedSystem, fireWarDayToast, topHeadlineToday,
  resetNewsfeed, getNewsJournal, isHeadlineConsumed, wasWarDayToastFired,
  snapshotNewsfeed, restoreNewsfeed,
} from './newsfeed'

const COUNTER = { x: 100, y: 100 }

// UC 0077.04.28 — first reachable authored date (game starts 0077.04.27).
function dateFor(year: number, monthIndex: number, day: number): Date {
  const d = new Date()
  d.setFullYear(year, monthIndex, day)
  d.setHours(12, 0, 0, 0)
  return d
}
const APR28 = dateFor(77, 3, 28)
const APR29 = dateFor(77, 3, 29)
const NO_NEWS = dateFor(99, 11, 31)

function spawnPlayerAt(world: ReturnType<typeof createWorld>, x: number, y: number) {
  return world.spawn(
    IsPlayer,
    Position({ x, y }),
    Character({ name: 'P', color: '#fff', title: 'P' }),
    EntityKey({ key: 'player' }),
  )
}

beforeEach(() => {
  resetNewsfeed()
  clearLandmarks()
  setLandmark('barCounter', COUNTER)
})

describe('newsfeedSystem — bar-TV consume', () => {
  it('consumes the day\'s top headline when the player is at the counter', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)

    newsfeedSystem(world, APR28)

    const journal = getNewsJournal()
    expect(journal.length).toBe(1)
    expect(journal[0].id).toBe('vb-dome-maintenance')
    expect(journal[0].dateKey).toBe('UC 0077.04.28')
  })

  it('does NOT consume when the player is away from the counter (missability)', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x + 500, COUNTER.y + 500)

    newsfeedSystem(world, APR28)

    expect(getNewsJournal().length).toBe(0)
    expect(isHeadlineConsumed('vb-dome-maintenance')).toBe(false)
  })

  it('consumes each day\'s headline once, not twice', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)

    newsfeedSystem(world, APR28)
    newsfeedSystem(world, APR28) // same day again
    expect(getNewsJournal().length).toBe(1)

    newsfeedSystem(world, APR29) // next authored day
    expect(getNewsJournal().length).toBe(2)
    expect(isHeadlineConsumed('zeon-autonomy-petition')).toBe(true)
  })

  it('no-ops on a date with no authored headline', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)
    newsfeedSystem(world, NO_NEWS)
    expect(getNewsJournal().length).toBe(0)
  })

  it('no-ops when no bar exists in the scene', () => {
    clearLandmarks() // remove barCounter
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)
    newsfeedSystem(world, APR28)
    expect(getNewsJournal().length).toBe(0)
  })

  it('exposes today\'s top headline regardless of player presence', () => {
    expect(topHeadlineToday(APR28)?.id).toBe('vb-dome-maintenance')
    expect(topHeadlineToday(NO_NEWS)).toBeNull()
  })
})

describe('war-day toast hook (inert in 7.0.A)', () => {
  it('is not fired by normal operation', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)
    newsfeedSystem(world, APR28)
    expect(wasWarDayToastFired()).toBe(false)
  })

  it('fires the war headline when explicitly called, exactly once', () => {
    expect(fireWarDayToast()).toBe(true)
    expect(wasWarDayToastFired()).toBe(true)
    expect(isHeadlineConsumed('op-british')).toBe(true)
  })
})

describe('newsfeed snapshot / restore', () => {
  it('round-trips the journal and war-day flag', () => {
    const world = createWorld()
    spawnPlayerAt(world, COUNTER.x, COUNTER.y)
    newsfeedSystem(world, APR28)
    fireWarDayToast()

    const snap = snapshotNewsfeed()
    resetNewsfeed()
    expect(getNewsJournal().length).toBe(0)
    expect(wasWarDayToastFired()).toBe(false)

    restoreNewsfeed(snap)
    expect(getNewsJournal().length).toBe(2)
    expect(isHeadlineConsumed('vb-dome-maintenance')).toBe(true)
    expect(wasWarDayToastFired()).toBe(true)
  })
})
