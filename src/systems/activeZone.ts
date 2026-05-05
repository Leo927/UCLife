// Active = within activeRadiusTiles of the player's Position. Hysteresis:
// demotion uses a wider square (activeRadiusTiles + hysteresisTiles) so
// edge-walkers don't flap. Demote-to-teleport: an NPC with an outside
// MoveTarget jumps straight to it on demote rather than paying per-frame A*
// across I. Inactive→teleport on BT-set MoveTarget is in agent.setMoveTarget.
//
// "Active" is a sim-domain question — NPCs alive near the player. The
// partitioner reads the player's Position from the world, not the camera
// viewport, so the sim runs identically headless and on the renderer.

import { trait } from 'koota'
import type { Entity, World } from 'koota'
import {
  Active, Action, Character, ChatTarget, ChatLine, Health, IsPlayer,
  MoveTarget, Path, Position,
} from '../ecs/traits'
import { worldConfig } from '../config'
import { worldSingleton } from '../ecs/resources'

const TILE = worldConfig.tilePx
const RADIUS_PX = worldConfig.activeZone.activeRadiusTiles * TILE
const HYST_PX = worldConfig.activeZone.hysteresisTiles * TILE
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

type Bounds = { x0: number; y0: number; x1: number; y1: number }

// Per-world membership-tick throttle. -Infinity sentinel means the next
// call always fires regardless of gameMs. Hoisted off module scope so two
// scenes don't share one timestamp (which would suppress activeZone in
// whichever scene wasn't ticked last).
const ActiveZoneState = trait({ lastTickGameMs: -Infinity })

function stateOf(world: World): Entity {
  const e = worldSingleton(world)
  if (!e.has(ActiveZoneState)) e.add(ActiveZoneState)
  return e
}

export function resetActiveZone(world: World): void {
  const e = stateOf(world)
  e.set(ActiveZoneState, { lastTickGameMs: -Infinity })
}

// Returns null when the world has no player entity yet — callers treat that
// as "be permissive" (e.g. headless boot, between scene swaps).
function bounds(world: World, halfExtentPx: number): Bounds | null {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return null
  const pos = player.get(Position)
  if (!pos) return null
  return {
    x0: pos.x - halfExtentPx,
    y0: pos.y - halfExtentPx,
    x1: pos.x + halfExtentPx,
    y1: pos.y + halfExtentPx,
  }
}

const inside = (x: number, y: number, b: Bounds): boolean =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1

// Permissive (returns true) when no player entity exists, so callers don't
// teleport prematurely during headless boot or scene transitions.
export function isPointInActiveZone(world: World, x: number, y: number): boolean {
  const b = bounds(world, RADIUS_PX)
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

  const promoteBox = bounds(world, RADIUS_PX)
  if (!promoteBox) {
    // Headless / no-player: mark every Character Active so BT and render
    // filters behave like the pre-active-zone version.
    for (const entity of world.query(Character, Position)) {
      if (!entity.has(Active)) entity.add(Active)
    }
    return
  }
  const demoteBox = bounds(world, RADIUS_PX + HYST_PX)!

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
