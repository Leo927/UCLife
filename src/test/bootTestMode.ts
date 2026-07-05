// Test-mode boot entry. Triggered by `?test=1` in src/main.tsx under
// `import.meta.env.DEV`. The whole module is tree-shaken from prod
// builds — no test code ships to players.
//
// Boot order matters: state flag → RNG seed → frozen clock → world →
// fixture → debug handles → React mount. See the deterministic-tests
// skill at .claude/skills/deterministic-tests/.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import { App } from '../App'
import { getWorld } from '../ecs/world'
import { useScene } from '../sim/scene'
import { setSimRngSeed } from '../sim/rng'
import { freezeSimNow } from '../sim/time'
import { bootstrapApp } from '../boot/lifecycle'
import { stopLoop } from '../sim/loop'
import { bindAutosave } from '../boot/autosaveBinding'
import { bindUi } from '../boot/uiBindings'
import { bindPhysiology } from '../boot/physiologyBinding'
import { bindFleetLaunch } from '../boot/fleetLaunchBinding'
import { markTestMode } from './state'
import { pinTestModeSpeed } from './clock'
import { applyFixture } from './fixtures'
import { step } from './runtime'
import {
  getEntityScreenCoords, getEntityScreenCoordsClamped, getPoiScreenCoords, getEnemyScreenCoords,
} from './canvasHitTest'
import { getGameState } from './gameStateView'
import { useDebug } from '../debug/store'
import { testConfig } from './test-config'
import { createElement } from 'react'

// Side-effect imports — these register save-handlers / serializers /
// daily-rollover subscribers the same way prod main.tsx does. Test
// mode still needs them so a fixture-loaded world serializes cleanly.
import '../boot/saveHandlers'
import '../boot/traitSerializers'
import '../boot/researchTick'
import '../boot/facilityTierTick'
import '../boot/colonyEconomicsTick'
import '../boot/colonyConstructionTick'
import '../boot/colonyThreatsTick'
import '../boot/hangarRepairTick'
import '../boot/fleetSupplyTick'
import '../boot/shipDeliveryTick'
import '../boot/msDeliveryTick'
import '../boot/msTransitTick'
import '../boot/factionSalaryTick'
import '../boot/fleetTransitTick'
import '../boot/commandPointsTick'
import '../boot/diplomacyTick'
import '../boot/warTransitionTick'
import '../boot/warPayoffBinding'
import '../boot/conscriptionTick'
import '../boot/refugeeTick'
import '../boot/civilianChurnTick'
import '../boot/diplomaticSlotsTick'
import '../render/portrait/__debug__/findClerk'
import '../render/portrait/__debug__/portraitFixtures'

export interface TestBootParams {
  fixture?: string
  seed?: string
  nowMs?: number
  assets: boolean
  // Boot-time invariant (like the frozen clock / seed): freeze the PLAYER's
  // vitals so a long sim-time advance doesn't starve them. The capstone
  // journey smoke must elapse the mandatory multi-day ship-delivery lead;
  // without this the idle player dies of neglect (~1.9 game-days) before the
  // hull arrives. Survival is covered by its own smokes — the journey opts
  // out of it here rather than micro-manage eating/sleeping across two days.
  freezeNeeds: boolean
}

/**
 * Parse `URLSearchParams` into a typed TestBootParams. Centralizes the
 * `assets=1` opt-in default-off semantics + `nowMs` numeric coercion.
 */
export function parseTestBootParams(search: URLSearchParams): TestBootParams {
  const fixture = search.get('fixture') ?? undefined
  const seed = search.get('seed') ?? undefined
  const nowMsRaw = search.get('nowMs')
  const nowMs = nowMsRaw != null ? Number(nowMsRaw) : undefined
  const assets = search.get('assets') === '1'
  const freezeNeeds = search.get('freezeNeeds') === '1'
  return { fixture, seed, nowMs, assets, freezeNeeds }
}

export default async function bootTestMode(params: TestBootParams): Promise<void> {
  // 1. Test-mode flag + skipAssets default-on. Done first so any
  //    side-effect imports that race the boot (debug handles registering
  //    image renderers) see the flag before they do work.
  markTestMode({ skipAssets: !params.assets })

  // 2. Seed the runtime sim RNG. Procgen has its own per-pass seed; this
  //    pins runtime rolls (combat hits, recruitment chances, immigrant
  //    variance) before setupWorld() runs.
  setSimRngSeed(params.seed ?? testConfig.defaultSeed)

  // 3. Freeze the wall clock. Anything that captures simNow() during
  //    setupWorld (entity spawn timestamps, etc.) gets the frozen
  //    anchor, so back-to-back boots reproduce identical timestamps.
  const startMs = params.nowMs ?? Date.parse(testConfig.defaultStartIso)
  freezeSimNow(startMs)

  // 4. Pin clock speed = 1 so advanceSimByGameMs() arithmetic is 1:1.
  //    Must precede bootstrapApp() — startLoop reads useClock.speed.
  pinTestModeSpeed()

  // 5. Bring the koota world(s) up via the same lifecycle prod uses.
  //    Subsystem event bindings install first so save-handlers can fire
  //    on a fresh world. We then stopLoop() immediately — bootstrapApp
  //    starts the RAF loop, and test mode owns sim time progression via
  //    step() alone.
  //
  //    skipDefaultPlayer is gated on the presence of a fixture: when a
  //    fixture loads, IT is the authoritative source for player money /
  //    location / skills / background, so the initial-scene default
  //    spawn must not run (otherwise getPlayerCharacter() picks the
  //    boot-spawned entity and the fixture state is silently shadowed).
  //    No-fixture boots (e.g. check-test-boot.mjs) keep the default.
  bindAutosave()
  bindUi()
  bindPhysiology()
  bindFleetLaunch()
  bootstrapApp({ skipDefaultPlayer: Boolean(params.fixture) })
  stopLoop()

  // Boot-time need-freeze (opt-in). Applied after bootstrapApp so the debug
  // store exists; treated as a boot invariant, not a runtime debug drive.
  if (params.freezeNeeds) useDebug.getState().setFreezeNeeds(true)

  // 6. Apply the requested fixture. Fixture is authoritative — anything
  //    it sets (player money, skills, faction balances, ships, npcs)
  //    overrides defaults; the default player spawn was skipped above
  //    when fixture is set so the fixture is the only source.
  if (params.fixture) applyFixture(params.fixture)

  // 7. Install __uclife__ + __uclife_test__ runtime namespaces. The
  //    debug-handle registry runs side-effect imports first, then we
  //    assemble + attach the namespace + tack on test-only helpers.
  await import('../boot/debugHandles')
  const { assembleUclifeHandle } = await import('../debug/uclifeHandle')
  const handle = assembleUclifeHandle()
  handle.getEntityScreenCoords = getEntityScreenCoords
  handle.getEntityScreenCoordsClamped = getEntityScreenCoordsClamped
  handle.getPoiScreenCoords = getPoiScreenCoords
  handle.getEnemyScreenCoords = getEnemyScreenCoords
  // Phase 5 will replace this with a real navigable view; we wire the
  // function reference here so the runtime surface (smoke checks +
  // calling code) stays stable across the Phase 5 swap.
  handle.getGameState = getGameState
  ;(globalThis as unknown as { __uclife__: unknown }).__uclife__ = handle
  ;(globalThis as unknown as { __uclife_test__: unknown }).__uclife_test__ = { step }

  // 8. Mount the React tree. Same shape as prod main.tsx — App wrapped
  //    in WorldProvider scoped to the active scene + a key that forces a
  //    full remount on scene swap. Without this, DOM clicks would have
  //    no UI to land on.
  function ScopedRoot() {
    const activeId = useScene((s) => s.activeId)
    const swapNonce = useScene((s) => s.swapNonce)
    const sceneWorld = getWorld(activeId)
    const child = createElement(App, { key: `${activeId}-${swapNonce}` })
    return createElement(WorldProvider, { world: sceneWorld, children: child })
  }

  const root = document.getElementById('root')
  if (!root) throw new Error('bootTestMode: #root element not found')
  createRoot(root).render(
    createElement(StrictMode, null, createElement(ScopedRoot)),
  )
}
