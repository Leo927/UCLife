// Tactical-combat arena renderer. The HUD strips (hull/armor/flux,
// weapon queue) are DOM overlays — only the world (ships, projectiles,
// beams, target reticle, arena border) lives here.
//
// Arena world coordinates are fixed 1000×600 (ARENA_W × ARENA_H from
// src/systems/combat.ts). The Pixi canvas is sized to the viewport;
// the renderer applies a viewport transform on `root` to letterbox the
// arena into the visible area at native pixel density. Click coords go
// through screenToWorld() to convert back to arena units.
//
// Perf budget: render <2ms/frame at N=100 projectiles + 2 ships +
// arena border. Player + enemy DisplayObjects are persistent and
// updated in-place every frame; projectiles use a pool keyed by
// projectile id. New ids allocate, vanished ids destroy.

import { Application, Container, Graphics } from 'pixi.js'
import { combatConfig } from '../../config'
import { SeededRng } from '../../procgen/rng'
import { classShape } from './shipSilhouette'

export interface ShipSnap {
  x: number
  y: number
  /** Heading in radians; 0 = +x. The ship hull is drawn as a silhouette
   *  pointing along this angle so the player can see facing. */
  heading: number
  /** Hull silhouette base radius. Scales the whole sprite. */
  hullRadius: number
  /** Shield bubble radius — drawn around the hull as a faint ring. */
  shieldRadius: number
  /** Hex color for the hull/silhouette. */
  color: number
  /** Shield-ring opacity (0..1) — fades as flux saturates. 0 = shield
   *  is down. */
  shieldAlpha: number
  /** Ship class id — selects the per-class silhouette (see classShape).
   *  The hull polygon is redrawn only when this (or radius/color) changes. */
  shipClassId: string
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

export interface EnemyShipSnap extends ShipSnap {
  /** Stable id used to keep the same Pixi node attached across frames
   *  (so hull/shield Graphics aren't rebuilt every tick). */
  id: number
}

// W3 (ms-identity) Task 7 — a drifting escape pod. Not a ship: drawn as a
// small pulsing dot so it reads as a beacon, not a combatant.
export interface PodVisual {
  id: number
  x: number
  y: number
}

export interface TacticalSnapshot {
  arenaW: number
  arenaH: number
  player: ShipSnap | null
  enemies: EnemyShipSnap[]
  projectiles: ProjectileVisual[]
  beams: BeamFlashVisual[]
  // Phase 6.1 — the player-launched MS (at most one in 6.1). Drawn
  // alongside the flagship using the same friendly color but a smaller
  // hull so it reads as an MS in the arena. Null when the MS is not
  // currently in flight.
  playerMs: ShipSnap | null
  // W3 Task 7 — drifting escape pods (player + wing). Usually empty.
  pods: PodVisual[]
}

const PROJECTILE_COLOR = {
  player: 0x4ade80,
  enemy: 0xf97316,
} as const

const BEAM_COLOR = {
  player: 0x86efac,
  enemy: 0xfb923c,
} as const

// Escape-pod beacon: amber core + faint halo ring, sized like a projectile
// (a pod is a capsule, not a hull) but visually distinct from any weapon fire.
const POD_CORE_COLOR = 0xfbbf24
const POD_CORE_RADIUS = 4
const POD_HALO_RADIUS = 8
const POD_HALO_ALPHA = 0.35

// `shapeSig` caches the last-drawn (class|radius|color) so the hull polygon
// is rebuilt only when one of those changes — steady-state frames just move
// x/y/rotation. The shield ring still redraws each frame (its alpha tracks
// flux headroom).
interface ShipNode { hull: Graphics; shield: Graphics; shapeSig: string }

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
  private playerMsNode: ShipNode
  private enemyNodes = new Map<number, ShipNode>()
  private enemyShipLayer: Container
  private projectileLayer: Container
  private beamLayer: Graphics
  private projectileNodes = new Map<number, Graphics>()
  private podNodes = new Map<number, Graphics>()
  private destroyed = false
  private beamLayerAttached = false
  private playerAttached = false
  private playerMsAttached = false
  private arenaW: number
  private arenaH: number
  private viewW: number
  private viewH: number

  constructor(private app: Application, viewW: number, viewH: number, arenaW: number, arenaH: number) {
    this.viewW = viewW
    this.viewH = viewH
    this.arenaW = arenaW
    this.arenaH = arenaH

    this.root = new Container()
    this.root.label = 'tactical-arena'
    app.stage.addChild(this.root)

    // Static starfield backdrop — built ONCE here and never touched again
    // (perf rule: zero per-frame star work). Added before the border so it
    // sits behind every combatant. Seeded placement → stable across sessions.
    this.buildStarfield(arenaW, arenaH)

    this.border = new Graphics()
    this.border.rect(0, 0, arenaW, arenaH)
    this.border.stroke({ color: 0x1f1f25, width: 2 })
    this.root.addChild(this.border)

    this.projectileLayer = new Container()
    this.root.addChild(this.projectileLayer)

    // Beam layer is constructed but NOT added to the stage until it has
    // actual content — Pixi v8's batcher null-derefs on initially-empty
    // Graphics that ride along during the first frame.
    this.beamLayer = new Graphics()
    this.beamLayer.visible = false
    this.beamLayerAttached = false

    // Ships rendered above projectiles, so projectile streams don't
    // visually intersect ship cores. Same lazy-attach pattern.
    this.playerNode = this.makeShipNode()
    this.playerMsNode = this.makeShipNode()
    this.enemyShipLayer = new Container()
    this.root.addChild(this.enemyShipLayer)
    this.playerAttached = false
    this.playerMsAttached = false

    this.applyFit()
  }

  private makeShipNode(): ShipNode {
    const hull = new Graphics()
    const shield = new Graphics()
    hull.visible = false
    shield.visible = false
    return { hull, shield, shapeSig: '' }
  }

  // One-shot backdrop. Draws combatConfig.tacticalStarfield.count dots into a
  // single Graphics at seeded positions across the arena. Cost is paid once
  // at construction; the container is never cleared or redrawn. O(count) once,
  // 0 per frame — nothing here counts against the <2ms/frame arena budget.
  private buildStarfield(arenaW: number, arenaH: number): void {
    const cfg = combatConfig.tacticalStarfield
    const rng = SeededRng.fromNumber(cfg.seed)
    const color = Number(cfg.colorHex)
    const stars = new Graphics()
    stars.label = 'tactical-starfield'
    for (let i = 0; i < cfg.count; i++) {
      const x = rng.uniform() * arenaW
      const y = rng.uniform() * arenaH
      const r = cfg.minRadiusPx + rng.uniform() * (cfg.maxRadiusPx - cfg.minRadiusPx)
      const alpha = cfg.minAlpha + rng.uniform() * (cfg.maxAlpha - cfg.minAlpha)
      stars.circle(x, y, r).fill({ color, alpha })
    }
    this.root.addChild(stars)
  }

  resize(viewW: number, viewH: number): void {
    this.viewW = viewW
    this.viewH = viewH
    this.app.renderer.resize(viewW, viewH)
    this.applyFit()
  }

  // Letterbox-fit ARENA_W × ARENA_H into the current viewport. Centered;
  // shorter screen-axis sets the scale so the whole arena always fits.
  //
  // This math is duplicated in src/test/canvasHitTest.ts's
  // tacticalWorldToScreen() — the renderer instance lives only on a
  // React-local ref with no global handle, so smoke tests can't call
  // applyFit()/screenToWorld() directly. Changing this formula requires
  // updating that mirror too.
  private applyFit(): void {
    const sx = this.viewW / this.arenaW
    const sy = this.viewH / this.arenaH
    const s = Math.min(sx, sy)
    this.root.scale.set(s, s)
    this.root.x = Math.round((this.viewW - this.arenaW * s) / 2)
    this.root.y = Math.round((this.viewH - this.arenaH * s) / 2)
  }

  // Screen pixel → arena world coords. Inverse of applyFit(). See the
  // mirror note on applyFit() above.
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.root.scale.x || 1
    return { x: (sx - this.root.x) / s, y: (sy - this.root.y) / s }
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
    this.podNodes.clear()
  }

  update(snap: TacticalSnapshot): void {
    // A late RAF can fire after the React effect destroys this renderer
    // (combat closes → poll loop's RAF still has a frame queued). Bail
    // before touching destroyed Pixi Graphics.
    if (this.destroyed) return
    const PROF = tacticalStats.enabled
    const t0 = PROF ? performance.now() : 0

    this.syncPlayer(snap.player)
    this.syncPlayerMs(snap.playerMs)
    this.syncEnemies(snap.enemies)
    this.syncProjectiles(snap.projectiles)
    this.syncPods(snap.pods)
    this.syncBeams(snap.beams)

    if (PROF) {
      tacticalStats.frames++
      tacticalStats.totalUpdateMs += performance.now() - t0
      tacticalStats.projectileNodes = this.projectileNodes.size
    }
  }

  private syncPlayer(snap: ShipSnap | null): void {
    const node = this.playerNode
    if (!snap) {
      node.hull.visible = false
      node.shield.visible = false
      return
    }
    if (!this.playerAttached) {
      this.root.addChild(node.shield)
      this.root.addChild(node.hull)
      this.playerAttached = true
    }
    this.drawShip(node, snap)
  }

  private syncPlayerMs(snap: ShipSnap | null): void {
    const node = this.playerMsNode
    if (!snap) {
      node.hull.visible = false
      node.shield.visible = false
      return
    }
    if (!this.playerMsAttached) {
      this.root.addChild(node.shield)
      this.root.addChild(node.hull)
      this.playerMsAttached = true
    }
    this.drawShip(node, snap)
  }

  private syncEnemies(snaps: EnemyShipSnap[]): void {
    const seen = new Set<number>()
    for (const s of snaps) {
      seen.add(s.id)
      let node = this.enemyNodes.get(s.id)
      if (!node) {
        node = this.makeShipNode()
        this.enemyShipLayer.addChild(node.shield)
        this.enemyShipLayer.addChild(node.hull)
        this.enemyNodes.set(s.id, node)
      }
      this.drawShip(node, s)
    }
    for (const [id, node] of this.enemyNodes) {
      if (!seen.has(id)) {
        node.hull.destroy()
        node.shield.destroy()
        this.enemyNodes.delete(id)
      }
    }
  }

  private drawShip(node: ShipNode, snap: ShipSnap): void {
    node.hull.visible = true
    node.shield.visible = snap.shieldAlpha > 0.05

    // Shield bubble — faint ring around hull. Alpha encodes how much
    // headroom the flux capacitor still has.
    node.shield.clear()
      .circle(0, 0, snap.shieldRadius)
      .stroke({ color: snap.color, width: 2, alpha: snap.shieldAlpha })
    node.shield.x = snap.x
    node.shield.y = snap.y

    // Hull — per-class silhouette pointing along heading. The polygon is
    // rebuilt only when the class/radius/color changes (shapeSig cache);
    // steady-state frames just re-place x/y/rotation. Polygon array is the
    // v8-blessed path shape (moveTo/lineTo + closePath + fill().stroke()
    // chains hit a Pixi v8 batcher null deref).
    const r = snap.hullRadius
    const shape = classShape(snap.shipClassId)
    const sig = `${shape.family}|${r}|${snap.color}`
    if (node.shapeSig !== sig) {
      const scaled = shape.points.map((n) => n * r)
      node.hull.clear()
        .poly(scaled)
        .fill({ color: snap.color, alpha: 0.92 })
        .stroke({ color: 0xffffff, width: 1, alpha: 0.55 })
      node.shapeSig = sig
    }
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

  // W3 Task 7 — escape pods, pooled by id like projectiles. P is 0 almost
  // always and single-digit at worst, so this adds nothing measurable to
  // the <2ms/frame budget.
  private syncPods(pods: PodVisual[]): void {
    const seen = new Set<number>()
    for (const p of pods) {
      seen.add(p.id)
      let g = this.podNodes.get(p.id)
      if (!g) {
        g = new Graphics()
        g.circle(0, 0, POD_HALO_RADIUS).stroke({ color: POD_CORE_COLOR, width: 1, alpha: POD_HALO_ALPHA })
        g.circle(0, 0, POD_CORE_RADIUS).fill(POD_CORE_COLOR)
        this.projectileLayer.addChild(g)
        this.podNodes.set(p.id, g)
      }
      g.x = p.x
      g.y = p.y
    }
    for (const [id, g] of this.podNodes) {
      if (!seen.has(id)) {
        g.destroy()
        this.podNodes.delete(id)
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

}
