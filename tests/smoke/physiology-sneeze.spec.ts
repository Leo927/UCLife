// Sneeze-emote smoke. Drives the worldspace cough/sneeze glyph through
// __uclife__ debug handles under the deterministic ?test=1 boot.
// Coverage:
//   - spawn an infectious NPC next to the player (already symptomatic)
//   - confirm the renderer picked them up (one entry in the glyph registry)

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const CARRIER_NAME = '咳嗽李明'
const CARRIER_DX_TILES = 0.5
const CARRIER_DY_TILES = 0

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.sneezeEmoteEntities',
  '__uclife__.physiologySpawnInfectedNPC',
]

test('sneeze-emote glyph appears for nearby infectious carrier', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const before = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.sneezeEmoteEntities(),
  )
  expect(Array.isArray(before), 'sneezeEmoteEntities did not return an array').toBeTruthy()
  expect(before.length, `expected empty registry pre-spawn, got ${before.length}`).toBe(0)

  const carrier = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p) => (window as any).__uclife__.physiologySpawnInfectedNPC('flu', p.name, p.dx, p.dy),
    { name: CARRIER_NAME, dx: CARRIER_DX_TILES, dy: CARRIER_DY_TILES },
  )
  expect(carrier?.key, 'failed to spawn infectious carrier NPC').toBeTruthy()

  await sim.page.waitForFunction(
    (k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = (window as any).__uclife__.sneezeEmoteEntities()
      return Array.isArray(arr) && arr.includes(k)
    },
    carrier.key,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.sneezeEmoteEntities(),
  )
  expect(after.length, `expected exactly one registered carrier`).toBe(1)
})
