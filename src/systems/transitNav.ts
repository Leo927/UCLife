// NPC-only transit navigation edges (Design/phasing.md § Step 1).
//
// Transit-terminal kiosks and orbital-lift kiosks that share a scene world
// become low-cost navigation portals: a pair of kiosk positions the HPA*
// abstract graph may hop between when (and only when) it is pathing for an
// NPC. The player's foot-pathfinding never sees these edges, so click-to-move
// can't teleport across for free — the fare gate holds (the player rides
// transit through the fare-gated kiosk interaction in systems/interaction.ts).
//
// Why same-world only: a portal is a single intra-world hop between two
// walkable cells. Cross-scene transit (airport flights, the orbital lift
// before the drydock is folded into vonBraunCity) is a destroy-and-respawn
// migration, not a graph edge — there is no single cell-index pair spanning
// two koota worlds. Once Step 2 relocates the drydock into vonBraunCity, both
// lift kiosks live in one world and the lift becomes a real portal.
//
// This module deliberately knows nothing about the pathfinding grid: it
// returns kiosk *pixel positions* and lets hpa.ts (which owns the wall grid +
// cell snapping) resolve them to stand-cells. That keeps the dependency edge
// one-way (hpa → transitNav) with no pathfinding import cycle.
//
// Perf: portals are O(terminal-pairs + lift-pairs) — single-digit per scene.
// Derivation runs once per scene and is cached until markTransitNavDirty()
// invalidates it (same lifecycle as the wall grid + HPA cluster graph).

import type { World } from 'koota'
import { Transit, OrbitalLift, Position } from '../ecs/traits'
import { worldConfig } from '../config'
import { getActiveSceneId, type SceneId } from '../ecs/world'

export interface TransitPortal {
  // Pixel positions of the two kiosks. Bidirectional: an NPC may hop a → b or
  // b → a. hpa.ts snaps each to the walkable stand-cell an NPC routes to.
  ax: number; ay: number
  bx: number; by: number
}

interface ScenePortals {
  portals: TransitPortal[]
  dirty: boolean
}

const scenePortals = new Map<SceneId, ScenePortals>()

function getScenePortals(id: SceneId): ScenePortals {
  let p = scenePortals.get(id)
  if (!p) {
    p = { portals: [], dirty: true }
    scenePortals.set(id, p)
  }
  return p
}

export function markTransitNavDirty(sceneId?: SceneId): void {
  const id = sceneId ?? getActiveSceneId()
  const p = getScenePortals(id)
  p.dirty = true
  p.portals = []
}

function buildPortals(world: World): TransitPortal[] {
  const out: TransitPortal[] = []

  // Transit terminals: within a scene the public-transport network connects
  // every terminal to every other (the kiosk lists all same-scene
  // destinations). Model that as an all-pairs portal set so an NPC can hop
  // from any terminal to any other in one edge.
  const transitPos: { x: number; y: number }[] = []
  for (const ent of world.query(Transit, Position)) {
    transitPos.push({ ...ent.get(Position)! })
  }
  for (let i = 0; i < transitPos.length; i++) {
    for (let j = i + 1; j < transitPos.length; j++) {
      out.push({ ax: transitPos[i].x, ay: transitPos[i].y, bx: transitPos[j].x, by: transitPos[j].y })
    }
  }

  // Orbital lifts: pair the two kiosks carrying the same liftId *within this
  // world*. Pre-relocation the kiosks live in separate worlds, so no
  // same-world pair exists and the lift contributes no portal (NPCs can't
  // foot-route across scenes — that stays a player-only fare-gated ride).
  const liftPosById = new Map<string, { x: number; y: number }[]>()
  for (const ent of world.query(OrbitalLift, Position)) {
    const ol = ent.get(OrbitalLift)!
    const arr = liftPosById.get(ol.liftId) ?? []
    arr.push({ ...ent.get(Position)! })
    liftPosById.set(ol.liftId, arr)
  }
  for (const cells of liftPosById.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        out.push({ ax: cells[i].x, ay: cells[i].y, bx: cells[j].x, by: cells[j].y })
      }
    }
  }

  return out
}

// Cached per scene; rebuilt lazily after markTransitNavDirty(). hpaFind reads
// this only when pathing for an NPC.
export function getTransitPortals(world: World): readonly TransitPortal[] {
  const sp = getScenePortals(getActiveSceneId())
  if (sp.dirty) {
    sp.portals = buildPortals(world)
    sp.dirty = false
  }
  return sp.portals
}

export const TRANSIT_EDGE_COST = worldConfig.transitNav.edgeCostUnits
