// W4.3b — on-ship hangar deck surface. System smoke (debug verbs allowed):
// boots a crewed flagship whose fourth roster member is stationed at the
// hangar bay (the hangar boss), and asserts the hangar-deck talk surface
// (forward repair + MS load/unload) gates on isHangarBossOnDuty — it surfaces
// on the hangar boss and NOT on a non-hangar crew member. Drives the real
// dialogue builder via hireBranchListing (no React render). The load/unload
// verbs themselves are covered by ms-custody.spec.ts; the resupply-crew-stat
// and repair-band logic by src/sim/sortieResupply.test.ts +
// src/systems/onShipRepair.test.ts.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Win = any

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.hireBranchListing',
]

const HANGAR_DECK_BRANCH = 'hangarBoss'

function branchIds(page: import('@playwright/test').Page, npcKey: string): Promise<string[]> {
  return page.evaluate((k) => (window as Win).__uclife__.hireBranchListing(k), npcKey)
}

test('the on-ship hangar-deck surface gates on the hangar boss', async ({ sim }) => {
  await sim.boot({ fixture: 'hangar-deck', requireHandles: REQUIRED_HANDLES })

  // The fourth roster member (npc-crew-4) fills the lightFreighter's hangar-bay
  // duty station → it is the ship's hangar boss.
  expect(
    await sim.page.evaluate(() =>
      (window as Win).__uclife__.getGameState().getCharacter('npc-crew-4')?.getCrewDuty() ?? null),
    'the hangar-bay crew body exists aboard',
  ).not.toBeNull()

  const bossBranches = await branchIds(sim.page, 'npc-crew-4')
  expect(bossBranches, 'the hangar-deck surface appears on the hangar boss')
    .toContain(HANGAR_DECK_BRANCH)

  // A crew member stationed elsewhere (engine room) is not the hangar boss.
  const nonBossBranches = await branchIds(sim.page, 'npc-crew-2')
  expect(nonBossBranches, 'the hangar-deck surface does NOT appear on a non-hangar crew member')
    .not.toContain(HANGAR_DECK_BRANCH)
})
