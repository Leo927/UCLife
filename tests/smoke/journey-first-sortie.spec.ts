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
const DISEMBARK_KEY = 'ship-kiosk-hangarBay-0'        // 下船 kiosk in the ship hangar bay
const ENEMY_KEY = 'enemy-pirate-lunar-starter'        // the sole weak pirate covering Von Braun
const COMBAT_ENEMY_KEY = 'enemy-ship-0'               // its tactical-arena slot-0 CombatShipState (combat.ts spawns enemy-ship-${idx})
const DOCK_POI = 'vonBraun'
const TILE_PX = 32                                     // worldConfig.tilePx (map viewBox is tile-space)

// ── Command layer (W2) ─────────────────────────────────────────────────
const ORDER_COST_FOCUS_FIRE = 1                        // fleetConfig.commandPoints.orderCosts.focusFire

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
const SPACE_HOP_STAGES = 24        // right-click hops to bring the pirate into view
const SPACE_HOP_STAGE_MIN = 0.2    // fine sim-minutes per hop — short steps keep the
                                   // ship inside the close starter's aggro so it keeps
                                   // chasing instead of the ship overshooting past it
const CAMERA_TIMEOUT_MS = 15_000
const COMBAT_DRIVE_STAGES = 20     // resume-and-advance stages (fight resolves in ~1)
const COMBAT_STAGE_MIN = 1         // fine sim-minutes per stage (~3750 tactical ticks)
const DOCK_HOP_STAGES = 30         // right-click hops to close on static VB
const DOCK_HOP_STAGE_MIN = 0.1     // per-hop step; VB doesn't chase back
const DOCK_BUDGET_MIN = 60 * 12    // fly-home + autodock budget
const JOURNEY_TIMEOUT_MS = 200_000  // whole end-to-end loop + MS sortie leg headroom past the 60s default
const KIOSK_INTERACT_TRIES = 5      // re-issue a kiosk interact until the scene swaps

// ── W3 MS-sortie leg ────────────────────────────────────────────────────
// The engagement has a hard clock: with every mount armed (#165), the AI
// flagship one-shots the 600-effective-HP picket within a few cumulative
// unpaused tactical seconds (slow-charge heavy mount), resolving the fight
// and tearing the tactical world down. So the MS leg cannot wait on any
// war outcome (enemy damage, own ammo drain — the picket also usually sits
// beyond the ballistic gun's 180-unit range); it proves the sortie via the
// live cockpit HUD + real boost + a real 返航 dock, and must reach the dock
// gates in ~1-2 unpaused seconds. The dock loop velocity-matches the moving
// flagship in short deadbeat bursts; a piloted MS with no WASD held coasts
// (combat.ts zeroes both player and AI thrust), so reads stay consistent.
const MS_SPRITE_KEY = 'ms-sprite-ms-player-0'  // climbIntoMs sprite (refreshMsLayout) in the flagship hangar bay
const MS_CLIMB_TRIES = 6            // re-issue the climb interact until the cockpit HUD mounts
const MS_SORTIE_STAGES = 40         // read→burst iterations before giving up (a healthy run docks in <8)
const MS_BURST_MAX_MIN = 0.02       // ≤1.2 tactical-sec per burst — bounds unpaused war-time per iteration
const MS_BURST_MIN_MIN = 0.002      // ≥0.12 tactical-sec so a burst always advances real ticks
const MS_DOCK_RANGE_TARGET = 55     // < sortieConfig.dockApproachRadiusPx (80), margin for settle drift
const MS_DOCK_RELVEL_TARGET = 45    // < sortieConfig.dockApproachMaxRelVel (60), margin
const MS_STATION_KEEP_PX = 40       // approach target offset from the flagship — inside RANGE_TARGET
const MS_CLOSE_GAIN_PER_SEC = 1.5   // desired closing speed = gain × (range − target offset)
const MS_MAX_CLOSE_SPEED = 90       // < mobileWorker topSpeed (120) — headroom to also match flagship vel
const MS_ACCEL = 140                // mobileWorker accel (ms-classes.json5) — sizes the deadbeat burst length
const MS_VEL_DEADZONE = 6           // px/s; a velocity-error axis component below this isn't worth thrusting

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
  //
  // Clicking auto-walks to the kiosk then interacts on arrival — a multi-step
  // sequence a single coarse slice needn't finish, and a grazed click can miss
  // the small sprite entirely. Re-issue the interact until the scene swaps
  // (bounded): each pass re-reads the live kiosk coords and drives the walk a
  // little further, so the interaction reliably lands without masking a genuine
  // failure (the final waitForScene still fails loud if it never fires).
  for (let i = 0; i < KIOSK_INTERACT_TRIES; i++) {
    const swapped = await sim.page.evaluate(
      (s: string) => (window as any).__uclife__.getGameState().getScene().getId() === s, targetScene)
    if (swapped) return
    const pt = await sim.page.evaluate((k: string) => {
      const t = (window as any).__uclife__.getEntityScreenCoords(k)
      return t ? { x: t.x, y: t.y - 12 } : null // upper half of the ~32px kiosk sprite
    }, key)
    if (pt) await sim.page.mouse.click(pt.x, pt.y)
    await sim.stepForCoarse(TRANSITION_WALK_MIN)
  }
  await waitForScene(sim, targetScene)
}

// ── W3 MS-sortie leg helpers ──────────────────────────────────────────
// All of these are READS + REAL INPUT only (CLAUDE.md rule 8): __uclife__
// observes (getGameState, getPilotedMsState, getFlagshipCombatPose,
// combatEntities), and every state change is a real DOM/canvas/keyboard event.

// Read a tactical-combat store flag off the sanctioned getGameState façade.
async function combatFlag(sim: any, fn: 'isOpen' | 'isPaused'): Promise<boolean> {
  return sim.page.evaluate((f: string) =>
    (window as any).__uclife__.getGameState().getCombat()[f](), fn)
}

// Drive the tactical pause to `want` via the REAL Space key. Re-reads state
// first so a stray hull-threshold auto-pause can't desync a blind toggle —
// it only presses when the flag actually needs to flip, then confirms.
async function setTacticalPause(sim: any, want: boolean): Promise<void> {
  if (await combatFlag(sim, 'isPaused') === want) return
  await sim.page.keyboard.press('Space')
  await expect.poll(() => combatFlag(sim, 'isPaused'),
    { message: `Space must drive the tactical pause to ${want}` }).toBe(want)
}

async function msPose(sim: any): Promise<{ pos: { x: number; y: number }; vel: { x: number; y: number }; heading: number } | null> {
  return sim.page.evaluate(() => (window as any).__uclife__.getPilotedMsState())
}
async function flagshipPose(sim: any): Promise<{ pos: { x: number; y: number }; vel: { x: number; y: number }; heading: number } | null> {
  return sim.page.evaluate(() => (window as any).__uclife__.getFlagshipCombatPose())
}

// Decompose a world-space velocity-error vector into the MS's heading frame
// and return the WASD keys that thrust that way (combat.ts §1: forward unit =
// (cosH, sinH), starboard unit = (-sinH, cosH); TacticalView maps W/S → the
// forward axis ±, D/A → the starboard axis ±).
function thrustKeys(ex: number, ey: number, heading: number): string[] {
  const fwd = ex * Math.cos(heading) + ey * Math.sin(heading)
  const stf = -ex * Math.sin(heading) + ey * Math.cos(heading)
  const keys: string[] = []
  if (fwd > MS_VEL_DEADZONE) keys.push('KeyW')
  else if (fwd < -MS_VEL_DEADZONE) keys.push('KeyS')
  if (stf > MS_VEL_DEADZONE) keys.push('KeyD')
  else if (stf < -MS_VEL_DEADZONE) keys.push('KeyA')
  return keys
}

// Walk bridge → hangar (combat PAUSED so the AI flagship can't resolve the
// fight while the avatar is off the helm) and climb the starter MS sprite,
// re-issuing the interact until the cockpit HUD mounts (piloting='ms').
async function climbIntoHangarMs(sim: any): Promise<void> {
  await sim.page.waitForFunction(
    (k: string) => (window as any).__uclife__.getEntityScreenCoords(k) != null,
    MS_SPRITE_KEY, { timeout: CAMERA_TIMEOUT_MS })
  const gauge = sim.page.locator('[data-cockpit-gauge="propellant"]')
  for (let i = 0; i < MS_CLIMB_TRIES; i++) {
    if (await gauge.count() > 0) return
    const pt = await screenCoords(sim, MS_SPRITE_KEY)
    if (pt) await sim.page.mouse.click(pt.x, pt.y)
    await sim.stepForCoarse(TRANSITION_WALK_MIN)
  }
  await expect(gauge, 'climbing the hangar MS must open the cockpit HUD (piloting=ms)').toHaveCount(1)
}

// Dock loop. Reads happen PAUSED (frozen, self-consistent poses); each
// iteration applies one deadbeat velocity-matching burst: desired velocity =
// flagship velocity + a bounded closing component toward a point just off
// its hull, and the burst lasts ≈ |velocity error| / accel so a correction
// can never overshoot into oscillation (a fixed-length full-thrust burst at
// accel 140 swings ~168 px/s — more than any error it corrects). The moment
// both dock gates read inside their margins, 返航 is clicked for real.
// Docked = the tactical overlay closes (combat stays open on the AI
// flagship). See the MS-sortie constants block for why total unpaused time
// must stay this short.
async function flyMsToDock(sim: any): Promise<void> {
  const dockBtn = sim.page.locator('.tactical-topbar').getByRole('button', { name: /返航/ })
  for (let i = 0; i < MS_SORTIE_STAGES; i++) {
    const ms = await msPose(sim)
    const fs = await flagshipPose(sim)
    expect(ms && fs,
      'MS + flagship combat poses must stay readable — the engagement must not resolve during the MS leg').toBeTruthy()
    const dx = fs!.pos.x - ms!.pos.x
    const dy = fs!.pos.y - ms!.pos.y
    const range = Math.hypot(dx, dy)
    const relVel = Math.hypot(ms!.vel.x - fs!.vel.x, ms!.vel.y - fs!.vel.y)
    if (range <= MS_DOCK_RANGE_TARGET && relVel <= MS_DOCK_RELVEL_TARGET) {
      await dockBtn.click({ timeout: DOM_COMMIT_TIMEOUT_MS })
      if (await combatFlag(sim, 'isOpen') === false) return
      continue
    }
    const closing = Math.min(
      MS_MAX_CLOSE_SPEED, Math.max(0, range - MS_STATION_KEEP_PX) * MS_CLOSE_GAIN_PER_SEC)
    const ux = range > 0 ? dx / range : 0
    const uy = range > 0 ? dy / range : 0
    const ex = fs!.vel.x + ux * closing - ms!.vel.x
    const ey = fs!.vel.y + uy * closing - ms!.vel.y
    const keys = thrustKeys(ex, ey, ms!.heading)
    const burstMin = Math.min(
      MS_BURST_MAX_MIN, Math.max(MS_BURST_MIN_MIN, Math.hypot(ex, ey) / MS_ACCEL / 60))
    for (const k of keys) await sim.page.keyboard.down(k)
    await setTacticalPause(sim, false)
    await sim.stepFor(burstMin)
    await setTacticalPause(sim, true)
    for (const k of keys) await sim.page.keyboard.up(k)
  }
  expect(await combatFlag(sim, 'isOpen'),
    'the MS must dock (返航) back into the flagship within the sortie budget').toBe(false)
}

test('journey: buy → board → helm → intercept → engage → win → tally → dock home → disembark', async ({ sim }) => {
  // Full W1 loop through real input — city crossing + delivery wait + space
  // sortie + tactical fight + return runs long; give it headroom past the 60s
  // default so a slow-but-correct pass isn't clipped into a false failure.
  test.setTimeout(JOURNEY_TIMEOUT_MS)
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
  // The starter pirate patrols just off the Von Braun approach, and its aggro
  // circle (1/8-sector reach) covers the dock. Right-click quick-navigate
  // toward it (a raw fixed-point course, not an orbiting POI) undocks and heads
  // the ship at it; the aggroed pirate pursues, so they converge. A few closing
  // stages shrink the gap until it enters view; then click 拦截, which commits
  // an intercept course chasing the pirate's live position until contact opens
  // the engagement modal. (The right-click's screen→world mapping rides the
  // RAF-lagged space viewport, so the exact heading varies run-to-run — but the
  // deterministic pursuit makes contact the reliable outcome.)
  for (let i = 0; i < SPACE_HOP_STAGES; i++) {
    const done = await sim.page.evaluate((k: string) => {
      const u = (window as any).__uclife__
      return u.getEnemyScreenCoords(k) != null
        || u.getGameState().getEngagement().isOpen()
    }, ENEMY_KEY)
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

  // The starter pirate is the sole group covering the home approach corridor
  // (space-entities.json5 keeps the heavier lunar groups clear of it), so the
  // first contact is deterministically the winnable 1-v-1 — assert it before
  // committing, so a stray heavier contact fails loud instead of silently
  // losing the fight.
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getEngagement().getEnemyKey()),
    'first contact must be the winnable starter pirate',
  ).toBe(ENEMY_KEY)

  // ── 7. Engage and win on auto-fire ───────────────────────────────────
  // The Von Braun coverer is now a single weak pirateLight (no escorts): a
  // 1-v-1 the stock lightFreighter reliably wins on auto-fire, ending well
  // above the 25% flagship-hull auto-pause, so the fight runs uninterrupted.
  const moneyBeforeFight = await sim.page.evaluate(() =>
    (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money'))

  await sim.page.locator('.status-panel').getByRole('button', { name: '交战' })
    .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.waitForSelector('.tactical-overlay', { timeout: DOM_COMMIT_TIMEOUT_MS })
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'engaging must open the tactical view',
  ).toBe(true)

  // ── W2 command layer — issue one focus-fire order during the pause ────
  // Tactical opens paused on the first-contact briefing (the planning
  // moment), and the flagship order palette accepts orders right there —
  // proven at the system level in fleet-orders.spec.ts; this is the
  // journey's minimal real-input command-layer pass. Combat already opens
  // paused, so rather than pressing Space to pause (which would UNpause and
  // defeat the "orders work while paused" proof) the leg asserts the pause,
  // issues the order under it, then presses Space to resume. Wait for the
  // arena <canvas> first (the world→screen helper projects through it), arm
  // 集火 via its palette button, then click the sole enemy at its projected
  // arena coords. CP spend is asserted against the pre-order pool with NO
  // sim step between the two reads, so regen can't perturb the delta.
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isPaused()),
    'tactical opens paused on first contact — the order is issued during this planning pause',
  ).toBe(true)
  await sim.page.waitForSelector('.tactical-canvas-host canvas', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const cpBeforeOrder = await sim.page.evaluate(() =>
    (window as any).__uclife__.getGameState().getCombat().getCommandPool())
  expect(
    cpBeforeOrder.current,
    'the command pool seeds full at engagement start, covering a focus-fire order',
  ).toBeGreaterThanOrEqual(ORDER_COST_FOCUS_FIRE)

  await sim.page.locator('[data-tactical-order="focusFire"]').click()
  const enemyArenaPt = await sim.page.evaluate(
    (k: string) => (window as any).__uclife__.getTacticalEnemyScreenCoords(k), COMBAT_ENEMY_KEY)
  expect(enemyArenaPt, `${COMBAT_ENEMY_KEY} must project onto the tactical arena to click-focus it`).toBeTruthy()
  await sim.page.mouse.click(enemyArenaPt!.x, enemyArenaPt!.y)

  expect(
    (await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getCombat().getCommandPool())).current,
    'issuing a focus-fire order must spend exactly orderCosts.focusFire command points',
  ).toBe(cpBeforeOrder.current - ORDER_COST_FOCUS_FIRE)

  // Space (real keyboard) resumes the fight; the drive loop below then runs
  // without needing to click 继续 on its first pass.
  await sim.page.keyboard.press('Space')
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isPaused()),
    'Space toggles the tactical pause — the fight is now running',
  ).toBe(false)

  // ── W3 MS-sortie leg — climb into the hangar MS, fight, dock back ─────
  // The earned starter (mobileWorker) rides aboard UNPILOTED, so the wing-
  // launch bridge order has nothing to field: assert 僚机出击 stays disabled
  // here while still at the flagship helm (the palette only renders then).
  await expect(
    sim.page.locator('[data-tactical-order="msLaunchAuth"]'),
    'the wing-launch order stays disabled with no pilot-assigned MS aboard',
  ).toBeDisabled()

  // Re-pause so the AI flagship can't resolve the fight while the player is
  // off the helm walking the interior (combat only advances when a real
  // Space unpauses it AND sim time is driven).
  await setTacticalPause(sim, true)

  // Leave the bridge via the REAL topbar verb → overlay closes, avatar drops
  // at the bridge in playerShipInterior, flagship goes on AI.
  await sim.page.locator('.tactical-topbar').getByRole('button', { name: '下舰桥' })
    .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.waitForSelector('.tactical-overlay', { state: 'detached', timeout: CAMERA_TIMEOUT_MS })
  await waitForScene(sim, 'playerShipInterior')

  // Walk bridge → hangar bay and climb the starter MS (climbIntoMs → launchMs).
  await climbIntoHangarMs(sim)

  // ── Cockpit gauges + real vernier boost ──────────────────────────────
  await expect(
    sim.page.locator('[data-cockpit-gauge="propellant"]'),
    'the cockpit propellant gauge must render while piloting the MS',
  ).toHaveCount(1)
  const boostGauge = sim.page.locator('[data-cockpit-gauge="boost"]')
  expect(
    Number(await boostGauge.getAttribute('data-cockpit-cooldown')),
    'boost cooldown reads 0 before any KeyF trigger',
  ).toBe(0)
  await sim.page.keyboard.press('KeyF')
  await expect.poll(
    async () => Number(await boostGauge.getAttribute('data-cockpit-cooldown')),
    { message: 'a real KeyF must set the boost cooldown gauge (vernier boost fired)' },
  ).toBeGreaterThan(0)

  // ── Dock back via real 返航 (回收) ────────────────────────────────────
  // The engagement is live throughout the sortie (each burst advances the
  // war); the leg's proof is the cockpit HUD + boost above and the real
  // dock here — see the MS-sortie constants block for why no enemy-damage
  // wait can be deterministic.
  await flyMsToDock(sim)

  // Docked → the avatar is back in the walkable hangar bay (playerShipInterior).
  // Walk to the bridge helm and retake flagship control (E → takeFlagshipControl,
  // which reopens the tactical overlay with the flagship order palette).
  await walkOnScreen(sim, HELM_KEY)
  const focusPalette = sim.page.locator('[data-tactical-order="focusFire"]')
  for (let i = 0; i < KIOSK_INTERACT_TRIES; i++) {
    if (await focusPalette.count() > 0) break
    const pt = await sim.page.evaluate((k: string) => {
      const t = (window as any).__uclife__.getEntityScreenCoords(k)
      return t ? { x: t.x, y: t.y - 12 } : null // upper edge of the helm kiosk
    }, HELM_KEY)
    if (pt) await sim.page.mouse.click(pt.x, pt.y)
    await sim.stepForCoarse(TRANSITION_WALK_MIN)
  }
  await expect(focusPalette, 'retaking the helm (E) must reopen the flagship tactical view').toHaveCount(1)

  // Combat opens paused on the first-contact briefing. Resume via the real
  // tactical control and advance sim time in stages until the fight resolves;
  // re-click 继续 on any auto-pause (the fight ends above 25% hull, so none is
  // expected — the guard just keeps a stray threshold pause from stalling).
  for (let i = 0; i < COMBAT_DRIVE_STAGES; i++) {
    const st = await sim.page.evaluate(() => {
      const c = (window as any).__uclife__.getGameState().getCombat()
      return { open: c.isOpen(), paused: c.isPaused() }
    })
    if (!st.open) break
    if (st.paused) {
      await sim.page.locator('.tactical-topbar').getByRole('button', { name: /继续/ })
        .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
    }
    await sim.stepFor(COMBAT_STAGE_MIN)
  }
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'the auto-fire engagement must resolve within the drive budget',
  ).toBe(false)

  // ── 8. Clear the recoverables (if any) + tally via real DOM input ────
  // Victory tears combat down to the walkable BRIDGE this time: the player
  // re-took the helm from the ship interior mid-fight (takeFlagshipControl),
  // so that is the return context — unlike the W1-only flow, which entered
  // combat from the flight view and returned to spaceCampaign. Clear the
  // overlays over the bridge first. On a win the recoverables dialogue fires
  // first only when the kill leaves a survivor hull / pod; otherwise the
  // tally opens directly. Handle both.
  const recoverablesConfirm = sim.page.locator('[data-recoverables-confirm]')
  if (await recoverablesConfirm.isVisible().catch(() => false)) {
    await recoverablesConfirm.click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  }
  const tallyPanel = sim.page.locator('.status-panel', { hasText: '战斗结算' })
  await tallyPanel.waitFor({ state: 'visible', timeout: DOM_COMMIT_TIMEOUT_MS })
  await tallyPanel.getByRole('button', { name: '返回舰桥' }).click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  await tallyPanel.waitFor({ state: 'detached', timeout: DOM_COMMIT_TIMEOUT_MS })

  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount()),
    'the earned hull survived the fight (victory, not defeat)',
  ).toBe(1)
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money')),
    'winning the fight must credit the tally reward',
  ).toBeGreaterThan(moneyBeforeFight)

  // Re-take the helm (real walk + E) to resume the flight home, then wait
  // for the space viewport to project POIs — right after the scene swap the
  // camera needs a few frames before screen-coord reads are meaningful.
  await walkOnScreen(sim, HELM_KEY)
  await interactToScene(sim, HELM_KEY, 'spaceCampaign')
  await sim.page.waitForFunction((p: string) => {
    const u = (window as any).__uclife__
    return (u.getPoiScreenCoords(p) ?? u.getPoiScreenCoordsClamped(p)) != null
  }, DOCK_POI, { timeout: CAMERA_TIMEOUT_MS })

  // ── 9. Dock home at Von Braun via the POI context menu ───────────────
  // Von Braun is off-screen after the running fight; right-click quick-navigate
  // toward it until it actually projects on-screen (the rectangular space
  // viewport is direction-sensitive — a world-distance radius alone doesn't
  // guarantee visibility when the approach is more vertical than horizontal),
  // then left-click it and pick 停泊 — dockAt commits an auto-dock course that
  // flies the last leg and parks on arrival. The break condition is the exact
  // same on-screen predicate the final assertion checks, so there is no
  // heuristic-vs-actual mismatch between "close enough to stop hopping" and
  // "close enough to click".
  for (let i = 0; i < DOCK_HOP_STAGES; i++) {
    const onScreen = await sim.page.evaluate((p: string) =>
      (window as any).__uclife__.getPoiScreenCoords(p) != null, DOCK_POI)
    if (onScreen) break
    const pt = await sim.page.evaluate((p: string) => {
      const u = (window as any).__uclife__
      return u.getPoiScreenCoords(p) ?? u.getPoiScreenCoordsClamped(p)
    }, DOCK_POI)
    expect(pt, `${DOCK_POI} must exist to navigate toward`).toBeTruthy()
    await sim.page.mouse.click(pt!.x, pt!.y, { button: 'right' })
    await sim.stepFor(DOCK_HOP_STAGE_MIN)
  }
  const poiPt = await sim.page.evaluate((p: string) =>
    (window as any).__uclife__.getPoiScreenCoords(p), DOCK_POI)
  expect(poiPt, `${DOCK_POI} must be on-screen to open its dock menu`).toBeTruthy()
  await sim.page.mouse.click(poiPt!.x, poiPt!.y)
  await sim.page.locator('.space-view').getByText('停泊', { exact: true })
    .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  // stepUntil stringifies its predicate to run in-page, so the POI id must be
  // an inline literal (a Node-side const isn't in scope there).
  await sim.stepUntil(() =>
    (window as any).__uclife__.getGameState().getPlayerFleet().getDockedPoiId() === 'vonBraun',
    DOCK_BUDGET_MIN)

  // Bonus invariant: the round trip fit the tank — the ship never stranded,
  // so it still holds fuel at the dock.
  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getPlayerFleet().getFuel().current),
    'the sortie round trip must not strand the ship (fuel remains at dock)',
  ).toBeGreaterThan(0)

  // ── 10. Leave the helm and disembark into the city ───────────────────
  // Docking parks the flagship but leaves the player at the helm. Step off the
  // helm (back to the ship interior), then walk to the 下船 kiosk and interact
  // — a single-dockScene POI disembarks straight into vonBraunCity.
  await sim.page.locator('.space-view').getByText('离开操舵台 (ESC)', { exact: true })
    .click({ timeout: DOM_COMMIT_TIMEOUT_MS })
  await waitForScene(sim, 'playerShipInterior')

  await walkOnScreen(sim, DISEMBARK_KEY)
  await interactToScene(sim, DISEMBARK_KEY, 'vonBraunCity')

  expect(
    await sim.page.evaluate(() =>
      (window as any).__uclife__.getGameState().getScene().getId()),
    'disembarking lands the player back in the city',
  ).toBe('vonBraunCity')
})
