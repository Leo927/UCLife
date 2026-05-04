// Verifies the typed pub/sub surface used to invert sim → ui dependencies.
// Tests cover: per-event-name dispatch, payload shape preservation, the
// existing four lifecycle-event callsites that pass only a `reason` string,
// and unsubscribe semantics.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitSim, onSim } from './events'

describe('sim/events typed dispatch', () => {
  // events.ts owns module-level listener state. Each test must clean up
  // its own subscriptions (via the returned unsub) so cross-test bleed
  // can't mask a missing-payload bug.
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!()
  })

  it('routes a payload to the matching listener only', () => {
    const onLog = vi.fn()
    const onToast = vi.fn()
    cleanups.push(onSim('log', onLog))
    cleanups.push(onSim('toast', onToast))

    emitSim('log', { textZh: 'hi', atMs: 42 })

    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith({ textZh: 'hi', atMs: 42 })
    expect(onToast).not.toHaveBeenCalled()
  })

  it('preserves the legacy reason-only shape for lifecycle events', () => {
    const onDay = vi.fn()
    cleanups.push(onSim('day:rollover', onDay))

    emitSim('day:rollover', { reason: '日翻页' })

    expect(onDay).toHaveBeenCalledWith({ reason: '日翻页' })
  })

  it('supports payloads with optional fields', () => {
    const onToast = vi.fn()
    cleanups.push(onSim('toast', onToast))

    emitSim('toast', { textZh: '只有文本' })
    emitSim('toast', { textZh: '带时长', durationMs: 6000 })

    expect(onToast).toHaveBeenNthCalledWith(1, { textZh: '只有文本' })
    expect(onToast).toHaveBeenNthCalledWith(2, { textZh: '带时长', durationMs: 6000 })
  })

  it('routes empty payloads for marker events', () => {
    const onSlotEmpty = vi.fn()
    const onShop = vi.fn()
    cleanups.push(onSim('ambitions:slot-empty', onSlotEmpty))
    cleanups.push(onSim('ui:open-shop', onShop))

    emitSim('ambitions:slot-empty', {})
    emitSim('ui:open-shop', {})

    expect(onSlotEmpty).toHaveBeenCalledWith({})
    expect(onShop).toHaveBeenCalledWith({})
  })

  it('routes ui:open-* payloads with their typed fields', () => {
    const onFlight = vi.fn()
    const onTransit = vi.fn()
    cleanups.push(onSim('ui:open-flight', onFlight))
    cleanups.push(onSim('ui:open-transit', onTransit))

    emitSim('ui:open-flight', { hubId: 'vonbraunAirport' })
    emitSim('ui:open-transit', { terminalId: 'vonbraunCentral' })

    expect(onFlight).toHaveBeenCalledWith({ hubId: 'vonbraunAirport' })
    expect(onTransit).toHaveBeenCalledWith({ terminalId: 'vonbraunCentral' })
  })

  it('returns an unsubscribe handle that detaches the listener', () => {
    const fn = vi.fn()
    const unsub = onSim('toast', fn)
    emitSim('toast', { textZh: 'first' })
    unsub()
    emitSim('toast', { textZh: 'second' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ textZh: 'first' })
  })

  it('is a no-op when no listeners are registered', () => {
    expect(() => emitSim('hyperspeed:start', { reason: '快进开始' })).not.toThrow()
  })
})
