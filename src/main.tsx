import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import './styles.css'
import { App } from './App'
import { getWorld } from './ecs/world'
import { useScene } from './sim/scene'
import { bindAutosave } from './boot/autosaveBinding'
import { bindUi } from './boot/uiBindings'
import { bindPhysiology } from './boot/physiologyBinding'
import { bootstrapApp } from './boot/lifecycle'
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
// Phase 6.2.D — captain + crew daily salary drain. Same event; debits
// the player's Money for every assigned officer / crew member across
// the fleet.
import './boot/fleetCrewSalaryTick'
// Side-effect imports: install dev-only window.uclifeFindClerk /
// window.uclifePinClerk for Playwright fixtures.
import './render/portrait/adapter/findClerk'
import './render/portrait/__debug__/portraitFixtures'

// Wire sim events to autosave + ui-store calls before any frame runs.
bindAutosave()
bindUi()
bindPhysiology()
// Bring the sim world up + start the per-frame loop. Must precede
// createRoot().render so the first React commit reads a populated world.
bootstrapApp()

if (import.meta.env.DEV) {
  // Dynamic import keeps the cluster files (and their reach into
  // sim/systems/save) out of the production bundle — Rollup tree-shakes
  // the whole branch when import.meta.env.DEV inlines to false.
  // Top-level await is fine: render below blocks until the manifest
  // has registered every handle and assembleUclifeHandle has run, so
  // smoke tests see a fully populated __uclife__ before the first
  // page.evaluate call.
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
