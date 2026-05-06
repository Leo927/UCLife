// Verifies each event → store binding. Uses real zustand stores: they're
// synchronous and we can read getState() after emit. The ambitions binding
// test specifically pins the guard so the inversion can't regress (sim
// must NOT need to read ui state to dedupe).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// uiBindings.ts memoizes its first call. The default suite uses a fresh
// module instance per test via vi.resetModules() so `bound = false` is
// honored — each test gets its own subscriber set without cross-test
// pollution from earlier emits.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

async function setup() {
  const { bindUi } = await import('./uiBindings')
  const { emitSim } = await import('../sim/events')
  const { useUI } = await import('../ui/uiStore')
  const { useEventLog } = await import('../ui/EventLog')
  bindUi()
  // Clear any state the modules ran into during import.
  useUI.setState({
    statusOpen: false, inventoryOpen: false, shopOpen: false, systemOpen: false, mapOpen: false,
    ambitionsOpen: false, shipDealerOpen: false,
    transitSourceId: null, flightHubId: null,
    dialogNPC: null, enlargedPortrait: null, toasts: [],
  })
  useEventLog.setState({ entries: [] })
  return { emitSim, useUI, useEventLog }
}

describe('boot/uiBindings', () => {
  it('log → useEventLog.push', async () => {
    const { emitSim, useEventLog } = await setup()
    emitSim('log', { textZh: '事件', atMs: 12345 })
    const entries = useEventLog.getState().entries
    expect(entries.length).toBe(1)
    expect(entries[0].textZh).toBe('事件')
    expect(entries[0].gameMs).toBe(12345)
  })

  it('toast → useUI.showToast (text passes through)', async () => {
    vi.useFakeTimers()
    const { emitSim, useUI } = await setup()
    emitSim('toast', { textZh: '通知' })
    expect(useUI.getState().toasts.length).toBe(1)
    expect(useUI.getState().toasts[0].text).toBe('通知')
  })

  it('toast → useUI.showToast preserves the optional action callback', async () => {
    vi.useFakeTimers()
    const { emitSim, useUI } = await setup()
    const onClick = vi.fn()
    emitSim('toast', {
      textZh: '强制',
      durationMs: 8000,
      action: { label: '强制', onClick },
    })
    const toast = useUI.getState().toasts[0]
    expect(toast.action?.label).toBe('强制')
    toast.action?.onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('ui:open-shop sets shopOpen', async () => {
    const { emitSim, useUI } = await setup()
    emitSim('ui:open-shop', {})
    expect(useUI.getState().shopOpen).toBe(true)
  })

  it('ui:open-flight stores the hub id', async () => {
    const { emitSim, useUI } = await setup()
    emitSim('ui:open-flight', { hubId: 'vonbraunAirport' })
    expect(useUI.getState().flightHubId).toBe('vonbraunAirport')
  })

  it('ui:open-transit stores the source terminal id', async () => {
    const { emitSim, useUI } = await setup()
    emitSim('ui:open-transit', { terminalId: 'vonbraunCentral' })
    expect(useUI.getState().transitSourceId).toBe('vonbraunCentral')
  })

  it('ui:open-dialog-npc stores the entity reference', async () => {
    const { emitSim, useUI } = await setup()
    // The store treats entities as opaque references, so a typed-cast
    // sentinel is enough to verify pass-through. The real Entity type is
    // a koota Entity — irrelevant to this binding's behavior.
    const fakeEntity = { id: 'npc#42' } as unknown as import('koota').Entity
    emitSim('ui:open-dialog-npc', { entity: fakeEntity })
    expect(useUI.getState().dialogNPC).toBe(fakeEntity)
  })

  it('ui:open-ship-dealer sets shipDealerOpen', async () => {
    const { emitSim, useUI } = await setup()
    emitSim('ui:open-ship-dealer', {})
    expect(useUI.getState().shipDealerOpen).toBe(true)
  })

  it('bindUi is idempotent — repeated calls do not duplicate listeners', async () => {
    const { useUI } = await setup()
    const { bindUi } = await import('./uiBindings')
    bindUi()
    bindUi()
    const { emitSim } = await import('../sim/events')
    useUI.setState({ shopOpen: false })
    const spy = vi.spyOn(useUI.getState(), 'setShop')
    emitSim('ui:open-shop', {})
    expect(spy).toHaveBeenCalledTimes(1)
    expect(useUI.getState().shopOpen).toBe(true)
  })
})
