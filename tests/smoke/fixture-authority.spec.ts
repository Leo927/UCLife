/**
 * Drives `?test=1&fixture=minimal-player-only` end-to-end and asserts the
 * fixture's player state lands authoritatively: money, position, skills,
 * and scene all come from the fixture, not the default boot spawn that
 * bootTestMode used to leave behind.
 */
import { test, expect } from './_fixtures'

const TILE_PX = 32
const EXPECT_MONEY = 1234
const EXPECT_PILOTING = 42
const EXPECT_TILE = { x: 10, y: 12 }

test('fixture player state takes precedence over default boot spawn', async ({ sim }) => {
  await sim.boot({ fixture: 'minimal-player-only' })

  const snap = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gs = (window as any).__uclife__.getGameState()
    const p = gs.getPlayerCharacter()
    return {
      money: p.getResource('Money'),
      piloting: p.getStat('piloting'),
      pos: p.getPosition(),
    }
  })

  expect(
    snap.money,
    `player.Money = ${snap.money}, want ${EXPECT_MONEY} (fixture player.money) — default boot spawn likely shadowing fixture`,
  ).toBe(EXPECT_MONEY)
  expect(snap.piloting, `player.piloting = ${snap.piloting}`).toBe(EXPECT_PILOTING)
  expect(snap.pos.x).toBe(EXPECT_TILE.x * TILE_PX)
  expect(snap.pos.y).toBe(EXPECT_TILE.y * TILE_PX)
  expect(snap.pos.scene).toBe('vonBraunCity')
})
