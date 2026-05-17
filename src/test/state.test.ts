import { describe, it, expect, afterEach } from 'vitest'
import {
  __resetTestModeForTests,
  isSkipAssets,
  isTestMode,
  markTestMode,
} from './state'

afterEach(() => __resetTestModeForTests())

describe('test-mode state', () => {
  it('starts disabled', () => {
    expect(isTestMode()).toBe(false)
    expect(isSkipAssets()).toBe(false)
  })

  it('markTestMode flips both flags', () => {
    markTestMode({ skipAssets: true })
    expect(isTestMode()).toBe(true)
    expect(isSkipAssets()).toBe(true)
  })

  it('markTestMode respects skipAssets:false (assets opted in)', () => {
    markTestMode({ skipAssets: false })
    expect(isTestMode()).toBe(true)
    expect(isSkipAssets()).toBe(false)
  })
})
