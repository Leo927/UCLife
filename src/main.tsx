import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import './styles.css'
import { App } from './App'
import { world, getWorld } from './ecs/world'
import { useScene } from './sim/scene'
import { useClock } from './sim/clock'
import { IsPlayer, Position, MoveTarget, Road, Building, Wall, FlightHub, Door, Bed, Path } from './ecs/traits'
import { getAirportPlacement } from './sim/airportPlacements'
import { flightHubs } from './data/flights'
import { findPath } from './systems/pathfinding'
// Side-effect imports: install dev-only window.uclifeFindClerk /
// window.uclifePinClerk for Playwright fixtures.
import './render/portrait/adapter/findClerk'
import './render/portrait/__debug__/portraitFixtures'

if (import.meta.env.DEV) {
  // Smoke-test handles. CLAUDE.md: expose helpers here, do NOT
  // dynamic-import traits from tests (module-dedup mismatch).
  ;(globalThis as unknown as { __uclife__: unknown }).__uclife__ = {
    world, useClock, useScene,
    movePlayerTo(tx: number, ty: number) {
      const TILE = 32
      const px = tx * TILE, py = ty * TILE
      for (const e of world.query(IsPlayer, Position)) {
        e.set(Position, { x: px, y: py })
        e.set(MoveTarget, { x: px, y: py })
        return true
      }
      return false
    },
    countByKind() {
      let buildings = 0, walls = 0, roads = 0
      for (const _b of world.query(Building)) buildings++
      for (const _w of world.query(Wall)) walls++
      for (const _r of world.query(Road)) roads++
      return { buildings, walls, roads }
    },
    listAirports() {
      return flightHubs.map((h) => ({
        hubId: h.id,
        sceneId: h.sceneId,
        nameZh: h.nameZh,
        placement: getAirportPlacement(h.id),
      }))
    },
    movePlayerToAirport(hubId: string) {
      const p = getAirportPlacement(hubId)
      if (!p) return false
      for (const e of world.query(IsPlayer, Position)) {
        e.set(Position, p.counterPx)
        e.set(MoveTarget, p.counterPx)
        return true
      }
      return false
    },
    flightHubCount() {
      let n = 0
      for (const _ of world.query(FlightHub)) n++
      return n
    },
    // Probes for the locked-room regression test. Picks the first cell door
    // whose bed has no occupant — i.e., a door currently locked for the
    // player — and returns geometry + the result of pathing into it.
    findLockedCellPath() {
      const player = world.queryFirst(IsPlayer)
      if (!player) return null
      let chosenDoor: { x: number; y: number; w: number; h: number; orient: 'h' | 'v' } | null = null
      let bedPos: { x: number; y: number } | null = null
      for (const dEnt of world.query(Door, Position)) {
        const d = dEnt.get(Door)!
        if (!d.bedEntity) continue
        const bed = d.bedEntity.get(Bed)
        if (!bed) continue
        // "Locked for player" = anyone except the player holds the lease.
        if (bed.occupant === player) continue
        chosenDoor = { x: d.x, y: d.y, w: d.w, h: d.h, orient: d.orient }
        const bp = d.bedEntity.get(Position)
        if (bp) bedPos = { x: bp.x, y: bp.y }
        break
      }
      if (!chosenDoor || !bedPos) return null
      const corridorOff = 24
      const start = chosenDoor.orient === 'h'
        ? { x: chosenDoor.x + chosenDoor.w / 2, y: chosenDoor.y - corridorOff }
        : { x: chosenDoor.x - corridorOff, y: chosenDoor.y + chosenDoor.h / 2 }
      // Try the opposite-side start if the chosen one is inside walls (no
      // path segment from there). The bed gives an oracle for "interior".
      const sameSideAsBed = chosenDoor.orient === 'h'
        ? (start.y < chosenDoor.y) === (bedPos.y < chosenDoor.y)
        : (start.x < chosenDoor.x) === (bedPos.x < chosenDoor.x)
      if (sameSideAsBed) {
        if (chosenDoor.orient === 'h') start.y = chosenDoor.y + chosenDoor.h + corridorOff
        else start.x = chosenDoor.x + chosenDoor.w + corridorOff
      }
      player.set(Position, start)
      player.set(MoveTarget, start)
      const wps = findPath(world, player, start, bedPos)
      const interiorReached = wps.some((wp) =>
        chosenDoor!.orient === 'h'
          ? (bedPos!.y > chosenDoor!.y ? wp.y > chosenDoor!.y + chosenDoor!.h : wp.y < chosenDoor!.y)
          : (bedPos!.x > chosenDoor!.x ? wp.x > chosenDoor!.x + chosenDoor!.w : wp.x < chosenDoor!.x),
      )
      return { door: chosenDoor, bed: bedPos, start, target: bedPos, wps, interiorReached }
    },
    setMoveTarget(target: { x: number; y: number }) {
      const player = world.queryFirst(IsPlayer)
      if (!player) return false
      player.set(MoveTarget, target)
      return true
    },
    playerSnapshot() {
      const player = world.queryFirst(IsPlayer)
      if (!player) return null
      const pos = player.get(Position)!
      const path = player.get(Path)
      return {
        pos: { x: pos.x, y: pos.y },
        pathLen: path?.waypoints.length ?? 0,
        pathIdx: path?.index ?? null,
      }
    },
  }
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
