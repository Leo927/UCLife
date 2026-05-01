// Active = inside (camera viewport + activePadTiles). Hysteresis: demotion
// uses a wider box (activePadTiles + hysteresisTiles) so edge-walkers
// don't flap. Demote-to-teleport: an NPC with an outside MoveTarget jumps
// straight to it on demote rather than paying per-frame A* across I.
// Inactive→teleport on BT-set MoveTarget is in agent.setMoveTarget.

import type { World } from 'koota'
import {
  Active, Action, Character, ChatTarget, ChatLine, Health, IsPlayer,
  MoveTarget, Path, Position,
} from '../ecs/traits'
import { useCamera } from '../render/cameraStore'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const PAD_PX = worldConfig.activeZone.activePadTiles * TILE
const HYST_PX = worldConfig.activeZone.hysteresisTiles * TILE
const TICK_MS = worldConfig.activeZone.membershipTickMin * 60 * 1000

type Bounds = { x0: number; y0: number; x1: number; y1: number }

let lastTickGameMs = -Infinity

export function resetActiveZone(): void {
  lastTickGameMs = -Infinity
}

// Returns null when the camera viewport hasn't been measured yet —
// callers treat that as "be permissive".
function bounds(padPx: number): Bounds | null {
  const { camX, camY, canvasW, canvasH } = useCamera.getState()
  if (canvasW <= 0 || canvasH <= 0) return null
  return {
    x0: camX - padPx,
    y0: camY - padPx,
    x1: camX + canvasW + padPx,
    y1: camY + canvasH + padPx,
  }
}

const inside = (x: number, y: number, b: Bounds): boolean =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1

// Permissive (returns true) when viewport unmeasured, so callers don't
// teleport prematurely.
export function isPointInActiveZone(x: number, y: number): boolean {
  const b = bounds(PAD_PX)
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
  if (gameMs - lastTickGameMs < TICK_MS) return
  lastTickGameMs = gameMs

  const promoteBox = bounds(PAD_PX)
  if (!promoteBox) {
    // Headless / pre-first-render: mark every Character Active so BT and
    // render filters behave like the pre-active-zone version.
    for (const entity of world.query(Character, Position)) {
      if (!entity.has(Active)) entity.add(Active)
    }
    return
  }
  const demoteBox = bounds(PAD_PX + HYST_PX)!

  for (const entity of world.query(Character, Position)) {
    if (entity.has(IsPlayer)) {
      // Player is the camera anchor.
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
