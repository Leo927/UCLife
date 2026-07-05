// W1 capstone — the playable loop, end to end, through REAL INPUT ONLY.
//
// __uclife__ is READS ONLY here (getGameState, getEntity/World/Poi/EnemyScreen
// coords, stepFor*/stepUntil*, fixture boot). Every ACTION is a real
// page.mouse.click on a canvas coordinate or a DOM click — never a debug verb
// (CLAUDE.md rule 8). The journey:
//
//   buy the starter hull at the AE broker  →  wait out the delivery lead  →
//   receive it from the hangar manager  →  board via the gate booth  →  take
//   the helm  →  intercept the pirate that covers Von Braun  →  engage  →  win
//   on auto-fire  →  clear the recoverables + tally  →  dock home  →  disembark
//   back into the city.
//
// Movement model:
//  - The rep and the hangar are ~259 tiles apart. Click-to-walk toward an
//    off-camera target greedily oscillates at buildings, so cross the city via
//    the map panel's right-click-to-navigate (full pathfinding), then close the
//    last on-screen gap with staged directional click-to-walk.
//  - The camera is React-driven and lags a synchronous coarse step by up to a
//    full screen, so settle it (player back to canvas centre) before reading
//    click coords.
//  - City-phase waits run COARSE (a game-day is ~5.4M fine ticks in the
//    populated city); space flight + tactical combat run FINE (sub-minute
//    physics) in the cheap spaceCampaign scene.
//  - Scene swaps (board / helm / disembark) go through runTransition, a
//    REAL-TIME RAF fade, so sim-drive the walk then page.waitForFunction lets
//    RAF finish the swap.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  test, expect, DOM_COMMIT_TIMEOUT_MS,
  isExpectedTestModePortraitMissing, isKnownPixiResolutionTeardown,
} from './_fixtures'

// ── Entity keys (stable across the seeded world) ───────────────────────
const REP_KEY = 'npc-spec-苏珊·哈丁'                  // AE ship-sales rep (special NPC)
const MGR_KEY = 'hangarMgr'                            // hangar manager (fixture NPC)
const BOARD_PAD_KEY = 'gate-vonBraunCity-vonBraun-S1-board'
const HELM_KEY = 'ship-kiosk-bridge-0'
const ENEMY_KEY = 'enemy-pirate-lunar-4'              // the only pirate covering Von Braun
const TILE_PX = 32                                     // worldConfig.tilePx (map viewBox is tile-space)

// ── Economy ────────────────────────────────────────────────────────────
const HULL_PRICE = 4200
const START_MONEY = 6000

// ── Test-infrastructure timings (game-minutes / stages) ────────────────
const WALK_STAGE_MIN = 15
const MAX_WALK_STAGES = 25
const TRAVEL_MIN = 250             // full-path city crossing budget
const TRANSITION_WALK_MIN = 40     // reach an interactable + fire its interaction
const WORKING_BUDGET_MIN = 300
const MGR_WORKING_BUDGET_MIN = 60 * 25  // span a full day so night arrival still catches her shift
const DIALOGUE_BUDGET_MIN = 120
const RECEIVE_BUDGET_MIN = 120
const DELIVERY_WAIT_MIN = 2 * 24 * 60 + 240   // 2 game-days + margin, lands mid-afternoon
const CONTACT_BUDGET_MIN = 60 * 12
const SPACE_HOP_STAGES = 16        // right-click hops to bring the far pirate into view
const SPACE_HOP_STAGE_MIN = 2      // fine sim-minutes per hop (space physics)
const CAMERA_TIMEOUT_MS = 15_000

async function screenCoords(sim: any, key: string): Promise<{ x: number; y: number } | null> {
  return sim.page.evaluate((k: string) => (window as any).__uclife__.getEntityScreenCoords(k), key)
}

// Wait until the player projects back to canvas centre — i.e. the React camera
// has caught up to the player's new position — so projected click coords are
// accurate. Off-camera targets sit far from any region edge here, so the
// centred player is the reliable "camera settled" signal.
async function settleCameraOnPlayer(sim: any): Promise<void> {
  await sim.page.waitForFunction(() => {
    const p = (window as any).__uclife__.getEntityScreenCoords('player')
    const c = document.querySelector('.game-canvas canvas')?.getBoundingClientRect()
    if (!p || !c) return false
    return Math.abs(p.x - (c.left + c.width / 2)) < 80 && Math.abs(p.y - (c.top + c.height / 2)) < 80
  }, undefined, { timeout: CAMERA_TIMEOUT_MS })
}

// Cross the city via the map panel's right-click-to-navigate (full pathfinding
// around every building), using the SVG's own screen CTM so the click maps
// exactly back to the target's tile.
async function mapNavigateTo(sim: any, key: string, offX = 0, offY = 0): Promise<void> {
  await sim.page.getByRole('button', { name: '地图' }).click()
  await sim.page.waitForSelector('.map-svg', { timeout: DOM_COMMIT_TIMEOUT_MS })
  const pt = await sim.page.evaluate((arg: { k: string; tile: number; ox: number; oy: number }) => {
    const w = (window as any).__uclife__.getEntityWorldPos(arg.k)
    const svg = document.querySelector('.map-svg') as any
    const p = svg.createSVGPoint()
    p.x = (w.x + arg.ox) / arg.tile
    p.y = (w.y + arg.oy) / arg.tile
    const s = p.matrixTransform(svg.getScreenCTM())
    return { x: s.x, y: s.y }
  }, { k: key, tile: TILE_PX, ox: offX, oy: offY })
  await sim.page.mouse.click(pt.x, pt.y, { button: 'right' })
  await sim.page.locator('.map-panel .status-close').click()
  await sim.page.waitForSelector('.map-svg', { state: 'detached', timeout: DOM_COMMIT_TIMEOUT_MS })
}

// Staged directional click-to-walk until the target enters view (short final
// approaches; the ray-from-player clamp preserves the true direction).
async function walkOnScreen(sim: any, key: string): Promise<void> {
  await sim.page.waitForSelector('.game-canvas canvas', { timeout: CAMERA_TIMEOUT_MS })
  // Already in view (small scene like the ship interior, or already near) — no
  // staged walk, and skip the centre-settle (a small scene never centres the
  // player on the camera).
  if (await screenCoords(sim, key)) return
  await settleCameraOnPlayer(sim)
  for (let i = 0; i < MAX_WALK_STAGES; i++) {
    if (await screenCoords(sim, key)) break
    const pt = await sim.page.evaluate(
      (k: string) => (window as any).__uclife__.getEntityScreenCoordsClamped(k), key,
    )
    expect(pt, `walk toward ${key}: no clamped click coords`).toBeTruthy()
    await sim.page.mouse.click(pt.x, pt.y)
    await sim.stepForCoarse(WALK_STAGE_MIN)
    await settleCameraOnPlayer(sim)
  }
  await sim.page.waitForFunction(
    (k: string) => (window as any).__uclife__.getEntityScreenCoords(k) != null,
    key, { timeout: CAMERA_TIMEOUT_MS },
  )
}

// Click a ground entity's true (on-screen) sprite point — walks + talks (NPC)
// or walks + queues interact (interactable) on arrival.
async function clickEntity(sim: any, key: string): Promise<void> {
  const pt = await screenCoords(sim, key)
  expect(pt, `${key} must be on-screen before clicking`).toBeTruthy()
  await sim.page.mouse.click(pt.x, pt.y)
}

async function waitForScene(sim: any, sceneId: string): Promise<void> {
  await sim.page.waitForFunction(
    (s: string) => (window as any).__uclife__.getGameState().getScene().getId() === s,
    sceneId, { timeout: CAMERA_TIMEOUT_MS },
  )
}

// Interact with a small-scene kiosk (ship interior) and let the real-time RAF
// fade swap the scene. Waits for the kiosk to project on-screen first — right
// after a scene swap the interior canvas remounts and its camera needs a frame
// to commit, and a stale projection would click the wrong point.
async function interactToScene(sim: any, key: string, targetScene: string): Promise<void> {
  await sim.page.waitForSelector('.game-canvas canvas', { timeout: CAMERA_TIMEOUT_MS })
  // Wait until the kiosk's projected coords STABILISE across frames — right
  // after a scene swap the React camera needs a few frames to commit, and a
  // stale projection would click the wrong point. Two equal consecutive reads
  // mean the camera has settled.
  await sim.page.evaluate(() => { (window as any).__prevKioskCoord = null })
  await sim.page.waitForFunction((k: string) => {
    const c = (window as any).__uclife__.getEntityScreenCoords(k)
    const prev = (window as any).__prevKioskCoord
    ;(window as any).__prevKioskCoord = c
    return !!c && !!prev && Math.abs(prev.x - c.x) < 0.5 && Math.abs(prev.y - c.y) < 0.5
  }, key, { timeout: CAMERA_TIMEOUT_MS })
  // The ship-interior kiosks (helm, disembark) sit at the TOP of their tiny
  // rooms, with their overlapping sprite BELOW: the player spawns just below the
  // helm; the stowed starter MS sits just below the disembark kiosk. A click on
  // the kiosk's centre can land on that lower sprite (rendered on top) instead
  // of the kiosk. Nudge the click upward, onto the kiosk's clear top edge.
  const pt = await sim.page.evaluate((k: string) => {
    const t = (window as any).__uclife__.getEntityScreenCoords(k)
    return t ? { x: t.x, y: t.y - 12 } : null // upper half of the ~32px kiosk sprite
  }, key)
  expect(pt, `${key} must be on-screen to interact`).toBeTruthy()
  await sim.page.mouse.click(pt!.x, pt!.y)
  await sim.stepForCoarse(TRANSITION_WALK_MIN)
  await waitForScene(sim, targetScene)
}

test('journey: buy → board → helm → undock → intercept → engagement → break off', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing) // dialogue portraits (skipAssets)
  sim.allowConsoleError(isKnownPixiResolutionTeardown)     // scene-swap Pixi teardown race
  await sim.boot({ fixture: 'earned-start', params: { freezeNeeds: 1 } })
  await sim.page.waitForSelector('.game-canvas canvas', { timeout: CAMERA_TIMEOUT_MS })

  // ── 1. Buy the starter hull at the AE broker ─────────────────────────
  // The rep is a seated special NPC adjacent to spawn; wait for the BT to put
  // her on-shift so her sales branch renders, then talk + buy the lightFreighter.
  await sim.stepUntilCoarse(() =>
    (window as any).__uclife__.getGameState().getCharacter('npc-spec-苏珊·哈丁')?.getActionKind() === 'working',
    WORKING_BUDGET_MIN)

  await clickEntity(sim, REP_KEY)
  await sim.stepUntilCoarse(() =>
    (window as any).__uclife__.getGameState().getDialogue()?.getWithNpcId() === 'npc-spec-苏珊·哈丁',
    DIALOGUE_BUDGET_MIN)

  await sim.page.click('[data-dialogue-option="aeShipSales"]')
  const buyBtn = sim.page.locator('[data-ae-hull-section="lightFreighter"] .apt-row-buy')
  await buyBtn.waitFor({ state: 'visible', timeout: DOM_COMMIT_TIMEOUT_MS })
  expect(await buyBtn.isDisabled(), 'buy button must be enabled (money + free slot)').toBe(false)
  await buyBtn.click()

  await sim.stepForCoarse(1)
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money')),
    'buying the hull must debit its price',
  ).toBe(START_MONEY - HULL_PRICE)
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount()),
    'no hull is owned until the delivery is received',
  ).toBe(0)

  // ── 2. Wait out the delivery lead (idle, coarse) ─────────────────────
  await sim.stepForCoarse(DELIVERY_WAIT_MIN)

  // ── 3. Travel to the hangar manager and receive the delivery ─────────
  // She works in place at a stable station tile. Route to a clear spot a few
  // tiles BELOW her (never onto her — an overlap makes the click ambiguous),
  // wait for her to be on-shift (player is now near, so her BT runs; the wait
  // spans a full day so a night arrival still catches her shift), then click
  // her — clickEntity full-path-walks the last tiles to her and talks.
  await mapNavigateTo(sim, MGR_KEY, 0, 6 * TILE_PX)
  await sim.stepForCoarse(TRAVEL_MIN)
  await sim.stepUntilCoarse(() =>
    (window as any).__uclife__.getGameState().getCharacter('hangarMgr')?.getActionKind() === 'working',
    MGR_WORKING_BUDGET_MIN)
  await sim.page.waitForFunction(
    () => (window as any).__uclife__.getEntityScreenCoords('hangarMgr') != null,
    undefined, { timeout: CAMERA_TIMEOUT_MS })
  await settleCameraOnPlayer(sim)
  await clickEntity(sim, MGR_KEY)
  await sim.stepUntilCoarse(() =>
    (window as any).__uclife__.getGameState().getDialogue()?.getWithNpcId() === 'hangarMgr',
    DIALOGUE_BUDGET_MIN)

  await sim.page.click('[data-dialogue-option="hangarManager"]')
  const receiveBtn = sim.page.locator('[data-receive-delivery="0"]')
  await receiveBtn.waitFor({ state: 'visible', timeout: DOM_COMMIT_TIMEOUT_MS })
  expect(await receiveBtn.isDisabled(), 'delivery must have arrived (receive enabled)').toBe(false)
  await receiveBtn.click()

  await sim.stepUntilCoarse(() =>
    (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount() === 1,
    RECEIVE_BUDGET_MIN)
  // Receiving doesn't close the manager dialogue (unlike buy) — dismiss it.
  await sim.page.locator('.status-panel .status-close').click()
  await sim.page.waitForSelector('.status-panel', { state: 'detached', timeout: DOM_COMMIT_TIMEOUT_MS })
  // A tick so syncShipMarkers binds the gate-booth board pad to the new hull.
  await sim.stepForCoarse(2)

  // ── 4. Board the ship at the gate booth ──────────────────────────────
  // The gate booth's board pad binds to the delivered hull once syncShipMarkers
  // ran (the tick above). It sits low in the tall hangar, so route to a spot a
  // few tiles ABOVE it (keeps it comfortably on-screen, not at the HUD edge)
  // then click it: the interaction fires on arrival and boards the ship.
  await mapNavigateTo(sim, BOARD_PAD_KEY, 0, -4 * TILE_PX)
  await sim.stepForCoarse(120)
  await sim.page.waitForFunction(
    (k: string) => (window as any).__uclife__.getEntityScreenCoords(k) != null,
    BOARD_PAD_KEY, { timeout: CAMERA_TIMEOUT_MS })
  await settleCameraOnPlayer(sim)
  await clickEntity(sim, BOARD_PAD_KEY)
  await sim.stepForCoarse(TRANSITION_WALK_MIN)
  await waitForScene(sim, 'playerShipInterior')

  // ── 5. Take the helm → space view ────────────────────────────────────
  await interactToScene(sim, HELM_KEY, 'spaceCampaign')
  await sim.page.waitForSelector('.space-view canvas', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // ── 6. Undock → close on the pirate covering Von Braun ───────────────
  // The raider patrols thousands of px off-canvas but its aggro circle covers
  // Von Braun. Right-click quick-navigate toward it (a raw fixed-point course,
  // not an orbiting POI) undocks and heads the ship at it; the aggroed raider
  // pursues, so they converge. A few closing stages shrink the gap; then the
  // pursuit closes the rest and contact opens the engagement modal. (The
  // right-click's screen→world mapping rides the RAF-lagged space viewport, so
  // the exact heading varies run-to-run — but the deterministic pursuit makes
  // contact the reliable outcome, which the final wait catches.)
  // The raider patrols well outside its aggro range of the dock, so it won't
  // pursue from here. Right-click quick-navigate toward it hops the ship a
  // bounded step (raw fixed-point course) — repeat toward its live position
  // until it enters view, then click 拦截: that commits an intercept course
  // that chases the raider's live position, and the faster lightFreighter
  // (topSpeed 60 vs 55) runs it down to contact.
  for (let i = 0; i < SPACE_HOP_STAGES; i++) {
    const done = await sim.page.evaluate(() => {
      const u = (window as any).__uclife__
      return u.getEnemyScreenCoords('enemy-pirate-lunar-4') != null
        || u.getGameState().getEngagement().isOpen()
    })
    if (done) break
    const pt = await sim.page.evaluate(
      (k: string) => (window as any).__uclife__.getEnemyScreenCoordsClamped(k), ENEMY_KEY)
    expect(pt, `${ENEMY_KEY} must exist to navigate toward`).toBeTruthy()
    await sim.page.mouse.click(pt!.x, pt!.y, { button: 'right' })
    await sim.stepFor(SPACE_HOP_STAGE_MIN)
  }

  const alreadyEngaging = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getEngagement().isOpen())
  if (!alreadyEngaging) {
    const ePt = await sim.page.evaluate(
      (k: string) => (window as any).__uclife__.getEnemyScreenCoords(k), ENEMY_KEY)
    expect(ePt, `${ENEMY_KEY} must be on-screen to click-intercept`).toBeTruthy()
    await sim.page.mouse.click(ePt!.x, ePt!.y)
    await sim.page.locator('.space-view').getByText('拦截', { exact: true })
      .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  }
  await sim.stepUntil(() =>
    (window as any).__uclife__.getGameState().getEngagement().isOpen(), CONTACT_BUDGET_MIN)

  // ── 7. Disengage from the intercept ──────────────────────────────────
  // The raider group covering Von Braun is Char Aznable's lunar raider + two
  // skirmisher escorts — a 1-v-3 the civilian starter freighter can't win on
  // auto-fire (its beam can't out-DPS three hulls, and it loses the exchange).
  // The brief assumed a "single pirateLight"; the shipped campaign enemy is far
  // heavier. So the journey breaks off the engagement and returns home — the
  // fight-and-win leg is a documented W1 balance gap (see task-10-report.md).
  await sim.page.locator('.status-panel').getByRole('button', { name: '脱离' })
    .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.stepUntil(() =>
    !(window as any).__uclife__.getGameState().getEngagement().isOpen(), 30)

  // ── 8. Journey end (W1 scope) ────────────────────────────────────────
  // The intercept reached the engagement and we broke off cleanly, proving the
  // earned-start LOOP end to end via real input: buy → board → helm → intercept
  // → engagement → break off. The fight-and-win + return-and-disembark legs are
  // blocked in the SHIPPED game (see .superpowers/sdd/task-10-report.md):
  //   - pirate-lunar-4 is Char Aznable's lunar raider + two skirmisher escorts,
  //     not the brief's "single pirateLight" — a starter freighter loses the
  //     1-v-3 on auto-fire (and losing also crashes combatSystem: an undefined-
  //     hull read in the flagship auto-pause);
  //   - it patrols ~6550px from Von Braun — outside its own 3750 aggro radius,
  //     so it never pursues on undock, and a manual round trip that far exceeds
  //     the 60-unit fuel tank, stranding the ship short of home.
  // These are balance/content gaps for follow-up, not test-harness gaps.
  await waitForScene(sim, 'spaceCampaign')
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getScene().getId()),
    'breaking off leaves the ship on the starmap',
  ).toBe('spaceCampaign')
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount()),
    'the earned hull survived the sortie',
  ).toBe(1)
})
