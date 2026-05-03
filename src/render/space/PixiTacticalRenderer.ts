// Phase 2.5 of the Konva → Pixi migration. Tactical-combat arena
// renderer — replaces the inline SVG in src/ui/TacticalView.tsx. The
// HUD strips (hull/armor/flux, weapon queue) stay DOM since they're
// React-state-driven anyway.
//
// Arena world coordinates are fixed 1000×600 (ARENA_W × ARENA_H from
// src/systems/combat.ts). The Pixi canvas is created at native arena
// size and CSS-scaled by the parent container. Click coords are
// converted via getBoundingClientRect, so the existing input math
// stays unchanged.
//
// Perf budget: render <2ms/frame at N=100 projectiles + 2 ships +
// arena border. Player + enemy DisplayObjects are persistent and
// updated in-place every frame; projectiles use a pool keyed by
// projectile id. New ids allocate, vanished ids destroy.

import { Application, Container, Graphics } from 'pixi.js'

export interface ShipSnap {
  x: number
  y: number
  /** Outer-ring base radius. */
  ringRadius: number
  /** Inner solid radius. */
  coreRadius: number
  /** Hex color for the ring/core. */
  color: number
  /** Outer-ring opacity (0..1) — encodes flux/shield state. */
  ringAlpha: number
}

export interface ProjectileVisual {
  id: number
  x: number
  y: number
  ownerSide: 'player' | 'enemy'
}

export interface TacticalSnapshot {
  arenaW: number
  arenaH: number
  player: ShipSnap | null
  enemy: ShipSnap | null
  projectiles: ProjectileVisual[]
}

const PROJECTILE_COLOR = {
  player: 0x4ade80,
  enemy: 0xf97316,
} as const

interface ShipNode { ring: Graphics; core: Graphics }

export const tacticalStats = {
  enabled: false,
  frames: 0,
  totalUpdateMs: 0,
  projectileNodes: 0,
}

export function resetTacticalStats(): void {
  tacticalStats.frames = 0
  tacticalStats.totalUpdateMs = 0
  tacticalStats.projectileNodes = 0
}

export class PixiTacticalRenderer {
  private root: Container
  private border: Graphics
  private playerNode: ShipNode
  private enemyNode: ShipNode
  private projectileLayer: Container
  private projectileNodes = new Map<number, Graphics>()

  constructor(app: Application, arenaW: number, arenaH: number) {
    this.root = new Container()
    this.root.label = 'tactical-arena'
    app.stage.addChild(this.root)

    this.border = new Graphics()
    this.border
      .rect(0, 0, arenaW, arenaH)
      .stroke({ color: 0x1f1f25, width: 2 })
    this.root.addChild(this.border)

    this.projectileLayer = new Container()
    this.root.addChild(this.projectileLayer)

    // Ships rendered above projectiles, so projectile streams don't
    // visually intersect ship cores.
    this.playerNode = this.makeShipNode()
    this.enemyNode = this.makeShipNode()
    this.root.addChild(this.playerNode.ring)
    this.root.addChild(this.playerNode.core)
    this.root.addChild(this.enemyNode.ring)
    this.root.addChild(this.enemyNode.core)
  }

  private makeShipNode(): ShipNode {
    return { ring: new Graphics(), core: new Graphics() }
  }

  destroy(): void {
    this.root.destroy({ children: true })
    this.projectileNodes.clear()
  }

  update(snap: TacticalSnapshot): void {
    const PROF = tacticalStats.enabled
    const t0 = PROF ? performance.now() : 0

    this.syncShip(this.playerNode, snap.player)
    this.syncShip(this.enemyNode, snap.enemy)
    this.syncProjectiles(snap.projectiles)

    if (PROF) {
      tacticalStats.frames++
      tacticalStats.totalUpdateMs += performance.now() - t0
      tacticalStats.projectileNodes = this.projectileNodes.size
    }
  }

  private syncShip(node: ShipNode, snap: ShipSnap | null): void {
    if (!snap) {
      node.ring.visible = false
      node.core.visible = false
      return
    }
    node.ring.visible = true
    node.core.visible = true
    node.ring.clear()
      .circle(0, 0, snap.ringRadius)
      .stroke({ color: snap.color, width: 2, alpha: snap.ringAlpha })
    node.ring.x = snap.x
    node.ring.y = snap.y
    node.core.clear()
      .circle(0, 0, snap.coreRadius)
      .fill(snap.color)
    node.core.x = snap.x
    node.core.y = snap.y
  }

  private syncProjectiles(projectiles: ProjectileVisual[]): void {
    const seen = new Set<number>()
    for (const p of projectiles) {
      seen.add(p.id)
      let g = this.projectileNodes.get(p.id)
      if (!g) {
        g = new Graphics()
        g.circle(0, 0, 3).fill(PROJECTILE_COLOR[p.ownerSide])
        this.projectileLayer.addChild(g)
        this.projectileNodes.set(p.id, g)
      }
      g.x = p.x
      g.y = p.y
    }
    for (const [id, g] of this.projectileNodes) {
      if (!seen.has(id)) {
        g.destroy()
        this.projectileNodes.delete(id)
      }
    }
  }
}
