// Player + world primitives: the active-scene world proxy itself, plus
// movement / introspection helpers used by the smoke suite
// (movePlayerTo, setMoveTarget, playerSnapshot, countByKind).

import type { Entity } from 'koota'
import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  IsPlayer, Position, MoveTarget, Money, Road, Building, Wall, Path,
  Character, EntityKey, Action, Job, Workstation, QueuedInteract, Interactable,
  Vitals,
} from '../../ecs/traits'
import { worldConfig } from '../../config'
import type { InteractableKind } from '../../config/kinds'

const TILE = worldConfig.tilePx

registerDebugHandle('world', world)

registerDebugHandle('movePlayerTo', (tx: number, ty: number) => {
  const px = tx * TILE, py = ty * TILE
  for (const e of world.query(IsPlayer, Position)) {
    e.set(Position, { x: px, y: py })
    e.set(MoveTarget, { x: px, y: py })
    return true
  }
  return false
})

// Tile position of the nearest Interactable of a given kind in the ACTIVE
// scene's world (the `world` proxy tracks whichever scene is current — see
// ecs/world.ts). Lets a smoke walk (movePlayerTo + queueInteract) onto a
// kiosk it doesn't already have a dedicated finder for (the war-room plot
// table, e.g.), instead of hunting canvas pixels.
registerDebugHandle('interactableTileByKind', (kind: InteractableKind) => {
  for (const e of world.query(Interactable, Position)) {
    if (e.get(Interactable)!.kind !== kind) continue
    const p = e.get(Position)!
    return { x: p.x / TILE, y: p.y / TILE }
  }
  return null
})

registerDebugHandle('countByKind', () => {
  let buildings = 0, walls = 0, roads = 0
  for (const _b of world.query(Building)) buildings++
  for (const _w of world.query(Wall)) walls++
  for (const _r of world.query(Road)) roads++
  return { buildings, walls, roads }
})

registerDebugHandle('setMoveTarget', (target: { x: number; y: number }) => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return false
  player.set(MoveTarget, target)
  return true
})

// Task 8 smoke helper — queue an interact against whatever Interactable
// is nearest the player right now. Mirrors the production "go to work"
// click (StatusPanel.tsx: MoveTarget + QueuedInteract), which is the
// ECS-level equivalent of a real click on a sprite; deterministic-tests
// rule 1 (drive through __uclife__, not the DOM/canvas) applies to the
// *walk-and-click* motion the same way it does to state reads. Call
// after movePlayerTo() has already placed the player within
// worldConfig.ranges.playerInteract of the target.
registerDebugHandle('queueInteract', () => {
  const player = world.queryFirst(IsPlayer, Position, MoveTarget, Action)
  if (!player) return false
  if (!player.has(QueuedInteract)) player.add(QueuedInteract)
  return true
})

// NPC introspection by EntityKey — action / position / move target /
// linked workstation. The smoke suite waits on these instead of reading
// the DOM (deterministic-tests rule 1).
registerDebugHandle('characterSnapshot', (npcKey: string) => {
  for (const e of world.query(Character, EntityKey)) {
    if (e.get(EntityKey)!.key !== npcKey) continue
    const pos = e.get(Position)
    const mt = e.get(MoveTarget)
    const ws = e.get(Job)?.workstation ?? null
    const wsTrait = ws?.get(Workstation) ?? null
    const wsPos = ws?.get(Position) ?? null
    return {
      action: e.get(Action)?.kind ?? null,
      pos: pos ? { x: pos.x, y: pos.y } : null,
      moveTarget: mt ? { x: mt.x, y: mt.y } : null,
      jobSpecId: wsTrait?.specId ?? null,
      workstationPos: wsPos ? { x: wsPos.x, y: wsPos.y } : null,
    }
  }
  return null
})

registerDebugHandle('playerSnapshot', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  const pos = player.get(Position)!
  const path = player.get(Path)
  const money = player.get(Money)
  return {
    pos: { x: pos.x, y: pos.y },
    pathLen: path?.waypoints.length ?? 0,
    pathIdx: path?.index ?? null,
    money: money?.amount ?? 0,
  }
})

// W4.2 smoke helpers — seed a vital so a test can observe recovery (sleep /
// eat) without advancing hours of sim time for it to accrue naturally.
// Vitals run 0 (satisfied) → 100 (critical); the clamp is the trait domain.
type VitalKey = 'hunger' | 'thirst' | 'fatigue' | 'hygiene' | 'boredom'

function applyVital(e: Entity, key: VitalKey, value: number): boolean {
  const v = e.get(Vitals)
  if (!v) return false
  e.set(Vitals, { ...v, [key]: Math.max(0, Math.min(100, value)) })
  return true
}

registerDebugHandle('setPlayerVital', (key: VitalKey, value: number) => {
  const player = world.queryFirst(IsPlayer, Vitals)
  return player ? applyVital(player, key, value) : false
})

registerDebugHandle('setNpcVitalByKey', (npcKey: string, key: VitalKey, value: number) => {
  for (const e of world.query(Character, EntityKey, Vitals)) {
    if (e.get(EntityKey)!.key !== npcKey) continue
    return applyVital(e, key, value)
  }
  return false
})
