// Active = inside the player-centered active rect. The rect is the larger
// of (a) a sim-domain floor sized by activeRadiusTiles and (b) the renderer
// viewport (pushed each layout effect via setViewportHint), padded on every
// edge by viewportBleedTiles so NPCs flip Active before they cross into
// view. Per-axis: a wide-but-short window stays wide on x and floor-bound
// on y. Headless callers never push a hint, so the rect stays at the floor
// and `npm run test:unit` matches the pre-renderer-aware behavior.
//
// Hysteresis: demotion uses a wider rect (active + hysteresisTiles on each
// side) so edge-walkers don't flap. Demote-to-teleport: an NPC with an
// outside MoveTarget jumps straight to it rather than paying per-frame A*
// across I. Inactive→teleport on BT-set MoveTarget is in agent.setMoveTarget.

import { trait } from 'koota'
import type { Entity, World } from 'koota'
import {
  Active, Action, Character, ChatTarget, ChatLine, Health, IsPlayer,
  MoveTarget, Path, Position,
} from '../ecs/traits'
import { worldConfig } from '../config'
import { worldSingleton } from '../ecs/resources'

const TILE = worldConfig.tilePx
const FLOOR_HALF_PX = worldConfig.activeZone.activeRadiusTiles * TILE
const BLEED_PX = worldConfig.activeZone.viewportBleedTiles * TILE
const HYST_PX = worldConfig.activeZone.hysteresisTiles * TILE
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

type Bounds = { x0: number; y0: number; x1: number; y1: number }

// Per-world membership-tick throttle. -Infinity sentinel means the next
// call always fires regardless of gameMs. Hoisted off module scope so two
// scenes don't share one timestamp (which would suppress activeZone in
// whichever scene wasn't ticked last).
const ActiveZoneState = trait({ lastTickGameMs: -Infinity })

// Renderer-pushed viewport hint, in CSS pixels. Zero means "no hint" — the
// active zone falls back to the floor radius. The renderer rewrites this on
// every canvas resize (Game.tsx), so the value reflects the real viewport
// not the world dimensions.
const ViewportHint = trait({ widthPx: 0, heightPx: 0 })

function stateOf(world: World): Entity {
  const e = worldSingleton(world)
  if (!e.has(ActiveZoneState)) e.add(ActiveZoneState)
  return e
}

function viewportOf(world: World): { widthPx: number; heightPx: number } {
  const e = worldSingleton(world)
  if (!e.has(ViewportHint)) return { widthPx: 0, heightPx: 0 }
  return e.get(ViewportHint)!
}

export function setViewportHint(world: World, widthPx: number, heightPx: number): void {
  const e = worldSingleton(world)
  if (!e.has(ViewportHint)) e.add(ViewportHint)
  e.set(ViewportHint, { widthPx, heightPx })
}

export function resetActiveZone(world: World): void {
  const e = stateOf(world)
  e.set(ActiveZoneState, { lastTickGameMs: -Infinity })
  if (e.has(ViewportHint)) e.set(ViewportHint, { widthPx: 0, heightPx: 0 })
}

function effectiveHalfExtents(world: World): { halfWidthPx: number; halfHeightPx: number } {
  const v = viewportOf(world)
  const fromViewportW = v.widthPx > 0 ? v.widthPx / 2 + BLEED_PX : 0
  const fromViewportH = v.heightPx > 0 ? v.heightPx / 2 + BLEED_PX : 0
  return {
    halfWidthPx: Math.max(FLOOR_HALF_PX, fromViewportW),
    halfHeightPx: Math.max(FLOOR_HALF_PX, fromViewportH),
  }
}

// Returns null when the world has no player entity yet — callers treat that
// as "be permissive" (e.g. headless boot, between scene swaps).
function bounds(world: World, halfWidthPx: number, halfHeightPx: number): Bounds | null {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return null
  const pos = player.get(Position)
  if (!pos) return null
  return {
    x0: pos.x - halfWidthPx,
    y0: pos.y - halfHeightPx,
    x1: pos.x + halfWidthPx,
    y1: pos.y + halfHeightPx,
  }
}

const inside = (x: number, y: number, b: Bounds): boolean =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1

// Permissive (returns true) when no player entity exists, so callers don't
// teleport prematurely during headless boot or scene transitions.
export function isPointInActiveZone(world: World, x: number, y: number): boolean {
  const { halfWidthPx, halfHeightPx } = effectiveHalfExtents(world)
  const b = bounds(world, halfWidthPx, halfHeightPx)
  if (!b) return true
  return inside(x, y, b)
}

// Clearing chat now (rather than letting the BT detect it next run) avoids
// several game-min of vitals draining on the chat curve while demoted.
function breakChat(entity: import('koota').Entity): void {
  const ct = entity.get(ChatTarget)
  const partner = ct?.partner ?? null
  try {
    if (entity.has(ChatTarget)) entity.remove(ChatTarget)
    if (entity.has(ChatLine)) entity.remove(ChatLine)
    const a = entity.get(Action)
    if (a?.kind === 'chatting') entity.set(Action, { ...a, kind: 'idle', remaining: 0, total: 0 })
  } catch { /* destroyed mid-step */ }
  if (partner) {
    try {
      const pt = partner.get(ChatTarget)
      if (pt?.partner === entity && partner.has(ChatTarget)) partner.remove(ChatTarget)
      if (partner.has(ChatLine)) partner.remove(ChatLine)
      const pa = partner.get(Action)
      if (pa?.kind === 'chatting') partner.set(Action, { ...pa, kind: 'idle', remaining: 0, total: 0 })
    } catch { /* destroyed mid-step */ }
  }
}

export function activeZoneSystem(world: World, gameMs: number): void {
  const e = stateOf(world)
  const s = e.get(ActiveZoneState)!
  if (gameMs - s.lastTickGameMs < TICK_MS) return
  e.set(ActiveZoneState, { lastTickGameMs: gameMs })

  const { halfWidthPx, halfHeightPx } = effectiveHalfExtents(world)
  const promoteBox = bounds(world, halfWidthPx, halfHeightPx)
  if (!promoteBox) {
    // Headless / no-player: mark every Character Active so BT and render
    // filters behave like the pre-active-zone version.
    for (const entity of world.query(Character, Position)) {
      if (!entity.has(Active)) entity.add(Active)
    }
    return
  }
  const demoteBox = bounds(world, halfWidthPx + HYST_PX, halfHeightPx + HYST_PX)!

  for (const entity of world.query(Character, Position)) {
    if (entity.has(IsPlayer)) {
      // Player is the radius anchor — always Active.
      if (!entity.has(Active)) entity.add(Active)
      continue
    }
    const pos = entity.get(Position)!
    const wasActive = entity.has(Active)
    if (!wasActive) {
      if (inside(pos.x, pos.y, promoteBox)) entity.add(Active)
      continue
    }
    if (inside(pos.x, pos.y, demoteBox)) continue
    const target = entity.get(MoveTarget)
    if (target && inside(target.x, target.y, promoteBox)) continue
    const dead = entity.get(Health)?.dead
    if (target && !dead) {
      entity.set(Position, { x: target.x, y: target.y })
      if (entity.has(MoveTarget)) entity.remove(MoveTarget)
      if (entity.has(Path)) entity.remove(Path)
      const a = entity.get(Action)
      if (a?.kind === 'walking') entity.set(Action, { ...a, kind: 'idle' })
    }
    if (entity.has(ChatTarget)) breakChat(entity)
    entity.remove(Active)
  }
}
