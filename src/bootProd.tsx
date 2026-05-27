// Production boot path — extracted from main.tsx so the test-mode
// branch can short-circuit without importing prod's side-effect chain.
// This module's top-level side effects (save-handler / serializer
// registrations) only execute when main.tsx imports it under the
// "not test mode" leg.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import { App } from './App'
import { getWorld } from './ecs/world'
import { useScene } from './sim/scene'
import { bindAutosave } from './boot/autosaveBinding'
import { bindUi } from './boot/uiBindings'
import { bindPhysiology } from './boot/physiologyBinding'
import { bindFleetLaunch } from './boot/fleetLaunchBinding'
import { bootstrapApp } from './boot/lifecycle'
import { preloadArt } from './render/assets/registry'
// Side-effect imports: register save handlers for every persisted
// subsystem (clock, population, ship, space, ...). Adding a new
// persisted subsystem == one new file under src/boot/saveHandlers/.
import './boot/saveHandlers'
// Side-effect imports: register per-trait serializers (Position, Vitals,
// Bed, ...). Adding a new persisted trait == one new file under
// src/boot/traitSerializers/.
import './boot/traitSerializers'
// Phase 5.5.6 — research progress fires off `day:rollover:settled`.
// The subscription lives in boot/ so the loop doesn't import systems/.
import './boot/researchTick'
// Phase 6.2.B — hangar repair throughput rides the same event so the
// repair tick lands after dailyEconomics + research settle for the day.
import './boot/hangarRepairTick'
// Phase 6.2.F — daily fleet supply drain + per-hangar delivery
// advancement. Same event as repair; deliveries land first inside the
// subscriber, then drain debits.
import './boot/fleetSupplyTick'
// Phase 6.2.C1 — advance pending ship deliveries on the same event;
// rows transition in_transit → arrived once arrivalDay is reached.
import './boot/shipDeliveryTick'
// Phase 6.2.5.B — parallel queue for MS deliveries from the AE vehicle broker.
import './boot/msDeliveryTick'
// Phase 6.2.5.B — in-transit MS lander; same day-rollover, separate effect.
import './boot/msTransitTick'
// Unified faction-member daily salary drain. Same event; debits the
// player's Money for every NPC carrying RecruitedTo({owner: player}),
// with the captain-role bonus added on top per EmployedAsCrew.role.
import './boot/factionSalaryTick'
// Phase 6.2.E2 — cross-POI ship transit lander. Same event; lands
// in-transit non-flagship active ships at their destination POI when
// arrivalDay rolls over.
import './boot/fleetTransitTick'
// Side-effect imports: install dev-only window.uclifeFindClerk /
// window.uclifePinClerk for Playwright fixtures.
import './render/portrait/__debug__/findClerk'
import './render/portrait/__debug__/portraitFixtures'

export async function bootProd(): Promise<void> {
  // Wire sim events to autosave + ui-store calls before any frame runs.
  bindAutosave()
  bindUi()
  bindPhysiology()
  bindFleetLaunch()
  // Fire-and-forget the art bundle so textures are ready by the time
  // the renderer first asks for them. The renderer falls back to a
  // null-texture sprite during the load window, so this purely avoids
  // the first-paint flicker — it never blocks bootstrap.
  void preloadArt()
  // Bring the sim world up + start the per-frame loop. Must precede
  // createRoot().render so the first React commit reads a populated world.
  bootstrapApp()

  if (import.meta.env.DEV) {
    // Dynamic import keeps the cluster files (and their reach into
    // sim/systems/save) out of the production bundle — Rollup tree-shakes
    // the whole branch when import.meta.env.DEV inlines to false.
    await import('./boot/debugHandles')
    const { assembleUclifeHandle } = await import('./debug/uclifeHandle')
    ;(globalThis as unknown as { __uclife__: unknown }).__uclife__ = assembleUclifeHandle()
  }

  // Bind WorldProvider to the *real* active-scene World, not the proxy — the
  // proxy's identity never changes, so passing it would pin koota subscriptions
  // to the previous scene. The composite `${activeId}-${swapNonce}` key forces
  // a full remount on every useScene.setActive() call, not just scene swaps:
  // koota's `world.reset()` clears its queriesHashMap, orphaning existing
  // useQuery instances (their state never sees post-reset spawns). Save/load
  // reuses the same scene, so it bumps swapNonce — the changing key gives App
  // fresh useQuery hooks that re-scan the rebuilt world.
  function ScopedRoot() {
    const activeId = useScene((s) => s.activeId)
    const swapNonce = useScene((s) => s.swapNonce)
    const sceneWorld = getWorld(activeId)
    return (
      <WorldProvider world={sceneWorld}>
        <App key={`${activeId}-${swapNonce}`} />
      </WorldProvider>
    )
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ScopedRoot />
    </StrictMode>,
  )
}
