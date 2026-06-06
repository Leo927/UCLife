// conscriptionState — the draft-notice lifecycle store + medical-letter
// consumable + persistence round-trip.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  hasDraftNotice, getDraftResolution, hasMedicalLetter, getCooldownUntilDay,
  getLastNoticeDay, issueDraftNotice, resolveDraftNotice, grantMedicalLetter,
  snapshotConscription, restoreConscription, resetConscription,
} from './conscriptionState'

beforeEach(() => resetConscription())

describe('draft-notice lifecycle', () => {
  it('starts with no outstanding notice', () => {
    expect(hasDraftNotice()).toBe(false)
    expect(getDraftResolution()).toBe('none')
  })

  it('issues a notice once and records the day', () => {
    expect(issueDraftNotice(620)).toBe(true)
    expect(hasDraftNotice()).toBe(true)
    expect(getLastNoticeDay()).toBe(620)
    // A second issue while one is outstanding is a no-op.
    expect(issueDraftNotice(621)).toBe(false)
    expect(getLastNoticeDay()).toBe(620)
  })

  it('resolves a notice, recording outcome + cooldown', () => {
    issueDraftNotice(620)
    resolveDraftNotice('refused', 650, false)
    expect(hasDraftNotice()).toBe(false)
    expect(getDraftResolution()).toBe('refused')
    expect(getCooldownUntilDay()).toBe(650)
  })
})

describe('medical letter', () => {
  it('grants then consumes on resolution', () => {
    grantMedicalLetter()
    expect(hasMedicalLetter()).toBe(true)
    issueDraftNotice(620)
    resolveDraftNotice('refused', 650, true)
    expect(hasMedicalLetter()).toBe(false)
  })

  it('keeps the letter when resolution does not consume it', () => {
    grantMedicalLetter()
    issueDraftNotice(620)
    resolveDraftNotice('drafted', 650, false)
    expect(hasMedicalLetter()).toBe(true)
  })
})

describe('persistence', () => {
  it('round-trips the full state', () => {
    grantMedicalLetter()
    issueDraftNotice(620)
    resolveDraftNotice('drafted', 650, false)
    const snap = snapshotConscription()

    resetConscription()
    expect(getDraftResolution()).toBe('none')
    expect(hasMedicalLetter()).toBe(false)

    restoreConscription(snap)
    expect(getDraftResolution()).toBe('drafted')
    expect(getCooldownUntilDay()).toBe(650)
    expect(hasMedicalLetter()).toBe(true)
  })
})
