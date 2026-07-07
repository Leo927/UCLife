// W4.1 — crew live aboard the flagship. System smoke (debug verbs allowed):
// boots a crewed flagship, asserts the roster is bodied in the ship-interior
// world with each key resolving to exactly one world, survives a save/load
// round-trip on that invariant, and drops a body when a crew member is fired.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  '__uclife__.fireCrewMemberViaDebug',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

function readCrewWorlds(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const gs = (window as Win).__uclife__.getGameState()
    const ship = gs.getShip('flagship')
    const captain = ship.getCaptain()
    const crew = ship.getCrew()
    return {
      captainScene: captain ? captain.getPosition().scene : null,
      captainWorlds: captain ? gs.getEntitySceneIds(captain.getId()) : [],
      crew: crew.map((c: Win) => ({
        id: c.getId(),
        scene: c.getPosition().scene,
        worlds: gs.getEntitySceneIds(c.getId()),
      })),
    }
  })
}

test('crew live aboard the flagship, survive save/load, and leave on fire', async ({ sim }) => {
  await sim.boot({ fixture: 'crew-aboard', requireHandles: REQUIRED_HANDLES })

  // Bodies materialized aboard by ship seeding — captain + 2 crew, each in
  // exactly one world (the ship interior).
  const before = await readCrewWorlds(sim.page)
  expect(before.captainScene, 'captain body lives in the ship interior').toBe('playerShipInterior')
  expect(before.captainWorlds, 'captain resolves to exactly one world').toEqual(['playerShipInterior'])
  expect(before.crew.length, 'two crew bodies aboard').toBe(2)
  for (const c of before.crew) {
    expect(c.scene, `${c.id} lives in the ship interior`).toBe('playerShipInterior')
    expect(c.worlds, `${c.id} resolves to exactly one world`).toEqual(['playerShipInterior'])
  }

  // Save → reload: the invariant must hold with no duplicate/orphan.
  await sim.page.evaluate(async () => { await (window as Win).__uclife__.saveGame('auto') })
  await sim.page.evaluate(async () => { await (window as Win).__uclife__.loadGame('auto') })
  await sim.waitForBoot(REQUIRED_HANDLES)

  const after = await readCrewWorlds(sim.page)
  expect(after.captainWorlds, 'captain still resolves to one world after reload').toEqual(['playerShipInterior'])
  expect(after.crew.length, 'both crew still aboard after reload').toBe(2)
  for (const c of after.crew) {
    expect(c.worlds, `${c.id} resolves to exactly one world after reload`).toEqual(['playerShipInterior'])
  }

  // Fire a crew member → their body leaves the ship, roster tracks.
  await sim.page.evaluate(() => (window as Win).__uclife__.fireCrewMemberViaDebug('flagship', 'npc-crew-2'))
  await sim.stepFor(1)

  const fired = await sim.page.evaluate(() => {
    const gs = (window as Win).__uclife__.getGameState()
    return {
      crewCount: gs.getShip('flagship').getCrew().length,
      firedWorlds: gs.getEntitySceneIds('npc-crew-2'),
    }
  })
  expect(fired.crewCount, 'roster dropped the fired crew member').toBe(1)
  expect(fired.firedWorlds, 'fired crew body removed from every world').toEqual([])
})
