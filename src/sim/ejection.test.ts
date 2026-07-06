// W3 (ms-identity) Task 7 — ejection pod state + seeded fate rolls.
// Pure-logic coverage: drift integration, hostile-reach capture (armed/
// re-arm), and the permadeath-gated player + crew wing fate decisions.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  spawnPlayerPod, spawnWingPod, hasPlayerPod, hasAnyPod, getPods,
  tickPodDrift, checkHostileReachCaptures, resolvePlayerPodAtEnd,
  resolveWingPodFates, decidePlayerCaptureFate, resetEjection,
} from './ejection'
import { setSimRngSeed } from './rng'
import { setPermadeath, resetPermadeath } from './permadeath'
import { sortieConfig } from '../config'

beforeEach(() => {
  resetEjection()
  resetPermadeath()
  setSimRngSeed('ejection-test')
})

describe('ejection — pod spawn + drift', () => {
  it('scales drift velocity by podDriftSpeedFrac', () => {
    const pod = spawnPlayerPod({ rosterKey: 'ms-1', nameZh: '测试机', pos: { x: 100, y: 100 }, vel: { x: 10, y: 0 } })
    expect(pod.vel.x).toBeCloseTo(10 * sortieConfig.ejection.podDriftSpeedFrac, 5)
    expect(hasPlayerPod()).toBe(true)
  })

  it('caps drift velocity at podMaxDriftSpeed', () => {
    const pod = spawnPlayerPod({ rosterKey: 'ms-1', nameZh: '测试机', pos: { x: 0, y: 0 }, vel: { x: 100000, y: 0 } })
    expect(Math.hypot(pod.vel.x, pod.vel.y)).toBeCloseTo(sortieConfig.ejection.podMaxDriftSpeed, 5)
  })

  it('drifts pods forward by vel × dt', () => {
    spawnPlayerPod({ rosterKey: 'ms-1', nameZh: '测试机', pos: { x: 0, y: 0 }, vel: { x: 10, y: 0 } })
    tickPodDrift(1)
    const [pod] = getPods()
    expect(pod.pos.x).toBeCloseTo(10 * sortieConfig.ejection.podDriftSpeedFrac, 5)
  })
})

describe('ejection — hostile-reach capture', () => {
  it('does not capture when no hostile is within podCaptureRadiusPx', () => {
    spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    const far = sortieConfig.ejection.podCaptureRadiusPx + 50
    const r = checkHostileReachCaptures([{ x: far, y: 0 }])
    expect(r.playerCaptured).toBeNull()
    expect(hasPlayerPod()).toBe(true)
  })

  it('captures the player pod on a close hostile pass (probability 1)', () => {
    // Seed-independent: force capture certainty by pinning the config prob.
    const orig = sortieConfig.ejection.podCaptureProbability
    sortieConfig.ejection.podCaptureProbability = 1
    try {
      spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
      const r = checkHostileReachCaptures([{ x: 5, y: 0 }])
      expect(r.playerCaptured).not.toBeNull()
      expect(hasPlayerPod()).toBe(false)
    } finally {
      sortieConfig.ejection.podCaptureProbability = orig
    }
  })

  it('rolls only once per approach episode (disarms until hostile leaves)', () => {
    const orig = sortieConfig.ejection.podCaptureProbability
    sortieConfig.ejection.podCaptureProbability = 0  // never captures
    try {
      spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
      const near = [{ x: 5, y: 0 }]
      checkHostileReachCaptures(near)
      const [pod] = getPods()
      expect(pod.captureArmed).toBe(false)  // disarmed after the in-range roll
      // Hostile leaves → re-arm.
      checkHostileReachCaptures([{ x: 9999, y: 0 }])
      expect(getPods()[0].captureArmed).toBe(true)
    } finally {
      sortieConfig.ejection.podCaptureProbability = orig
    }
  })
})

describe('ejection — player fate (permadeath gate)', () => {
  it('victory recovers the pilot; permadeath-off applies an injury', () => {
    setPermadeath(false)
    spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    const fate = resolvePlayerPodAtEnd('victory')
    expect(fate).toEqual({ outcome: 'recovered', injured: true })
    expect(hasPlayerPod()).toBe(false)
  })

  it('victory recovery under permadeath-on does not injure', () => {
    setPermadeath(true)
    spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    expect(resolvePlayerPodAtEnd('victory')).toEqual({ outcome: 'recovered', injured: false })
  })

  it('defeat captures the pilot; permadeath-off never ends the run', () => {
    setPermadeath(false)
    spawnPlayerPod({ rosterKey: 'ms-1', nameZh: 'm', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    const fate = resolvePlayerPodAtEnd('defeat')
    expect(fate).toEqual({ outcome: 'captured', injured: true, runEnded: false })
  })

  it('permadeath-on capture can end the run (survival roll)', () => {
    setPermadeath(true)
    const origSurvival = sortieConfig.ejection.podSurvivalRollPermadeath
    sortieConfig.ejection.podSurvivalRollPermadeath = 1  // always ends the run
    try {
      const fate = decidePlayerCaptureFate()
      expect(fate).toEqual({ outcome: 'captured', injured: false, runEnded: true })
    } finally {
      sortieConfig.ejection.podSurvivalRollPermadeath = origSurvival
    }
  })

  it('permadeath-on capture can spare the pilot (survival roll)', () => {
    setPermadeath(true)
    const origSurvival = sortieConfig.ejection.podSurvivalRollPermadeath
    sortieConfig.ejection.podSurvivalRollPermadeath = 0  // never ends the run
    try {
      const fate = decidePlayerCaptureFate()
      expect(fate).toEqual({ outcome: 'captured', injured: true, runEnded: false })
    } finally {
      sortieConfig.ejection.podSurvivalRollPermadeath = origSurvival
    }
  })
})

describe('ejection — wing pod fates', () => {
  it('resolves every wing pod and clears state', () => {
    spawnWingPod({ rosterKey: 'ms-a', pilotKey: 'p-a', nameZh: 'A', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    spawnWingPod({ rosterKey: 'ms-b', pilotKey: 'p-b', nameZh: 'B', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
    const fates = resolveWingPodFates()
    expect(fates).toHaveLength(2)
    expect(fates.map((f) => f.rosterKey).sort()).toEqual(['ms-a', 'ms-b'])
    expect(hasAnyPod()).toBe(false)
    for (const f of fates) expect(['recovered', 'lost']).toContain(f.outcome)
  })

  it('recovery probability 1 keeps the pilot alive; 0 loses them', () => {
    const orig = sortieConfig.ejection.wingPodRecoveryProbability
    sortieConfig.ejection.wingPodRecoveryProbability = 1
    try {
      spawnWingPod({ rosterKey: 'ms-a', pilotKey: 'p-a', nameZh: 'A', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
      expect(resolveWingPodFates()[0].outcome).toBe('recovered')
    } finally {
      sortieConfig.ejection.wingPodRecoveryProbability = orig
    }
    sortieConfig.ejection.wingPodRecoveryProbability = 0
    try {
      spawnWingPod({ rosterKey: 'ms-b', pilotKey: 'p-b', nameZh: 'B', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
      expect(resolveWingPodFates()[0].outcome).toBe('lost')
    } finally {
      sortieConfig.ejection.wingPodRecoveryProbability = orig
    }
  })
})
