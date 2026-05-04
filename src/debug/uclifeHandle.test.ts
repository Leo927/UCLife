// Verifies the dev debug-handle registry. The production manifest
// (src/boot/debugHandles/) side-effect-imports cluster files; this
// test pins the contract those files rely on (unique names, deferred
// assembly, clean reset between tests).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  registerDebugHandle,
  assembleUclifeHandle,
  __resetDebugHandlesForTests,
} from './uclifeHandle'

describe('debug/uclifeHandle', () => {
  beforeEach(() => {
    __resetDebugHandlesForTests()
  })

  afterEach(() => {
    __resetDebugHandlesForTests()
  })

  it('empty registry assembles to an empty object', () => {
    expect(assembleUclifeHandle()).toEqual({})
  })

  it('registered values appear on the assembled handle under their name', () => {
    registerDebugHandle('foo', 42)
    registerDebugHandle('bar', 'baz')
    expect(assembleUclifeHandle()).toEqual({ foo: 42, bar: 'baz' })
  })

  it('preserves function identity — handles are wired up, not copied', () => {
    const fn = () => 7
    registerDebugHandle('go', fn)
    const handle = assembleUclifeHandle() as { go: () => number }
    expect(handle.go).toBe(fn)
    expect(handle.go()).toBe(7)
  })

  it('throws on duplicate name so collisions surface at boot, not at call site', () => {
    registerDebugHandle('dup', 1)
    expect(() => registerDebugHandle('dup', 2)).toThrow(/dup/)
  })

  it('__resetDebugHandlesForTests clears the registry', () => {
    registerDebugHandle('x', 1)
    __resetDebugHandlesForTests()
    expect(assembleUclifeHandle()).toEqual({})
    // Same name re-registers cleanly after a reset.
    registerDebugHandle('x', 2)
    expect(assembleUclifeHandle()).toEqual({ x: 2 })
  })
})
