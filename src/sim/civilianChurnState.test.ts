import { describe, expect, it, beforeEach } from 'vitest'
import {
  isChurned, markChurned, getChurnedNames,
  getChurnLastRollDay, markChurnRollDay,
  snapshotCivilianChurn, restoreCivilianChurn, resetCivilianChurn,
} from './civilianChurnState'

describe('civilianChurnState', () => {
  beforeEach(() => {
    resetCivilianChurn()
  })

  it('starts empty', () => {
    expect(getChurnedNames()).toEqual([])
    expect(getChurnLastRollDay()).toBe(0)
  })

  it('records churned names idempotently', () => {
    markChurned('艾米·林')
    markChurned('艾米·林')
    markChurned('伊娃·瓦伦丁')
    expect(isChurned('艾米·林')).toBe(true)
    expect(isChurned('伊娃·瓦伦丁')).toBe(true)
    expect(isChurned('夏亚·阿兹纳布尔')).toBe(false)
    expect(getChurnedNames().sort()).toEqual(['伊娃·瓦伦丁', '艾米·林'])
  })

  it('round-trips the churned set + last roll day through snapshot/restore', () => {
    markChurned('艾米·林')
    markChurned('伊娃·瓦伦丁')
    markChurnRollDay(9)

    const snap = snapshotCivilianChurn()
    expect(snap.churned.sort()).toEqual(['伊娃·瓦伦丁', '艾米·林'])
    expect(snap.lastRollDay).toBe(9)

    resetCivilianChurn()
    expect(getChurnedNames()).toEqual([])

    restoreCivilianChurn(snap)
    expect(isChurned('艾米·林')).toBe(true)
    expect(isChurned('伊娃·瓦伦丁')).toBe(true)
    expect(getChurnLastRollDay()).toBe(9)
  })

  it('defaults to empty when restoring a legacy blob missing the fields', () => {
    restoreCivilianChurn({} as never)
    expect(getChurnedNames()).toEqual([])
    expect(getChurnLastRollDay()).toBe(0)
  })
})
