// Phase 2 of the Konva → Pixi migration. Imperative renderer driven by
// per-frame ECS snapshots. React only mounts the canvas — the renderer
// itself owns all DisplayObjects.
//
// Architectural invariants:
//
// 1. DisplayObjects persist across frames, keyed by ECS id (body.bodyId,
//    poi.id). New entities allocate once; existing ones get x/y/text/etc.
//    updates. Vanished entities are destroyed and dropped from the map.
//    This is the perf-budget rule's "no per-frame allocation in hot path."
//
// 2. Graphics geometry is regenerated every update via clear()+redraw.
//    Bodies/POIs are O(N) per frame at N≈30 each, well under budget.
//    Stroke widths depend on camera scale — redrawing is cheaper than
//    tracking scale changes per node.
//
// 3. Camera = a single `viewport` Container. World-space children sit
//    inside it; pan + zoom = updating viewport.x/y/scale once per frame.
//
// 4. POI hit-testing stays as a screen→world transform + linear scan
//    (~30 POIs, bounded by data file size). Pixi per-DisplayObject
//    pointer events are NOT used here because the original implementation
//    needed custom snap-radius logic that doesn't map cleanly to bubbled
//    events.
//
// Perf budget: render <3ms/frame at N=50 ships + 200 projectiles + 500
// stars + 30 bodies. Phase 2 covers bodies + POIs + ship + course only;
// projectiles / stars are deferred to later phases.

import { Application, Container, Graphics, Text, ColorMatrixFilter } from 'pixi.js'
import { AdvancedBloomFilter } from 'pixi-filters'
import type { CelestialKind } from '../../data/celestialBodies'
import { ParticlePool, emitThrust } from './particles'
import type { BodySnapshot, PoiSnapshot, ShipSnapshot, SpaceSnapshot } from '../spaceSnapshot'

const BODY_COLOR: Record<CelestialKind, { fill: number; stroke: number }> = {
  star:     { fill: 0xfde68a, stroke: 0xfef9c3 },
  planet:   { fill: 0x1e3a8a, stroke: 0x93c5fd },
  moon:     { fill: 0x525252, stroke: 0xa3a3a3 },
  colony:   { fill: 0x14532d, stroke: 0x4ade80 },
  asteroid: { fill: 0x3f2d14, stroke: 0xa16207 },
}

interface BodyNode { root: Container; circle: Graphics; label: Text }
interface PoiNode { root: Container; rect: Graphics; ring: Graphics; label: Text }

export const spaceStats = {
  enabled: false,
  frames: 0,
  totalUpdateMs: 0,
  bodyNodes: 0,
  poiNodes: 0,
}

export function resetSpaceStats(): void {
  spaceStats.frames = 0
  spaceStats.totalUpdateMs = 0
  spaceStats.bodyNodes = 0
  spaceStats.poiNodes = 0
}

export class PixiSpaceRenderer {
  private viewport: Container
  private bodyLayer: Container
  private courseLayer: Container
  private poiLayer: Container
  private particleLayer: Container
  private shipLayer: Container
  private bodyNodes = new Map<string, BodyNode>()
  private poiNodes = new Map<string, PoiNode>()
  private shipShape: Graphics
  private courseLine: Graphics
  private particles: ParticlePool
  private viewW: number
  private viewH: number

  constructor(private app: Application, viewW: number, viewH: number) {
    this.viewW = viewW
    this.viewH = viewH

    this.viewport = new Container()
    this.viewport.label = 'space-viewport'
    app.stage.addChild(this.viewport)

    // Layer order: bodies → course → POIs → particles (engine trails, etc) → ship.
    // Particles render *under* the ship so the trail appears to come from
    // behind it.
    this.bodyLayer = new Container()
    this.courseLayer = new Container()
    this.poiLayer = new Container()
    this.particleLayer = new Container()
    this.shipLayer = new Container()
    this.viewport.addChild(this.bodyLayer)
    this.viewport.addChild(this.courseLayer)
    this.viewport.addChild(this.poiLayer)
    this.viewport.addChild(this.particleLayer)
    this.viewport.addChild(this.shipLayer)

    this.courseLine = new Graphics()
    this.courseLayer.addChild(this.courseLine)

    this.shipShape = new Graphics()
    this.shipLayer.addChild(this.shipShape)

    this.particles = new ParticlePool(app, this.particleLayer)

    // Post-fx, applied at layer granularity for tighter cost control.
    // Bloom on engine trails + bodies (which include the star) = the bright
    // sources. Bloom on the whole viewport would also light up POI rects
    // and ship outlines, which we don't want — those should read crisp.
    // Subtle cold-blue color grading on the whole viewport sets mood.
    const bloom = new AdvancedBloomFilter({
      threshold: 0.5,
      bloomScale: 1.0,
      brightness: 1.0,
      blur: 6,
      quality: 4,
    })
    this.particleLayer.filters = [bloom]
    this.bodyLayer.filters = [bloom]

    const grading = new ColorMatrixFilter()
    // Slight cold-blue + reduced saturation. Matrix below desaturates ~10%
    // and lifts blues ~5%; preserves the existing palette without washing
    // out the celestial body colors.
    grading.matrix = [
      0.95, 0,    0,    0, 0,
      0,    0.95, 0,    0, 0,
      0,    0,    1.05, 0, 0,
      0,    0,    0,    1, 0,
    ]
    this.viewport.filters = [grading]
  }

  resize(w: number, h: number): void {
    this.viewW = w
    this.viewH = h
    this.app.renderer.resize(w, h)
  }

  destroy(): void {
    this.particles.destroy()
    this.viewport.destroy({ children: true })
    this.bodyNodes.clear()
    this.poiNodes.clear()
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const sc = this.viewport.scale.x || 1
    return { x: (sx - this.viewport.x) / sc, y: (sy - this.viewport.y) / sc }
  }

  update(snap: SpaceSnapshot): void {
    const PROF = spaceStats.enabled
    const t0 = PROF ? performance.now() : 0

    let scale = 1
    let cx = snap.ship?.x ?? 0
    let cy = snap.ship?.y ?? 0
    if (snap.fitMode && snap.fit) {
      scale = snap.fit.scale
      cx = snap.fit.cx
      cy = snap.fit.cy
    }
    this.viewport.x = -cx * scale + this.viewW / 2
    this.viewport.y = -cy * scale + this.viewH / 2
    this.viewport.scale.set(scale, scale)

    this.syncBodies(snap.bodies, scale)
    this.syncPois(snap.pois, scale, snap.hoveredPoiId, snap.dockSnapRadius)
    this.syncCourse(snap.coursePreview, scale)
    this.syncShip(snap.ship, scale)
    this.syncParticles(snap.ship, snap.dtSec)

    if (PROF) {
      spaceStats.frames++
      spaceStats.totalUpdateMs += performance.now() - t0
      spaceStats.bodyNodes = this.bodyNodes.size
      spaceStats.poiNodes = this.poiNodes.size
    }
  }

  private syncParticles(ship: ShipSnapshot | null, dtSec: number): void {
    if (ship) {
      // Emit thrust only when the ship is actually under thrust — proxied by
      // active course. ECS Velocity may be non-zero during coast, which we
      // don't want to trail.
      if (ship.course?.active) {
        emitThrust(this.particles, ship.x, ship.y, ship.vx, ship.vy, dtSec, 60)
      }
    }
    this.particles.update(dtSec)
  }

  private syncBodies(bodies: BodySnapshot[], scale: number): void {
    const seen = new Set<string>()
    for (const b of bodies) {
      seen.add(b.bodyId)
      let node = this.bodyNodes.get(b.bodyId)
      if (!node) {
        const root = new Container()
        const circle = new Graphics()
        const label = new Text({
          text: b.nameZh,
          style: { fill: 0xcbd5e1, fontSize: 14, fontFamily: 'system-ui, sans-serif' },
        })
        root.addChild(circle)
        root.addChild(label)
        this.bodyLayer.addChild(root)
        node = { root, circle, label }
        this.bodyNodes.set(b.bodyId, node)
      }
      const c = BODY_COLOR[b.kind]
      node.circle.clear()
        .circle(0, 0, b.radius)
        .fill(c.fill)
        .stroke({ color: c.stroke, width: 2 / scale })
      node.root.x = b.x
      node.root.y = b.y
      if (node.label.text !== b.nameZh) node.label.text = b.nameZh
      node.label.x = b.radius + 6 / scale
      node.label.y = -8 / scale
      node.label.style.fontSize = 14 / scale
    }
    for (const [id, node] of this.bodyNodes) {
      if (!seen.has(id)) {
        node.root.destroy({ children: true })
        this.bodyNodes.delete(id)
      }
    }
  }

  private syncPois(pois: PoiSnapshot[], scale: number, hoveredId: string | null, dockSnapRadius: number): void {
    const seen = new Set<string>()
    for (const p of pois) {
      const id = p.poi.id
      seen.add(id)
      let node = this.poiNodes.get(id)
      if (!node) {
        const root = new Container()
        const rect = new Graphics()
        const ring = new Graphics()
        const label = new Text({
          text: p.poi.shortZh ?? p.poi.nameZh,
          style: {
            fill: 0xe2e8f0,
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 80,
          },
        })
        root.addChild(rect)
        root.addChild(ring)
        root.addChild(label)
        this.poiLayer.addChild(root)
        node = { root, rect, ring, label }
        this.poiNodes.set(id, node)
      }
      const r = 6
      node.rect.clear()
        .rect(-r, -r, r * 2, r * 2)
        .fill(0x0ea5e9)
        .stroke({ color: 0xbae6fd, width: 1.5 / scale })
      node.ring.clear()
      if (hoveredId === id) {
        // Draw the donut as a stroke at the midpoint radius — width spans
        // (outer - inner). Avoids the even-odd-fill / cut() complexity.
        const inner = dockSnapRadius - 2
        const outer = dockSnapRadius
        node.ring
          .circle(0, 0, (inner + outer) / 2)
          .stroke({ color: 0xfde68a, alpha: 0.5, width: outer - inner })
      }
      node.root.x = p.x
      node.root.y = p.y
      const labelText = p.poi.shortZh ?? p.poi.nameZh
      if (node.label.text !== labelText) node.label.text = labelText
      node.label.x = -40
      node.label.y = r + 4 / scale
      node.label.style.fontSize = 12 / scale
      node.label.style.wordWrapWidth = 80
    }
    for (const [id, node] of this.poiNodes) {
      if (!seen.has(id)) {
        node.root.destroy({ children: true })
        this.poiNodes.delete(id)
      }
    }
  }

  private syncCourse(preview: SpaceSnapshot['coursePreview'], scale: number): void {
    this.courseLine.clear()
    if (!preview) return
    // Dashed stroke approximation: alternating moveTo/lineTo segments, then
    // one stroke at the end strokes all of them together.
    const dash = 8 / scale
    const dx = preview.toX - preview.fromX
    const dy = preview.toY - preview.fromY
    const len = Math.hypot(dx, dy)
    if (len <= 0) return
    const ux = dx / len
    const uy = dy / len
    let t = 0
    while (t < len) {
      const t2 = Math.min(t + dash, len)
      this.courseLine
        .moveTo(preview.fromX + ux * t, preview.fromY + uy * t)
        .lineTo(preview.fromX + ux * t2, preview.fromY + uy * t2)
      t = t2 + dash
    }
    this.courseLine.stroke({ color: 0xfacc15, width: 2 / scale })
  }

  private syncShip(ship: ShipSnapshot | null, scale: number): void {
    this.shipShape.clear()
    if (!ship) {
      this.shipLayer.visible = false
      return
    }
    this.shipLayer.visible = true
    let angle = -Math.PI / 2
    if (ship.vx !== 0 || ship.vy !== 0) angle = Math.atan2(ship.vy, ship.vx)
    this.shipLayer.x = ship.x
    this.shipLayer.y = ship.y
    this.shipLayer.rotation = angle
    this.shipShape
      .poly([12, 0, -8, -7, -8, 7])
      .fill(0xfacc15)
      .stroke({ color: 0xfef3c7, width: 1 / scale })
  }
}
