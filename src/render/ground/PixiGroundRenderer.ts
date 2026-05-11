// Phase 5 of the Konva → Pixi migration. Imperative renderer for the
// ground city scene driven by per-frame ECS snapshots. Mirrors the
// architecture of PixiSpaceRenderer.
//
// Architectural invariants:
//
// 1. DisplayObjects persist across frames, keyed by ECS Entity. The
//    snapshot caller passes the visible entity set each frame; this
//    class reconciles (add new, update existing, destroy vanished).
//    Hot path is allocation-free in steady state.
//
// 2. Camera = a single `viewport` Container whose x/y is the negative
//    camera offset. World-space children sit inside it. Layer order
//    bottom→top: background, grid, roads, buildings, walls, doors,
//    beds, barSeats, interactables, npcs, player, moveTargetMarker.
//
// 3. Per-DisplayObject pointer events on NPCs + interactables replace
//    the O(N) click scan from the Konva implementation. Each clickable
//    node has eventMode='static' and dispatches via callbacks supplied
//    on the snapshot. Background clicks (move-to) bubble up to a
//    host-level handler installed by Game.tsx.
//
// 4. LPC sprites consume the existing composeSheet cache. Each NPC +
//    player has its own Sprite + Texture instance whose `frame` is
//    updated per animation tick — multiple characters with the same
//    appearance share the same canvas/TextureSource via composeSheet's
//    LRU but allocate independent Texture wrappers (frame is per-Texture).
//
// 5. Viewport culling: the snapshot caller pre-filters entities to those
//    intersecting the camera frustum (with RENDER_PAD_PX = 2*TILE
//    padding). Reconciliation cost is O(visible) per frame.
//
// Perf budget: render <4ms/frame at N=200 NPCs + 80 buildings + 2000
// walls + 500 roads. Click resolve <0.5ms (Pixi scene-graph hit-test).
//
// Profiling: flip groundStats.enabled = true to collect counters.

import {
  Application, Container, Graphics, Sprite, Text, Texture, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import type { Entity } from 'koota'
import type { InteractableKind, RoadKind, BedTier, ActionKind } from '../../ecs/traits'
import type { AppearanceData } from '../../character/appearanceGen'
import { composeSheet } from '../sprite/compose'
import { appearanceToLpc } from '../sprite/appearanceToLpc'
import type { LpcAnimation, LpcDirection, LpcManifest } from '../sprite/types'
import { actionLabel } from '../../data/actions'
import type {
  RoadSnap, BuildingSnap, WallSnap, DoorSnap, BedSnap, BarSeatSnap,
  InteractableSnap, NpcSnap, PlayerSnap, GroundSnapshot,
} from '../groundSnapshot'

// Sprite layout, mirrored from the deleted CharacterSprite.tsx so the
// visual footprint stays identical across the migration.
const SPRITE_SCALE = 0.75
const FRAME = 64
const SPRITE_DRAW = FRAME * SPRITE_SCALE
const FOOT_OFFSET_Y = 56 * SPRITE_SCALE
const HALF_W = SPRITE_DRAW / 2

const DIRECTION_ROW: Record<LpcDirection, number> = { up: 0, left: 1, down: 2, right: 3 }
const WALK_CYCLE = [1, 2, 3, 4, 5, 6, 7, 8] as const
const IDLE_CYCLE = [0, 0, 1] as const

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'

const ROAD_FILL: Record<RoadKind, number> = {
  avenue: 0x2a2a32,
  street: 0x33333d,
  alley:  0x3d3d47,
}

const INTERACT_COLORS: Record<InteractableKind, { fill: number; stroke: number }> = {
  eat:             { fill: 0x7c2d12, stroke: 0xea580c },
  sleep:           { fill: 0x1e3a8a, stroke: 0x3b82f6 },
  wash:            { fill: 0x155e75, stroke: 0x06b6d4 },
  work:            { fill: 0x3b1e7a, stroke: 0xa855f7 },
  bar:             { fill: 0x7f1d1d, stroke: 0xef4444 },
  gym:             { fill: 0x3a2c0a, stroke: 0xc9a047 },
  tap:             { fill: 0x1e293b, stroke: 0x64748b },
  scavenge:        { fill: 0x3a2e1a, stroke: 0xa3a3a3 },
  rough:           { fill: 0x262626, stroke: 0x737373 },
  transit:         { fill: 0x134e4a, stroke: 0x2dd4bf },
  ticketCounter:   { fill: 0x1e3a8a, stroke: 0x60a5fa },
  boardShip:       { fill: 0x0c4a6e, stroke: 0x38bdf8 },
  disembarkShip:   { fill: 0x1e293b, stroke: 0x94a3b8 },
  helm:            { fill: 0x3a1f4a, stroke: 0xa78bfa },
  // Owner-control hue: deep amber + bright gold, distinct from the
  // service-side palette (those are now scenery-only and carry no
  // Interactable). 'manage' reads as 'this is your facility'.
  manage:          { fill: 0x713f12, stroke: 0xfbbf24 },
  // Captain's desk — pre-launch readiness summary. Same warm palette
  // family as helm/manage so ship-command interactables read as one
  // group on the floor.
  captainsDesk:    { fill: 0x422006, stroke: 0xfcd34d },
}

const BED_VISUAL: Record<BedTier, { fill: number; stroke: number; w: number; h: number; label: string }> = {
  luxury:    { fill: 0x0e2a3a, stroke: 0x22d3ee, w: 28, h: 18, label: '高级床' },
  apartment: { fill: 0x1e3a8a, stroke: 0x60a5fa, w: 26, h: 16, label: '床' },
  dorm:      { fill: 0x3a2e1a, stroke: 0xa78b4a, w: 22, h: 14, label: '宿舍床' },
  lounge:    { fill: 0x3a2c0a, stroke: 0xc9a047, w: 26, h: 14, label: '员工沙发' },
  flop:      { fill: 0x262626, stroke: 0x737373, w: 20, h: 14, label: '投币床' },
}

const ROUGH_HAZARD_TEXT: Record<'tap' | 'scavenge' | 'rough', string> = {
  tap: '⚠ 不卫生',
  scavenge: '⚠ 馊腐',
  rough: '⚠ 风餐',
}

// ── Persistent node shapes ─────────────────────────────────────────

interface RoadNode { rect: Graphics }
interface BuildingNode { root: Container; rect: Graphics; label: Text }
interface WallNode { rect: Graphics }
interface DoorNode { rect: Graphics }
interface BedNode {
  root: Container
  body: Graphics
  pillow: Graphics
  occupiedX: Graphics  // diagonal slash when someone else's bed
  multLabel: Text | null
  feeBox: Graphics | null
  feeText: Text | null
  occupiedTag: Graphics | null
  occupiedTagText: Text | null
  label: Text
}
interface BarSeatNode {
  root: Container
  body: Graphics
  pillow: Graphics
  feeBox: Graphics | null
  feeText: Text | null
}
interface InteractableNode {
  root: Container
  rect: Graphics
  feeBox: Graphics | null
  feeText: Text | null
  freeBox: Graphics | null
  freeText: Text | null
  hazardBox: Graphics | null
  hazardText: Text | null
  label: Text
}
interface SpriteState {
  sprite: Sprite
  texture: Texture | null
  manifestKey: string
  animation: LpcAnimation
  facing: LpcDirection
  // Pending sheet promise to detect stale loads on appearance/animation change.
  pending: number
}
interface NpcNode {
  root: Container
  speechRect: Graphics
  speechText: Text
  actionLabel: Text
  progressBg: Graphics
  progressFill: Graphics
  deadCircle: Graphics
  deadCross: Text
  nameLabel: Text
  spriteHost: Container
  sprite: SpriteState
}
interface PlayerNode {
  root: Container
  ring: Graphics
  spriteHost: Container
  sprite: SpriteState
  actionLabel: Text
}

// ── Stats ──────────────────────────────────────────────────────────

export const groundStats = {
  enabled: false,
  frames: 0,
  totalUpdateMs: 0,
  roadNodes: 0,
  buildingNodes: 0,
  wallNodes: 0,
  doorNodes: 0,
  bedNodes: 0,
  barSeatNodes: 0,
  interactableNodes: 0,
  npcNodes: 0,
  spriteLoadsPending: 0,
}

export function resetGroundStats(): void {
  groundStats.frames = 0
  groundStats.totalUpdateMs = 0
  groundStats.roadNodes = 0
  groundStats.buildingNodes = 0
  groundStats.wallNodes = 0
  groundStats.doorNodes = 0
  groundStats.bedNodes = 0
  groundStats.barSeatNodes = 0
  groundStats.interactableNodes = 0
  groundStats.npcNodes = 0
  groundStats.spriteLoadsPending = 0
}

// ── Renderer ───────────────────────────────────────────────────────

export class PixiGroundRenderer {
  private viewport: Container
  private background: Graphics
  private gridLayer: Graphics
  private roadLayer: Container
  private buildingLayer: Container
  private wallLayer: Container
  private doorLayer: Container
  private bedLayer: Container
  private barSeatLayer: Container
  private interactableLayer: Container
  private npcLayer: Container
  private playerLayer: Container
  private moveTargetMarker: Graphics

  private roadNodes = new Map<Entity, RoadNode>()
  private buildingNodes = new Map<Entity, BuildingNode>()
  private wallNodes = new Map<Entity, WallNode>()
  private doorNodes = new Map<Entity, DoorNode>()
  private bedNodes = new Map<Entity, BedNode>()
  private barSeatNodes = new Map<Entity, BarSeatNode>()
  private interactableNodes = new Map<Entity, InteractableNode>()
  private npcNodes = new Map<Entity, NpcNode>()
  private playerNode: PlayerNode | null = null

  private spriteLoadCounter = 0

  // Stash dispatchers so per-node listeners can read the latest version
  // (Pixi listeners are attached once at node creation).
  private latestOnNpcClick: GroundSnapshot['onNpcClick'] = () => { /* noop */ }
  private latestOnInteractableClick: GroundSnapshot['onInteractableClick'] = () => { /* noop */ }

  constructor(_app: Application, _viewW: number, _viewH: number) {
    this.viewport = new Container()
    this.viewport.label = 'ground-viewport'
    _app.stage.addChild(this.viewport)

    this.background = new Graphics()
    this.gridLayer = new Graphics()
    this.roadLayer = new Container()
    this.buildingLayer = new Container()
    this.wallLayer = new Container()
    this.doorLayer = new Container()
    this.bedLayer = new Container()
    this.barSeatLayer = new Container()
    this.interactableLayer = new Container()
    this.npcLayer = new Container()
    this.playerLayer = new Container()
    this.moveTargetMarker = new Graphics()

    // Layers that don't host clickable nodes are kept non-interactive so
    // hit-testing only descends into npcs + interactables.
    this.background.eventMode = 'none'
    this.gridLayer.eventMode = 'none'
    this.roadLayer.eventMode = 'none'
    this.buildingLayer.eventMode = 'none'
    this.wallLayer.eventMode = 'none'
    this.doorLayer.eventMode = 'none'
    this.bedLayer.eventMode = 'none'
    this.barSeatLayer.eventMode = 'none'
    this.playerLayer.eventMode = 'none'
    this.moveTargetMarker.eventMode = 'none'
    // npcLayer and interactableLayer use the default 'passive' which lets
    // children's eventMode='static' nodes receive events.

    this.viewport.addChild(this.background)
    this.viewport.addChild(this.gridLayer)
    this.viewport.addChild(this.roadLayer)
    this.viewport.addChild(this.buildingLayer)
    this.viewport.addChild(this.wallLayer)
    this.viewport.addChild(this.doorLayer)
    this.viewport.addChild(this.bedLayer)
    this.viewport.addChild(this.barSeatLayer)
    this.viewport.addChild(this.interactableLayer)
    this.viewport.addChild(this.npcLayer)
    this.viewport.addChild(this.playerLayer)
    this.viewport.addChild(this.moveTargetMarker)
  }

  resize(_w: number, _h: number): void {
    // Pixi's Application handles renderer.resize via PixiCanvas; the viewport
    // Container itself doesn't carry size state.
  }

  destroy(): void {
    this.viewport.destroy({ children: true })
    this.roadNodes.clear()
    this.buildingNodes.clear()
    this.wallNodes.clear()
    this.doorNodes.clear()
    this.bedNodes.clear()
    this.barSeatNodes.clear()
    this.interactableNodes.clear()
    this.npcNodes.clear()
    this.playerNode = null
  }

  update(snap: GroundSnapshot): void {
    const PROF = groundStats.enabled
    const t0 = PROF ? performance.now() : 0

    this.latestOnNpcClick = snap.onNpcClick
    this.latestOnInteractableClick = snap.onInteractableClick

    this.viewport.x = -snap.camX
    this.viewport.y = -snap.camY

    this.syncBackground(snap.worldW, snap.worldH)
    this.syncGrid(snap)
    this.syncRoads(snap.roads)
    this.syncBuildings(snap.buildings)
    this.syncWalls(snap.walls)
    this.syncDoors(snap.doors)
    this.syncBeds(snap.beds)
    this.syncBarSeats(snap.barSeats)
    this.syncInteractables(snap.interactables)
    this.syncNpcs(snap.npcs, snap.animTick)
    this.syncPlayer(snap.player, snap.animTick)
    this.syncMoveTarget(snap.moveTarget, snap.player)

    if (PROF) {
      groundStats.frames++
      groundStats.totalUpdateMs += performance.now() - t0
      groundStats.roadNodes = this.roadNodes.size
      groundStats.buildingNodes = this.buildingNodes.size
      groundStats.wallNodes = this.wallNodes.size
      groundStats.doorNodes = this.doorNodes.size
      groundStats.bedNodes = this.bedNodes.size
      groundStats.barSeatNodes = this.barSeatNodes.size
      groundStats.interactableNodes = this.interactableNodes.size
      groundStats.npcNodes = this.npcNodes.size
    }
  }

  private syncBackground(worldW: number, worldH: number): void {
    // Static; redraw only when world dims change. Cheap enough to clear+redraw
    // each frame, keeping the renderer stateless wrt envelope changes.
    this.background.clear()
      .rect(0, 0, worldW, worldH)
      .fill(0x0a0a0d)
  }

  private syncGrid(snap: GroundSnapshot): void {
    // Viewport-clipped grid lines.
    const TILE = snap.tilePx
    const PAD = 2 * TILE
    const vx0 = snap.camX - PAD
    const vy0 = snap.camY - PAD
    const vx1 = snap.camX + snap.canvasW + PAD
    const vy1 = snap.camY + snap.canvasH + PAD

    const cols = snap.worldW / TILE
    const rows = snap.worldH / TILE
    const gridColStart = Math.max(0, Math.floor(vx0 / TILE))
    const gridColEnd = Math.min(cols, Math.ceil(vx1 / TILE))
    const gridRowStart = Math.max(0, Math.floor(vy0 / TILE))
    const gridRowEnd = Math.min(rows, Math.ceil(vy1 / TILE))

    this.gridLayer.clear()
    // Horizontal lines.
    for (let r = gridRowStart; r <= gridRowEnd; r++) {
      this.gridLayer
        .moveTo(0, r * TILE)
        .lineTo(snap.worldW, r * TILE)
    }
    // Vertical lines.
    for (let c = gridColStart; c <= gridColEnd; c++) {
      this.gridLayer
        .moveTo(c * TILE, 0)
        .lineTo(c * TILE, snap.worldH)
    }
    this.gridLayer.stroke({ color: 0x1c1c22, width: 1 })
  }

  private syncRoads(roads: RoadSnap[]): void {
    const seen = new Set<Entity>()
    for (const r of roads) {
      seen.add(r.ent)
      let node = this.roadNodes.get(r.ent)
      if (!node) {
        const rect = new Graphics()
        rect.eventMode = 'none'
        this.roadLayer.addChild(rect)
        node = { rect }
        this.roadNodes.set(r.ent, node)
      }
      node.rect.clear()
        .rect(r.x, r.y, r.w, r.h)
        .fill(ROAD_FILL[r.kind])
    }
    for (const [ent, node] of this.roadNodes) {
      if (!seen.has(ent)) {
        node.rect.destroy()
        this.roadNodes.delete(ent)
      }
    }
  }

  private syncBuildings(buildings: BuildingSnap[]): void {
    const seen = new Set<Entity>()
    for (const b of buildings) {
      seen.add(b.ent)
      let node = this.buildingNodes.get(b.ent)
      if (!node) {
        const root = new Container()
        root.eventMode = 'none'
        const rect = new Graphics()
        const label = new Text({
          text: b.label,
          style: { fill: 0x5a5a64, fontSize: 11, fontFamily: FONT_FAMILY },
        })
        root.addChild(rect)
        root.addChild(label)
        this.buildingLayer.addChild(root)
        node = { root, rect, label }
        this.buildingNodes.set(b.ent, node)
      }
      // Dashed-outline rect with low-alpha fill, mirroring Konva BuildingMark.
      node.rect.clear()
        .rect(b.x, b.y, b.w, b.h)
        .fill({ color: 0x32323c, alpha: 0.18 })
      drawDashedRect(node.rect, b.x, b.y, b.w, b.h, 6, 4, 0x2f2f3a, 1)
      if (node.label.text !== b.label) node.label.text = b.label
      node.label.x = b.x + 8
      node.label.y = b.y + 6
    }
    for (const [ent, node] of this.buildingNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.buildingNodes.delete(ent)
      }
    }
  }

  private syncWalls(walls: WallSnap[]): void {
    const seen = new Set<Entity>()
    for (const w of walls) {
      seen.add(w.ent)
      let node = this.wallNodes.get(w.ent)
      if (!node) {
        const rect = new Graphics()
        rect.eventMode = 'none'
        this.wallLayer.addChild(rect)
        node = { rect }
        this.wallNodes.set(w.ent, node)
      }
      node.rect.clear()
        .rect(w.x, w.y, w.w, w.h)
        .fill(0x3f3f46)
        .stroke({ color: 0x52525b, width: 1 })
    }
    for (const [ent, node] of this.wallNodes) {
      if (!seen.has(ent)) {
        node.rect.destroy()
        this.wallNodes.delete(ent)
      }
    }
  }

  private syncDoors(doors: DoorSnap[]): void {
    const seen = new Set<Entity>()
    for (const d of doors) {
      seen.add(d.ent)
      let node = this.doorNodes.get(d.ent)
      if (!node) {
        const rect = new Graphics()
        rect.eventMode = 'none'
        this.doorLayer.addChild(rect)
        node = { rect }
        this.doorNodes.set(d.ent, node)
      }
      let fill = 0x1f1f24
      let stroke = 0x71717a
      if (d.factionGated) { fill = 0x3a2c0a; stroke = 0xc9a047 }
      else if (d.bedKeyed) { fill = 0x3a2206; stroke = 0xfbbf24 }
      node.rect.clear()
        .rect(d.x, d.y, d.w, d.h)
        .fill(fill)
      drawDashedRect(node.rect, d.x, d.y, d.w, d.h, 3, 2, stroke, 1)
    }
    for (const [ent, node] of this.doorNodes) {
      if (!seen.has(ent)) {
        node.rect.destroy()
        this.doorNodes.delete(ent)
      }
    }
  }

  private syncBeds(beds: BedSnap[]): void {
    const seen = new Set<Entity>()
    for (const b of beds) {
      seen.add(b.ent)
      let node = this.bedNodes.get(b.ent)
      if (!node) {
        node = this.makeBedNode()
        this.bedLayer.addChild(node.root)
        this.bedNodes.set(b.ent, node)
      }
      this.updateBedNode(node, b)
    }
    for (const [ent, node] of this.bedNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.bedNodes.delete(ent)
      }
    }
  }

  private makeBedNode(): BedNode {
    const root = new Container()
    root.eventMode = 'none'
    const body = new Graphics()
    const pillow = new Graphics()
    const occupiedX = new Graphics()
    const label = new Text({
      text: '',
      style: { fill: 0xbdbdc6, fontSize: 11, fontFamily: FONT_FAMILY, align: 'center' },
    })
    label.anchor.set(0.5, 0)
    root.addChild(body)
    root.addChild(pillow)
    root.addChild(occupiedX)
    root.addChild(label)
    return {
      root, body, pillow, occupiedX,
      multLabel: null, feeBox: null, feeText: null,
      occupiedTag: null, occupiedTagText: null,
      label,
    }
  }

  private updateBedNode(node: BedNode, b: BedSnap): void {
    const v = BED_VISUAL[b.tier]
    if (!v) return
    const occupied = b.occupied
    const isPlayerBed = b.isPlayerBed
    const overlayStroke = isPlayerBed ? 0x4ade80 : occupied ? 0xef4444 : v.stroke
    const bodyAlpha = occupied ? 0.3 : 1

    node.body.clear()
      .roundRect(b.x - v.w / 2, b.y - v.h / 2, v.w, v.h, 3)
      .fill({ color: v.fill, alpha: bodyAlpha })
      .stroke({ color: overlayStroke, width: 2, alpha: bodyAlpha })

    node.pillow.clear()
      .roundRect(b.x - v.w / 2 + 2, b.y - v.h / 2 + 2, v.w - 4, 4, 2)
      .fill({ color: v.stroke, alpha: occupied ? 0.25 : 0.7 })

    node.occupiedX.clear()
    if (occupied && !isPlayerBed) {
      node.occupiedX
        .moveTo(b.x - v.w / 2, b.y + v.h / 2)
        .lineTo(b.x + v.w / 2, b.y - v.h / 2)
        .stroke({ color: 0xef4444, width: 2, alpha: 0.85 })
    }

    // Fee badge (only when free).
    const showFee = !occupied && b.fee > 0
    if (showFee) {
      if (!node.feeBox) {
        node.feeBox = new Graphics()
        node.feeText = new Text({
          text: '',
          style: { fill: 0x0d0d10, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold' },
        })
        node.feeText.anchor.set(0.5, 0)
        node.root.addChild(node.feeBox)
        node.root.addChild(node.feeText)
      }
      const fw = 28, fh = 12
      const fx = b.x - fw / 2
      const fy = b.y - v.h / 2 - 12
      node.feeBox.clear().roundRect(fx, fy, fw, fh, 3).fill(0xfacc15)
      const ft = `¥${b.fee}`
      if (node.feeText!.text !== ft) node.feeText!.text = ft
      node.feeText!.x = b.x
      node.feeText!.y = fy + 1
      node.feeBox.visible = true
      node.feeText!.visible = true
    } else {
      if (node.feeBox) node.feeBox.visible = false
      if (node.feeText) node.feeText.visible = false
    }

    // Multiplier label (above bed, only when bed has a non-1.0 sleep multiplier
    // and is not occupied). Stacks above the fee pill if both are shown.
    const showMult = b.multiplier !== 1.0 && !occupied
    if (showMult) {
      if (!node.multLabel) {
        node.multLabel = new Text({
          text: '',
          style: { fill: v.stroke, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold' },
        })
        node.multLabel.anchor.set(0.5, 0)
        node.root.addChild(node.multLabel)
      }
      const txt = `×${b.multiplier.toFixed(2)}`
      if (node.multLabel.text !== txt) node.multLabel.text = txt
      node.multLabel.style.fill = v.stroke
      node.multLabel.x = b.x
      node.multLabel.y = b.y - v.h / 2 - (showFee ? 23 : 11)
      node.multLabel.visible = true
    } else if (node.multLabel) {
      node.multLabel.visible = false
    }

    // Occupied/owned tag.
    if (occupied) {
      if (!node.occupiedTag) {
        node.occupiedTag = new Graphics()
        node.occupiedTagText = new Text({
          text: '',
          style: { fill: 0xfef2f2, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold' },
        })
        node.occupiedTagText.anchor.set(0.5, 0)
        node.root.addChild(node.occupiedTag)
        node.root.addChild(node.occupiedTagText)
      }
      const tw = isPlayerBed ? 28 : 24
      const tx = b.x - tw / 2
      const ty = b.y - v.h / 2 - 12
      node.occupiedTag.clear()
        .roundRect(tx, ty, tw, 12, 3)
        .fill(isPlayerBed ? 0x166534 : 0x7f1d1d)
      const txt = b.ownedByPlayer && isPlayerBed ? '已购' : isPlayerBed ? '你的' : '已租'
      if (node.occupiedTagText!.text !== txt) node.occupiedTagText!.text = txt
      node.occupiedTagText!.x = b.x
      node.occupiedTagText!.y = ty + 1
      node.occupiedTag.visible = true
      node.occupiedTagText!.visible = true
    } else {
      if (node.occupiedTag) node.occupiedTag.visible = false
      if (node.occupiedTagText) node.occupiedTagText.visible = false
    }

    if (node.label.text !== b.label) node.label.text = b.label
    node.label.style.fill = occupied ? 0x71717a : 0xbdbdc6
    node.label.x = b.x
    node.label.y = b.y + v.h / 2 + 4
  }

  private syncBarSeats(seats: BarSeatSnap[]): void {
    const seen = new Set<Entity>()
    for (const s of seats) {
      seen.add(s.ent)
      let node = this.barSeatNodes.get(s.ent)
      if (!node) {
        const root = new Container()
        root.eventMode = 'none'
        const body = new Graphics()
        const pillow = new Graphics()
        root.addChild(body)
        root.addChild(pillow)
        this.barSeatLayer.addChild(root)
        node = { root, body, pillow, feeBox: null, feeText: null }
        this.barSeatNodes.set(s.ent, node)
      }
      const w = 18, h = 14
      const occupied = s.occupied
      node.root.alpha = occupied ? 0.4 : 1
      node.body.clear()
        .roundRect(s.x - w / 2, s.y - h / 2, w, h, 2)
        .fill(0x7f1d1d)
        .stroke({ color: 0xef4444, width: 2 })
      node.pillow.clear()
        .roundRect(s.x - w / 2, s.y - h / 2, w, 3, 1)
        .fill(0xef4444)

      const showFee = !occupied && s.fee > 0
      if (showFee) {
        if (!node.feeBox) {
          node.feeBox = new Graphics()
          node.feeText = new Text({
            text: '',
            style: { fill: 0x0d0d10, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold', align: 'center' },
          })
          node.root.addChild(node.feeBox)
          node.root.addChild(node.feeText)
        }
        const fx = s.x + w / 2 - 4
        const fy = s.y - h / 2 - 11
        node.feeBox.clear().roundRect(fx, fy, 26, 11, 3).fill(0xfacc15)
        const ft = `¥${s.fee}`
        if (node.feeText!.text !== ft) node.feeText!.text = ft
        node.feeText!.style.wordWrapWidth = 26
        node.feeText!.x = fx
        node.feeText!.y = fy + 1
        node.feeBox.visible = true
        node.feeText!.visible = true
      } else {
        if (node.feeBox) node.feeBox.visible = false
        if (node.feeText) node.feeText.visible = false
      }
    }
    for (const [ent, node] of this.barSeatNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.barSeatNodes.delete(ent)
      }
    }
  }

  private syncInteractables(interactables: InteractableSnap[]): void {
    const seen = new Set<Entity>()
    for (const it of interactables) {
      seen.add(it.ent)
      let node = this.interactableNodes.get(it.ent)
      if (!node) {
        node = this.makeInteractableNode(it.ent)
        this.interactableLayer.addChild(node.root)
        this.interactableNodes.set(it.ent, node)
      }
      this.updateInteractableNode(node, it)
    }
    for (const [ent, node] of this.interactableNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.interactableNodes.delete(ent)
      }
    }
  }

  private makeInteractableNode(ent: Entity): InteractableNode {
    const root = new Container()
    // Static eventMode + cursor for click; hit area is the rect.
    root.eventMode = 'static'
    root.cursor = 'pointer'
    const rect = new Graphics()
    const label = new Text({
      text: '',
      style: { fill: 0xcccccc, fontSize: 12, fontFamily: FONT_FAMILY, align: 'center' },
    })
    label.anchor.set(0.5, 0)
    root.addChild(rect)
    root.addChild(label)
    root.on('pointerdown', (e: FederatedPointerEvent) => {
      // Stop both Pixi's federated chain AND the underlying native DOM
      // bubble. The host <div>'s React onPointerDown also receives the
      // native event after Pixi's listener returns; without nativeEvent
      // stopPropagation, that handler would clear the QueuedInteract we
      // just added and snap MoveTarget to the raw click point.
      e.stopPropagation()
      if ('stopPropagation' in e.nativeEvent) e.nativeEvent.stopPropagation()
      const node = this.interactableNodes.get(ent)
      if (!node) return
      // Pass pointer-relative click position so caller can confirm proximity
      // if needed. Currently the snapshot caller dispatches on entity alone.
      const local = e.global
      this.latestOnInteractableClick(ent, local.x, local.y)
    })
    return {
      root, rect, label,
      feeBox: null, feeText: null, freeBox: null, freeText: null,
      hazardBox: null, hazardText: null,
    }
  }

  private updateInteractableNode(node: InteractableNode, it: InteractableSnap): void {
    const c = INTERACT_COLORS[it.kind]
    const isRough = it.kind === 'tap' || it.kind === 'scavenge' || it.kind === 'rough'
    node.root.alpha = it.benchOccupied ? 0.45 : 1

    node.rect.clear()
      .roundRect(it.x - 14, it.y - 14, 28, 28, 4)
      .fill(c.fill)
    if (isRough) {
      drawDashedRect(node.rect, it.x - 14, it.y - 14, 28, 28, 4, 3, 0xfacc15, 2, 4)
    } else {
      node.rect.stroke({ color: c.stroke, width: 2 })
    }
    // Set hitArea to the rect for accurate hit-test (default is the bounding box,
    // which is fine for our shapes but explicit for clarity).
    node.root.hitArea = new Rectangle(it.x - 14, it.y - 14, 28, 28)

    // Fee badge.
    if (it.fee > 0) {
      if (!node.feeBox) {
        node.feeBox = new Graphics()
        node.feeText = new Text({
          text: '',
          style: { fill: 0x0d0d10, fontSize: 10, fontFamily: FONT_FAMILY, fontWeight: 'bold', align: 'center' },
        })
        node.root.addChild(node.feeBox)
        node.root.addChild(node.feeText)
      }
      const fx = it.x + 4
      const fy = it.y - 22
      node.feeBox.clear().roundRect(fx, fy, 32, 14, 3).fill(0xfacc15)
      const ft = `¥${it.fee}`
      if (node.feeText!.text !== ft) node.feeText!.text = ft
      node.feeText!.style.wordWrapWidth = 32
      node.feeText!.x = fx
      node.feeText!.y = fy + 1
      node.feeBox.visible = true
      node.feeText!.visible = true
    } else {
      if (node.feeBox) node.feeBox.visible = false
      if (node.feeText) node.feeText.visible = false
    }

    // Free + hazard tags (rough sources only).
    if (isRough) {
      if (!node.freeBox) {
        node.freeBox = new Graphics()
        node.freeText = new Text({
          text: '免费',
          style: { fill: 0x0d0d10, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold', align: 'center' },
        })
        node.hazardBox = new Graphics()
        node.hazardText = new Text({
          text: '',
          style: { fill: 0x0d0d10, fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold', align: 'center' },
        })
        node.root.addChild(node.freeBox)
        node.root.addChild(node.freeText)
        node.root.addChild(node.hazardBox)
        node.root.addChild(node.hazardText)
      }
      const ffx = it.x - 22
      const ffy = it.y - 24
      node.freeBox!.clear().roundRect(ffx, ffy, 22, 12, 3).fill(0x22c55e)
      node.freeText!.style.wordWrapWidth = 22
      node.freeText!.x = ffx
      node.freeText!.y = ffy + 1
      node.freeBox!.visible = true
      node.freeText!.visible = true

      const hx = it.x + 2
      const hy = it.y - 24
      node.hazardBox!.clear().roundRect(hx, hy, 36, 12, 3).fill(0xfacc15)
      const ht = ROUGH_HAZARD_TEXT[it.kind as 'tap' | 'scavenge' | 'rough']
      if (node.hazardText!.text !== ht) node.hazardText!.text = ht
      node.hazardText!.style.wordWrapWidth = 36
      node.hazardText!.x = hx
      node.hazardText!.y = hy + 1
      node.hazardBox!.visible = true
      node.hazardText!.visible = true
    } else {
      if (node.freeBox) node.freeBox.visible = false
      if (node.freeText) node.freeText.visible = false
      if (node.hazardBox) node.hazardBox.visible = false
      if (node.hazardText) node.hazardText.visible = false
    }

    const labelText = it.fee > 0 ? `${it.label} · ¥${it.fee}` : it.label
    const finalText = it.benchOccupied ? `${labelText} · 占用中` : labelText
    if (node.label.text !== finalText) node.label.text = finalText
    node.label.x = it.x
    node.label.y = it.y + 18
  }

  private syncNpcs(npcs: NpcSnap[], animTick: number): void {
    const seen = new Set<Entity>()
    for (const n of npcs) {
      seen.add(n.ent)
      let node = this.npcNodes.get(n.ent)
      if (!node) {
        node = this.makeNpcNode(n.ent)
        this.npcLayer.addChild(node.root)
        this.npcNodes.set(n.ent, node)
      }
      this.updateNpcNode(node, n, animTick)
    }
    for (const [ent, node] of this.npcNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.npcNodes.delete(ent)
      }
    }
  }

  private makeNpcNode(ent: Entity): NpcNode {
    const root = new Container()
    root.eventMode = 'static'
    root.cursor = 'pointer'

    const speechRect = new Graphics()
    const speechText = new Text({
      text: '',
      style: { fill: 0x0d0d10, fontSize: 11, fontFamily: FONT_FAMILY, align: 'center' },
    })
    const actionLabelText = new Text({
      text: '',
      style: { fill: 0xfacc15, fontSize: 9, fontFamily: FONT_FAMILY, align: 'center' },
    })
    actionLabelText.anchor.set(0.5, 0)
    const progressBg = new Graphics()
    const progressFill = new Graphics()
    const deadCircle = new Graphics()
    const deadCross = new Text({
      text: '✕',
      style: { fill: 0xef4444, fontSize: 14, fontWeight: 'bold' },
    })
    const nameLabel = new Text({
      text: '',
      style: { fill: 0xbdbdc6, fontSize: 10, fontFamily: FONT_FAMILY, align: 'center' },
    })
    nameLabel.anchor.set(0.5, 0)
    const spriteHost = new Container()
    const sprite = makeSpriteState()

    root.addChild(speechRect)
    root.addChild(speechText)
    root.addChild(actionLabelText)
    root.addChild(progressBg)
    root.addChild(progressFill)
    root.addChild(deadCircle)
    root.addChild(deadCross)
    root.addChild(spriteHost)
    spriteHost.addChild(sprite.sprite)
    root.addChild(nameLabel)

    root.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if ('stopPropagation' in e.nativeEvent) e.nativeEvent.stopPropagation()
      this.latestOnNpcClick(ent)
    })

    return {
      root, speechRect, speechText, actionLabel: actionLabelText,
      progressBg, progressFill, deadCircle, deadCross, nameLabel,
      spriteHost, sprite,
    }
  }

  private updateNpcNode(node: NpcNode, n: NpcSnap, animTick: number): void {
    const isDead = n.isDead
    const kind = n.actionKind
    const isVisible = !isDead && kind !== 'idle' && kind !== 'walking'
    const showSpeech = !isDead && kind === 'chatting' && n.speech !== null && n.speech.length > 0

    node.root.alpha = isDead ? 0.45 : 1
    // Hit area covers the sprite footprint (clicks anywhere on the visible
    // character should trigger the dialog).
    node.root.hitArea = new Rectangle(n.x - 14, n.y - 14, 28, 28)
    // Dead NPCs aren't clickable (matches Konva path: bestNpc filter skips dead).
    node.root.eventMode = isDead ? 'none' : 'static'

    // Speech bubble.
    if (showSpeech && n.speech) {
      const SPEECH_FONT = 11
      const SPEECH_MAX_W = 180
      const SPEECH_PAD_X = 6
      const SPEECH_PAD_Y = 3
      const speechWidth = Math.min(SPEECH_MAX_W, n.speech.length * (SPEECH_FONT - 1) + SPEECH_PAD_X * 2)
      const speechHeight = SPEECH_FONT + SPEECH_PAD_Y * 2
      node.speechRect.clear()
        .roundRect(n.x - speechWidth / 2, n.y - 44, speechWidth, speechHeight, 4)
        .fill(0xfefce8)
        .stroke({ color: 0xfacc15, width: 1 })
      if (node.speechText.text !== n.speech) node.speechText.text = n.speech
      node.speechText.style.wordWrapWidth = speechWidth - SPEECH_PAD_X * 2
      node.speechText.x = n.x - speechWidth / 2 + SPEECH_PAD_X
      node.speechText.y = n.y - 44 + SPEECH_PAD_Y
      node.speechRect.visible = true
      node.speechText.visible = true
    } else {
      node.speechRect.visible = false
      node.speechText.visible = false
    }

    // Action label + progress bar.
    if (isVisible) {
      let label = ''
      if (kind === 'working' && n.workTitle) label = n.workTitle
      else label = actionLabel(kind)
      if (node.actionLabel.text !== label) node.actionLabel.text = label
      node.actionLabel.style.wordWrapWidth = 80
      node.actionLabel.x = n.x
      node.actionLabel.y = n.y - 28
      node.actionLabel.visible = true

      const barW = 28
      const barH = 3
      const progress = n.vitalsProgress
      if (progress >= 0) {
        node.progressBg.clear()
          .rect(n.x - barW / 2, n.y - 16, barW, barH)
          .fill(0x0a0a0d)
          .stroke({ color: 0x3a3a44, width: 1 })
        node.progressFill.clear()
          .rect(n.x - barW / 2, n.y - 16, barW * progress, barH)
          .fill(0xfacc15)
        node.progressBg.visible = true
        node.progressFill.visible = true
      } else {
        node.progressBg.visible = false
        node.progressFill.visible = false
      }
    } else {
      node.actionLabel.visible = false
      node.progressBg.visible = false
      node.progressFill.visible = false
    }

    // Body: sprite (alive) or dead-X (dead).
    if (isDead) {
      node.deadCircle.clear()
        .circle(n.x, n.y, 9)
        .fill(0x3f3f46)
        .stroke({ color: 0xef4444, width: 2, alpha: 0.95 })
      node.deadCircle.visible = true
      node.deadCross.x = n.x - 6
      node.deadCross.y = n.y - 7
      node.deadCross.visible = true
      node.spriteHost.visible = false
    } else {
      node.deadCircle.visible = false
      node.deadCross.visible = false
      node.spriteHost.visible = true
      this.updateSpriteState(node.sprite, n.appearance, kind, n.facingHint, n.x, n.y, animTick)
    }

    // Name label.
    const nameText = isDead ? `${n.name} · 已故` : n.name
    if (node.nameLabel.text !== nameText) node.nameLabel.text = nameText
    node.nameLabel.style.fill = isDead ? 0xef4444 : 0xbdbdc6
    node.nameLabel.style.wordWrapWidth = 80
    node.nameLabel.x = n.x
    node.nameLabel.y = n.y + 14
  }

  private syncPlayer(player: PlayerSnap | null, animTick: number): void {
    if (!player) {
      if (this.playerNode) {
        this.playerNode.root.destroy({ children: true })
        this.playerNode = null
      }
      return
    }
    if (!this.playerNode) {
      const root = new Container()
      root.eventMode = 'none'
      const ring = new Graphics()
      const spriteHost = new Container()
      const sprite = makeSpriteState()
      const labelText = new Text({
        text: '',
        style: { fill: 0xffaa00, fontSize: 11, fontFamily: FONT_FAMILY, align: 'center' },
      })
      root.addChild(ring)
      spriteHost.addChild(sprite.sprite)
      root.addChild(spriteHost)
      root.addChild(labelText)
      this.playerLayer.addChild(root)
      this.playerNode = { root, ring, spriteHost, sprite, actionLabel: labelText }
    }
    const node = this.playerNode
    node.ring.clear()
      .circle(player.x, player.y, 11)
      .stroke({ color: player.ringStroke, width: player.ringWidth, alpha: player.ringOpacity })

    this.updateSpriteState(node.sprite, player.appearance, player.actionKind, player.facingHint, player.x, player.y, animTick)

    // Action label.
    const kind = player.actionKind
    const showLabel = kind !== 'idle' && kind !== 'walking'
    if (showLabel) {
      const txt = actionLabel(kind)
      if (node.actionLabel.text !== txt) node.actionLabel.text = txt
      node.actionLabel.style.wordWrapWidth = 60
      node.actionLabel.x = player.x - 30
      node.actionLabel.y = player.y - 56
      node.actionLabel.visible = true
    } else {
      node.actionLabel.visible = false
    }
  }

  private syncMoveTarget(moveTarget: GroundSnapshot['moveTarget'], player: PlayerSnap | null): void {
    this.moveTargetMarker.clear()
    if (!moveTarget || !player) return
    const dx = moveTarget.x - player.x
    const dy = moveTarget.y - player.y
    if (Math.hypot(dx, dy) <= 2) return
    this.moveTargetMarker
      .circle(moveTarget.x, moveTarget.y, 5)
      .stroke({ color: 0xffaa00, width: 1, alpha: 0.7 })
  }

  private updateSpriteState(
    state: SpriteState,
    appearance: AppearanceData,
    actionKind: ActionKind,
    facingHint: LpcDirection | null,
    x: number,
    y: number,
    animTick: number,
  ): void {
    const isWalking = actionKind === 'walking'
    const animation: LpcAnimation = isWalking ? 'walk' : 'idle'
    const manifest = appearanceToLpc(appearance)
    const newKey = manifestKeyFor(manifest, animation)

    if (newKey !== state.manifestKey) {
      state.manifestKey = newKey
      state.animation = animation
      const myLoadId = ++this.spriteLoadCounter
      state.pending = myLoadId
      groundStats.spriteLoadsPending++
      composeSheet(manifest, animation)
        .then((canvas) => {
          if (state.pending !== myLoadId) {
            // Newer load overtook this one.
            groundStats.spriteLoadsPending = Math.max(0, groundStats.spriteLoadsPending - 1)
            return
          }
          // Build a Texture wrapping the shared canvas. Distinct per-character
          // Texture so each one can mutate its `frame` independently.
          const tex = new Texture({
            source: Texture.from(canvas).source,
            frame: new Rectangle(0, 0, FRAME, FRAME),
            dynamic: true,
          })
          // Drop the previous texture wrapper without destroying its source
          // (the canvas is shared via the LRU cache).
          if (state.texture) state.texture.destroy(false)
          state.texture = tex
          state.sprite.texture = tex
          state.sprite.visible = true
          groundStats.spriteLoadsPending = Math.max(0, groundStats.spriteLoadsPending - 1)
        })
        .catch((e: unknown) => {
          groundStats.spriteLoadsPending = Math.max(0, groundStats.spriteLoadsPending - 1)
          // eslint-disable-next-line no-console
          console.warn('[ground] sprite compose failed:', e)
        })
    }

    if (facingHint) state.facing = facingHint

    // Position the sprite at feet-anchored coords matching the Konva impl.
    state.sprite.x = x - HALF_W
    state.sprite.y = y - FOOT_OFFSET_Y
    state.sprite.width = SPRITE_DRAW
    state.sprite.height = SPRITE_DRAW

    // Update the texture frame from the animation cycle.
    if (state.texture) {
      const cycle = isWalking ? WALK_CYCLE : IDLE_CYCLE
      const col = cycle[animTick % cycle.length]
      const row = DIRECTION_ROW[state.facing]
      const f = state.texture.frame
      const wantX = col * FRAME
      const wantY = row * FRAME
      if (f.x !== wantX || f.y !== wantY) {
        f.x = wantX
        f.y = wantY
        f.width = FRAME
        f.height = FRAME
        state.texture.updateUvs()
      }
    } else {
      state.sprite.visible = false
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function makeSpriteState(): SpriteState {
  const sprite = new Sprite()
  sprite.eventMode = 'none'
  sprite.visible = false
  // Disable smoothing on the source once the texture lands.
  return {
    sprite,
    texture: null,
    manifestKey: '',
    animation: 'idle',
    facing: 'down',
    pending: 0,
  }
}

function manifestKeyFor(manifest: LpcManifest, animation: LpcAnimation): string {
  // Same shape as compose.ts so cache hits line up; only used for
  // change-detection here, not as a cache key.
  const layers = manifest.layers
    .map((l) => `${l.basePath}|${l.material ?? '_'}|${l.color ?? '_'}|${l.zPos}`)
    .join(';')
  return `${animation}::${manifest.bodyType}::${layers}`
}

/**
 * Approximate a dashed rectangle stroke in Pixi v8 Graphics. Draws four
 * sides as alternating moveTo/lineTo segments and strokes once at the end.
 * Konva's `dash` prop emits dashed strokes natively; Pixi v8 has no
 * built-in dash so we approximate with line segments.
 */
function drawDashedRect(
  g: Graphics, x: number, y: number, w: number, h: number,
  on: number, off: number, color: number, width: number, _alpha = 1,
): void {
  const seg = on + off
  // Top + bottom.
  for (let s = 0; s < w; s += seg) {
    const e = Math.min(s + on, w)
    g.moveTo(x + s, y).lineTo(x + e, y)
    g.moveTo(x + s, y + h).lineTo(x + e, y + h)
  }
  // Left + right.
  for (let s = 0; s < h; s += seg) {
    const e = Math.min(s + on, h)
    g.moveTo(x, y + s).lineTo(x, y + e)
    g.moveTo(x + w, y + s).lineTo(x + w, y + e)
  }
  g.stroke({ color, width })
}
