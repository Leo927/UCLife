// W4.2 — furnished crew quarters + mess, used by player and crew. System
// smoke (debug verbs allowed): boots a furnished, docked flagship and proves
//   1. the player free-claims a crew bunk (no realtor) and sleeps → fatigue
//      recovers; eats at the mess → hunger recovers;
//   2. a crew NPC reports to the mess in a meal window and eats, drawing the
//      SHARED ship supply pool (not personal inventory); and off-duty with
//      high fatigue claims a crew bunk (findBestOpenBed) and sleeps.
//
// Single bodies only (one player, one crew) — no multi-body door contention.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Win = any

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.interactableTileByKind',
  '__uclife__.movePlayerTo',
  '__uclife__.queueInteract',
  '__uclife__.setPlayerVital',
  '__uclife__.setNpcVitalByKey',
  '__uclife__.forceShipDocking',
  '__uclife__.setGameHour',
  '__uclife__.fleetFuelPool',
]

const CREW_KEY = 'npc-crew-1'

function playerVital(page: import('@playwright/test').Page, key: string): Promise<number> {
  return page.evaluate(
    (k) => (window as Win).__uclife__.getGameState().getPlayerCharacter().getResource(k),
    key,
  )
}

function playerAction(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() =>
    (window as Win).__uclife__.getGameState().getPlayerCharacter().getActionKind())
}

function crewAction(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() =>
    (window as Win).__uclife__.getGameState().getCharacter('npc-crew-1')?.getActionKind() ?? null)
}

function fleetSupply(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as Win).__uclife__.fleetFuelPool().supplyCurrent)
}

test('player free-claims a crew bunk to sleep aboard the flagship', async ({ sim }) => {
  await sim.boot({ fixture: 'ship-furnished', requireHandles: REQUIRED_HANDLES })

  expect(
    await sim.page.evaluate(() => (window as Win).__uclife__.getGameState().getScene().getId()),
    'ship-furnished boots the player aboard the flagship interior',
  ).toBe('playerShipInterior')

  await sim.page.evaluate(() => (window as Win).__uclife__.setPlayerVital('fatigue', 80))
  const bunkTile = await sim.page.evaluate(
    () => (window as Win).__uclife__.interactableTileByKind('sleep'))
  expect(bunkTile, 'crew quarters must carry a usable bunk (sleep kiosk)').toBeTruthy()

  await sim.page.evaluate((t: { x: number; y: number }) =>
    (window as Win).__uclife__.movePlayerTo(t.x, t.y), bunkTile)
  await sim.page.evaluate(() => (window as Win).__uclife__.queueInteract())
  await sim.stepUntil(() =>
    (window as Win).__uclife__.getGameState().getPlayerCharacter().getActionKind() === 'sleeping', 5)
  expect(await playerAction(sim.page), 'ship bunk is a free-claim sleep (not a realtor toast)').toBe('sleeping')

  const fatigueBefore = await playerVital(sim.page, 'fatigue')
  await sim.stepFor(30)
  const fatigueAfter = await playerVital(sim.page, 'fatigue')
  expect(fatigueAfter, 'sleeping in a bunk recovers fatigue').toBeLessThan(fatigueBefore)
})

test('player eats at the ship mess to recover hunger', async ({ sim }) => {
  await sim.boot({ fixture: 'ship-furnished', requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(() => (window as Win).__uclife__.setPlayerVital('hunger', 80))
  const messTile = await sim.page.evaluate(
    () => (window as Win).__uclife__.interactableTileByKind('eat'))
  expect(messTile, 'the mess must carry an eat station').toBeTruthy()

  await sim.page.evaluate((t: { x: number; y: number }) =>
    (window as Win).__uclife__.movePlayerTo(t.x, t.y), messTile)
  await sim.page.evaluate(() => (window as Win).__uclife__.queueInteract())
  await sim.stepUntil(() =>
    (window as Win).__uclife__.getGameState().getPlayerCharacter().getActionKind() === 'eating', 5)
  expect(await playerAction(sim.page), 'the mess eat station drives the eating action').toBe('eating')

  const hungerBefore = await playerVital(sim.page, 'hunger')
  await sim.stepFor(20)
  const hungerAfter = await playerVital(sim.page, 'hunger')
  expect(hungerAfter, 'eating at the mess recovers hunger').toBeLessThan(hungerBefore)
})

test('crew eat at the mess drawing ship supply, and bunk down off-duty', async ({ sim }) => {
  await sim.boot({ fixture: 'ship-furnished', requireHandles: REQUIRED_HANDLES })

  // Docked + a meal window + a hungry crew member → report to the mess and
  // eat, drawing the shared fleet supply pool.
  await sim.page.evaluate(() => (window as Win).__uclife__.forceShipDocking('flagship', 'vonBraun'))
  await sim.page.evaluate(() => (window as Win).__uclife__.setGameHour(7))
  await sim.page.evaluate(() => (window as Win).__uclife__.setNpcVitalByKey('npc-crew-1', 'hunger', 85))

  const supplyBefore = await fleetSupply(sim.page)
  expect(supplyBefore, 'fleet supply pool seeded at boot').toBeGreaterThan(0)

  await sim.stepUntil(() =>
    (window as Win).__uclife__.getGameState().getCharacter('npc-crew-1')?.getActionKind() === 'eating', 90)
  expect(await crewAction(sim.page), 'crew report to the mess and eat in a meal window').toBe('eating')

  const supplyAfter = await fleetSupply(sim.page)
  expect(supplyAfter, 'a crew meal draws the shared ship supply pool').toBeLessThan(supplyBefore)

  // Off-duty (no meal / no sleep window) + high fatigue → claim a crew bunk
  // (findBestOpenBed returns the rent-free 'bunk') and sleep in it.
  await sim.page.evaluate(() => (window as Win).__uclife__.setGameHour(10))
  await sim.page.evaluate(() => (window as Win).__uclife__.setNpcVitalByKey('npc-crew-1', 'fatigue', 90))
  await sim.stepUntil(() =>
    (window as Win).__uclife__.getGameState().getCharacter('npc-crew-1')?.getActionKind() === 'sleeping', 90)
  expect(await crewAction(sim.page), 'off-duty crew claim a crew bunk and sleep').toBe('sleeping')
})
