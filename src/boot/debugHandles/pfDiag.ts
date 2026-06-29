// Click-to-navigate pathfinding probe for the deterministic smoke suite.
// pfDiagSealedProbe finds a target the player can't reach and reports whether
// the door-aware reachability gate caught it; pfDiagOpenProbe reports a
// reachable target for the negative case.

import type { Entity } from 'koota'
import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { IsPlayer, Position, Door } from '../../ecs/traits'
import { findPath } from '../../systems/pathfinding'
import { hpaStats, resetHpaStats } from '../../systems/hpa'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

interface ProbeResult {
  pathLen: number
  reachabilityGateFail: number
  targetPx: { x: number; y: number }
}

function probe(player: Entity, from: { x: number; y: number }, target: { x: number; y: number }): ProbeResult {
  resetHpaStats()
  hpaStats.enabled = true
  const wps = findPath(world, player, from, target)
  const reachabilityGateFail = hpaStats.reachabilityGateFail
  hpaStats.enabled = false
  return { pathLen: wps.length, reachabilityGateFail, targetPx: target }
}

registerDebugHandle('pfDiagSealedProbe', () => {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return { found: false, reason: 'no player' }
  const pos = player.get(Position)!
  const from = { x: pos.x, y: pos.y }

  const gates: Array<{ cx: number; cy: number }> = []
  for (const e of world.query(Door)) {
    const d = e.get(Door)!
    if (d.factionGate) gates.push({ cx: d.x + d.w / 2, cy: d.y + d.h / 2 })
  }
  gates.sort((a, b) => a.cy - b.cy || a.cx - b.cx)

  const SPAN = 8
  let numPathLen0 = 0
  for (const g of gates) {
    for (let dy = -SPAN; dy <= SPAN; dy++) {
      for (let dx = -SPAN; dx <= SPAN; dx++) {
        const r = probe(player, from, { x: g.cx + dx * TILE, y: g.cy + dy * TILE })
        if (r.pathLen === 0) numPathLen0++
        if (r.pathLen === 0 && r.reachabilityGateFail > 0) return { found: true, ...r }
      }
    }
  }
  return { found: false, reason: 'no gate-caught unreachable target', gateCount: gates.length, numPathLen0 }
})

registerDebugHandle('pfDiagOpenProbe', () => {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return { found: false }
  const pos = player.get(Position)!
  const from = { x: pos.x, y: pos.y }
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
  for (let ring = 2; ring <= 12; ring++) {
    for (const [dx, dy] of dirs) {
      const r = probe(player, from, { x: pos.x + dx * ring * TILE, y: pos.y + dy * ring * TILE })
      if (r.pathLen > 0) return { found: true, ...r }
    }
  }
  return { found: false }
})
