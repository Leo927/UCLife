import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import './styles.css'
import { App } from './App'
import { world, getWorld } from './ecs/world'
import { useScene } from './sim/scene'
import { useClock } from './sim/clock'
// Side-effect imports: install dev-only window.uclifeFindClerk /
// window.uclifePinClerk for Playwright fixtures.
import './render/portrait/adapter/findClerk'
import './render/portrait/__debug__/portraitFixtures'

if (import.meta.env.DEV) {
  // useScene is exposed so smoke tests can observe scene swaps — the proxy
  // `world` reference doesn't change across swaps.
  ;(globalThis as unknown as { __uclife__: unknown }).__uclife__ = { world, useClock, useScene }
}

// Bind WorldProvider to the *real* active-scene World, not the proxy — the
// proxy's identity never changes, so passing it would pin koota subscriptions
// to the previous scene. `key={activeId}` forces a full remount: koota's
// useQuery seeds its entity list via useState (one-time), so a context-only
// change leaves stale entity arrays.
function ScopedRoot() {
  const activeId = useScene((s) => s.activeId)
  const sceneWorld = getWorld(activeId)
  return (
    <WorldProvider world={sceneWorld}>
      <App key={activeId} />
    </WorldProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScopedRoot />
  </StrictMode>,
)
