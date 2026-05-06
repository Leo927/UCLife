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
  /** Heading in radians; 0 = +x. The ship hull is drawn as a triangle
   *  pointing along this angle so the player can see facing. */
  heading: number
  /** Hull (triangle) base radius. Scales the whole sprite. */
  hullRadius: number
  /** Shield bubble radius — drawn around the hull as a faint ring. */
  shieldRadius: number
  /** Hex color for the hull/silhouette. */
  color: number
  /** Shield-ring opacity (0..1) — fades as flux saturates. 0 = shield
   *  is down. */
  shieldAlpha: number
}

export interface ProjectileVisual {
  id: number
  x: number
  y: number
  ownerSide: 'player' | 'enemy'
}

export interface BeamFlashVisual {
  id: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  /** 0..1, fades 1 → 0 over the flash lifetime. */
  alpha: number
  ownerSide: 'player' | 'enemy'
}

export interface TacticalSnapshot {
  arenaW: number
  arenaH: number
  player: ShipSnap | null
  enemy: ShipSnap | null
  projectiles: ProjectileVisual[]
  beams: BeamFlashVisual[]
  /** Player's queued move target — drawn as a small reticle so the
   *  player can see the click landed. Null = no target queued. */
  playerTarget: { x: number; y: number } | null
}

const PROJECTILE_COLOR = {
  player: 0x4ade80,
  enemy: 0xf97316,
} as const

const BEAM_COLOR = {
  player: 0x86efac,
  enemy: 0xfb923c,
} as const

interface ShipNode { hull: Graphics; shield: Graphics }

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
  private beamLayer: Graphics
  private targetMarker: Graphics
  private projectileNodes = new Map<number, Graphics>()
  private destroyed = false
  private beamLayerAttached = false
  private targetMarkerAttached = false
  private playerAttached = false
  private enemyAttached = false

  constructor(app: Application, arenaW: number, arenaH: number) {
    this.root = new Container()
    this.root.label = 'tactical-arena'
    app.stage.addChild(this.root)

    this.border = new Graphics()
    this.border.rect(0, 0, arenaW, arenaH)
    this.border.stroke({ color: 0x1f1f25, width: 2 })
    this.root.addChild(this.border)

    this.projectileLayer = new Container()
    this.root.addChild(this.projectileLayer)

    // Beam + target marker layers are constructed but NOT added to the
    // stage until they have actual content — Pixi v8's batcher null-derefs
    // on initially-empty Graphics that ride along during the first frame.
    this.beamLayer = new Graphics()
    this.beamLayer.visible = false
    this.beamLayerAttached = false

    this.targetMarker = new Graphics()
    this.targetMarker.visible = false
    this.targetMarkerAttached = false

    // Ships rendered above projectiles, so projectile streams don't
    // visually intersect ship cores. Same lazy-attach pattern.
    this.playerNode = this.makeShipNode()
    this.enemyNode = this.makeShipNode()
    this.playerAttached = false
    this.enemyAttached = false
  }

  private makeShipNode(): ShipNode {
    const hull = new Graphics()
    const shield = new Graphics()
    hull.visible = false
    shield.visible = false
    return { hull, shield }
  }

  destroy(): void {
    // Mark destroyed so any in-flight update() bails. Don't destroy the
    // root container ourselves — PixiCanvas's effect cleanup destroys
    // the whole Application (including stage children) after this call.
    // Manually destroying root mid-React-cycle leaves a dead container
    // attached to app.stage, which Pixi's auto-render ticker then tries
    // to traverse and chokes on the null-geometry batcher path.
    this.destroyed = true
    this.projectileNodes.clear()
  }

  update(snap: TacticalSnapshot): void {
    // A late RAF can fire after the React effect destroys this renderer
    // (combat closes → poll loop's RAF still has a frame queued). Bail
    // before touching destroyed Pixi Graphics.
    if (this.destroyed) return
    const PROF = tacticalStats.enabled
    const t0 = PROF ? performance.now() : 0

    this.syncShip(this.playerNode, snap.player)
    this.syncShip(this.enemyNode, snap.enemy)
    this.syncProjectiles(snap.projectiles)
    this.syncBeams(snap.beams)
    this.syncTargetMarker(snap.playerTarget)

    if (PROF) {
      tacticalStats.frames++
      tacticalStats.totalUpdateMs += performance.now() - t0
      tacticalStats.projectileNodes = this.projectileNodes.size
    }
  }

  private syncShip(node: ShipNode, snap: ShipSnap | null): void {
    if (!snap) {
      node.hull.visible = false
      node.shield.visible = false
      return
    }
    // Lazy-attach: only add to stage once we have geometry to show.
    const isPlayer = node === this.playerNode
    if (isPlayer && !this.playerAttached) {
      this.root.addChild(node.shield)
      this.root.addChild(node.hull)
      this.playerAttached = true
    } else if (!isPlayer && !this.enemyAttached) {
      this.root.addChild(node.shield)
      this.root.addChild(node.hull)
      this.enemyAttached = true
    }
    node.hull.visible = true
    node.shield.visible = snap.shieldAlpha > 0.05

    // Shield bubble — faint ring around hull. Alpha encodes how much
    // headroom the flux capacitor still has.
    node.shield.clear()
      .circle(0, 0, snap.shieldRadius)
      .stroke({ color: snap.color, width: 2, alpha: snap.shieldAlpha })
    node.shield.x = snap.x
    node.shield.y = snap.y

    // Hull — arrowhead silhouette pointing along heading. Polygon array
    // is the v8-blessed path shape; the Graphics rotates so the ship
    // visibly turns toward its target. (moveTo/lineTo + closePath +
    // fill().stroke() chains hit a Pixi v8 batcher null deref.)
    const r = snap.hullRadius
    node.hull.clear()
      .poly([
        r, 0,                  // nose
        -r * 0.7, r * 0.6,     // starboard rear
        -r * 0.4, 0,           // tail-notch
        -r * 0.7, -r * 0.6,    // port rear
      ])
      .fill({ color: snap.color, alpha: 0.92 })
      .stroke({ color: 0xffffff, width: 1, alpha: 0.55 })
    node.hull.x = snap.x
    node.hull.y = snap.y
    node.hull.rotation = snap.heading
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

  private syncBeams(beams: BeamFlashVisual[]): void {
    // Beams are short-lived flashes; redraw the entire layer each frame
    // (typically 0–4 active beams at most, so the cost is trivial).
    // Each beam is its own subpath + stroke pair — chaining multiple
    // moveTo/lineTo subpaths under one stroke trips the v8 batcher.
    if (beams.length === 0) {
      if (this.beamLayerAttached) this.beamLayer.visible = false
      return
    }
    if (!this.beamLayerAttached) {
      this.root.addChild(this.beamLayer)
      this.beamLayerAttached = true
    }
    this.beamLayer.visible = true
    this.beamLayer.clear()
    for (const b of beams) {
      this.beamLayer.moveTo(b.fromX, b.fromY)
      this.beamLayer.lineTo(b.toX, b.toY)
      this.beamLayer.stroke({ color: BEAM_COLOR[b.ownerSide], width: 3, alpha: b.alpha })
    }
  }

  private syncTargetMarker(target: { x: number; y: number } | null): void {
    if (!target) {
      if (this.targetMarkerAttached) this.targetMarker.visible = false
      return
    }
    if (!this.targetMarkerAttached) {
      this.root.addChild(this.targetMarker)
      this.targetMarkerAttached = true
    }
    this.targetMarker.visible = true
    // Reticle: outer ring + four cross-hatches. Each subpath is closed
    // with its own stroke() so the v8 batcher doesn't see a multi-
    // subpath build-up that breaks geometry.
    const g = this.targetMarker
    g.clear()
    g.circle(0, 0, 8)
    g.stroke({ color: 0x4ade80, width: 1, alpha: 0.5 })
    for (const [x1, y1, x2, y2] of [
      [-12, 0, -4, 0], [4, 0, 12, 0], [0, -12, 0, -4], [0, 4, 0, 12],
    ] as const) {
      g.moveTo(x1, y1)
      g.lineTo(x2, y2)
      g.stroke({ color: 0x4ade80, width: 1, alpha: 0.7 })
    }
    g.x = target.x
    g.y = target.y
  }
}
