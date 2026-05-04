import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ecs/spawn', () => ({
  setupWorld: vi.fn(),
}))
vi.mock('../sim/loop', () => ({
  startLoop: vi.fn(),
}))

describe('bootstrapApp', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls setupWorld then startLoop in order', async () => {
    const { setupWorld } = await import('../ecs/spawn')
    const { startLoop } = await import('../sim/loop')
    const { bootstrapApp } = await import('./lifecycle')

    bootstrapApp()

    expect(setupWorld).toHaveBeenCalledTimes(1)
    expect(startLoop).toHaveBeenCalledTimes(1)
    const setupOrder = (setupWorld as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]
    const loopOrder = (startLoop as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]
    expect(setupOrder).toBeLessThan(loopOrder)
  })

  it('is idempotent — repeated calls do not re-invoke setupWorld or startLoop', async () => {
    const { setupWorld } = await import('../ecs/spawn')
    const { startLoop } = await import('../sim/loop')
    const { bootstrapApp } = await import('./lifecycle')

    bootstrapApp()
    bootstrapApp()
    bootstrapApp()

    expect(setupWorld).toHaveBeenCalledTimes(1)
    expect(startLoop).toHaveBeenCalledTimes(1)
  })
})
