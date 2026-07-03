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
import type { RoadKind, ActionKind } from '../../ecs/traits'
import type { AppearanceData } from '../../character/appearanceGen'
import { composeSheet } from '../sprite/compose'
import { appearanceToLpc } from '../sprite/appearanceToLpc'
import type { LpcAnimation, LpcDirection, LpcManifest } from '../sprite/types'
import { actionLabel } from '../../data/actions'
import { physiologyConfig } from '../../config'
import { getArt } from '../assets/registry'
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


const ROUGH_HAZARD_TEXT: Record<'tap' | 'scavenge' | 'rough', string> = {
  tap: '⚠ 不卫生',
  scavenge: '⚠ 馊腐',
  rough: '⚠ 风餐',
}

// ── Persistent node shapes ─────────────────────────────────────────

// `sig` is the serialized geometry-determining state last drawn into the
// node's Graphics. Static city geometry (roads/walls/doors/buildings) never
// changes between frames, so redrawing it every frame forced Pixi to
// re-tessellate + re-upload all of it continuously (buildLine/toStrokeStyle/
// packAttributes dominated the frame in the dense city). We now redraw only
// when `sig` changes, letting Pixi keep the cached geometry.
interface RoadNode { rect: Graphics; sig: string }
interface BuildingNode { root: Container; rect: Graphics; label: Text; sig: string }
interface WallNode { rect: Graphics; sig: string }
interface DoorNode { rect: Graphics; sig: string }
interface BedNode {
  root: Container
  body: Graphics
  pillow: Graphics
  // Art-asset sprite. When the tier maps to a catalog id with a
  // loaded texture, the procedural body/pillow are skipped and this
  // sprite is shown instead.
  artSprite: Sprite
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
  // Phase 4.2 — sneeze emote glyph. The bg circle + "咳" text are drawn
  // above the NPC's head when their pulse timer fires. Hidden when the
  // entity is not a symptomatic infectious carrier.
  emoteBg: Graphics
  emoteText: Text
}

interface EmoteState {
  nextPulseMs: number   // game-ms when the next pulse begins
  hideAtMs: number      // game-ms when the current pulse ends
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
  // Count of static-geometry (road/wall/door/building) Graphics re-tessellations.
  // Static city geometry is drawn once and cached; while the camera is
  // stationary this must not increment (guards the per-frame-redraw regression).
  staticRedraws: 0,
}

// Phase 4.2 — module-scope mirror of currently-emoting symptomatic
// infectious NPCs. The renderer rewrites `active` from its per-frame
// emoteStates map; debug handles and smoke tests read off this surface
// to confirm the glyph layer reacted to a flu carrier.
export const sneezeEmoteRegistry: { active: Set<Entity> } = {
  active: new Set(),
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
  groundStats.staticRedraws = 0
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
  // Render-side emote state, keyed by Entity. Lifecycle mirrors
  // NpcNode — entries are removed when their NPC vanishes from view.
  private emoteStates = new Map<Entity, EmoteState>()

  private spriteLoadCounter = 0

  // Static-layer redraw guards: background + grid only change when the world
  // envelope changes (never during normal play), so we draw them once and let
  // Pixi cache the geometry instead of re-tessellating every frame.
  private bgSig = ''
  private gridSig = ''

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
    this.playerLayer.eventMode = 'none'
    this.moveTargetMarker.eventMode = 'none'
    // npcLayer, bedLayer, and interactableLayer use the default 'passive'
    // which lets children's eventMode='static' nodes receive events. Bar
    // seats stay non-interactive; they're driven by the bartender NPC.
    this.barSeatLayer.eventMode = 'none'

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
    this.emoteStates.clear()
    sneezeEmoteRegistry.active = new Set()
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
    this.syncNpcs(snap.npcs, snap.animTick, snap.gameMs)
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
    const sig = `${worldW}x${worldH}`
    if (this.bgSig === sig) return
    this.bgSig = sig
    this.background.clear()
      .rect(0, 0, worldW, worldH)
      .fill(0x0a0a0d)
  }

  private syncGrid(snap: GroundSnapshot): void {
    // The grid spans the full static world envelope and is scrolled by the
    // viewport container transform, so it only needs redrawing when the world
    // dims change — not every frame as the camera pans. Drawn once, then cached
    // by Pixi (was a per-frame clear+re-tessellate of every visible line, a
    // dominant cost while walking the dense city).
    const TILE = snap.tilePx
    const sig = `${snap.worldW}x${snap.worldH}@${TILE}`
    if (this.gridSig === sig) return
    this.gridSig = sig

    const cols = snap.worldW / TILE
    const rows = snap.worldH / TILE
    this.gridLayer.clear()
    for (let r = 0; r <= rows; r++) {
      this.gridLayer.moveTo(0, r * TILE).lineTo(snap.worldW, r * TILE)
    }
    for (let c = 0; c <= cols; c++) {
      this.gridLayer.moveTo(c * TILE, 0).lineTo(c * TILE, snap.worldH)
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
        node = { rect, sig: '' }
        this.roadNodes.set(r.ent, node)
      }
      const sig = `${r.x},${r.y},${r.w},${r.h},${r.kind}`
      if (node.sig !== sig) {
        node.rect.clear()
          .rect(r.x, r.y, r.w, r.h)
          .fill(ROAD_FILL[r.kind])
        node.sig = sig
        groundStats.staticRedraws++
      }
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
        node = { root, rect, label, sig: '' }
        this.buildingNodes.set(b.ent, node)
      }
      const sig = `${b.x},${b.y},${b.w},${b.h},${b.visual.fill},${b.visual.stroke},${b.label}`
      if (node.sig !== sig) {
        // Dashed-outline rect with low-alpha fill, mirroring Konva BuildingMark.
        node.rect.clear()
          .rect(b.x, b.y, b.w, b.h)
          .fill({ color: b.visual.fill, alpha: 0.18 })
        drawDashedRect(node.rect, b.x, b.y, b.w, b.h, 6, 4, b.visual.stroke, 1)
        if (node.label.text !== b.label) node.label.text = b.label
        node.label.x = b.x + 8
        node.label.y = b.y + 6
        node.sig = sig
        groundStats.staticRedraws++
      }
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
        node = { rect, sig: '' }
        this.wallNodes.set(w.ent, node)
      }
      const sig = `${w.x},${w.y},${w.w},${w.h},${w.visual.fill},${w.visual.stroke}`
      if (node.sig !== sig) {
        node.rect.clear()
          .rect(w.x, w.y, w.w, w.h)
          .fill(w.visual.fill)
          .stroke({ color: w.visual.stroke, width: 1 })
        node.sig = sig
        groundStats.staticRedraws++
      }
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
        node = { rect, sig: '' }
        this.doorNodes.set(d.ent, node)
      }
      // variant + visual capture lock/faction/bed-keyed state, which changes
      // when a ship docks/undocks — so a door still redraws on those events.
      const sig = `${d.x},${d.y},${d.w},${d.h},${d.variant},${d.visual.fill},${d.visual.stroke}`
      if (node.sig !== sig) {
        node.rect.clear()
          .rect(d.x, d.y, d.w, d.h)
          .fill(d.visual.fill)
        drawDashedRect(node.rect, d.x, d.y, d.w, d.h, 3, 2, d.visual.stroke, 1)
        node.sig = sig
        groundStats.staticRedraws++
      }
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
        node = this.makeBedNode(b.ent)
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

  private makeBedNode(ent: Entity): BedNode {
    const root = new Container()
    // Click-to-sleep: route through the same dispatcher as the
    // interactable layer so the player walks-and-queues-interact and
    // the interaction system handles rent/occupant gating.
    root.eventMode = 'static'
    root.cursor = 'pointer'
    root.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if ('stopPropagation' in e.nativeEvent) e.nativeEvent.stopPropagation()
      const local = e.global
      this.latestOnInteractableClick(ent, local.x, local.y)
    })
    const body = new Graphics()
    const pillow = new Graphics()
    const artSprite = new Sprite()
    artSprite.anchor.set(0.5, 0.5)
    // Snap to integer screen pixels every frame so nearest-filter
    // pixel art doesn't shimmer when the camera moves sub-pixel.
    artSprite.roundPixels = true
    artSprite.visible = false
    const occupiedX = new Graphics()
    const label = new Text({
      text: '',
      style: { fill: 0xbdbdc6, fontSize: 11, fontFamily: FONT_FAMILY, align: 'center' },
    })
    label.anchor.set(0.5, 0)
    root.addChild(body)
    root.addChild(pillow)
    root.addChild(artSprite)
    root.addChild(occupiedX)
    root.addChild(label)
    return {
      root, body, pillow, artSprite, occupiedX,
      multLabel: null, feeBox: null, feeText: null,
      occupiedTag: null, occupiedTagText: null,
      label,
    }
  }

  private updateBedNode(node: BedNode, b: BedSnap): void {
    const v = b.visual
    const occupied = b.occupied
    const isPlayerBed = b.isPlayerBed
    const overlayStroke = isPlayerBed ? 0x4ade80 : occupied ? 0xef4444 : v.stroke
    const bodyAlpha = occupied ? 0.3 : 1
    const vw = v.w ?? 0
    const vh = v.h ?? 0

    // One source of truth: the entity's template declares both the
    // footprint and the optional sprite (via assetId). Per skill
    // policy ("pixellab-asset"), the PNG is authored at exactly
    // (vw × vh) so the renderer paints 1:1 — never scaling. If a
    // mismatched texture lands anyway, we still draw at native size
    // and warn once, because scaled nearest-filter pixel art shimmers.
    // Hit area tracks the bed's footprint each frame so click-to-sleep
    // dispatches even as the visual asset (or template footprint) changes.
    node.root.hitArea = new Rectangle(b.x - vw / 2, b.y - vh / 2, vw, vh)

    const texture = v.assetId ? getArt(v.assetId) : null
    if (v.assetId) {
      if (texture && node.artSprite.texture !== texture) {
        node.artSprite.texture = texture
        warnIfArtSizeMismatch(v.assetId, texture, vw, vh)
      }
      node.artSprite.x = b.x
      node.artSprite.y = b.y
      // Don't set width/height — leave the sprite at native texture
      // dims so there's no fractional scale to alias. The skill
      // enforces texture == (vw, vh); a divergence is a bug to fix
      // upstream, not paper over by scaling here.
      node.artSprite.alpha = bodyAlpha
      node.artSprite.visible = texture !== null
      node.body.clear()
      node.pillow.clear()
    } else {
      node.artSprite.visible = false
      node.body.clear()
        .roundRect(b.x - vw / 2, b.y - vh / 2, vw, vh, 3)
        .fill({ color: v.fill, alpha: bodyAlpha })
        .stroke({ color: overlayStroke, width: 2, alpha: bodyAlpha })

      node.pillow.clear()
        .roundRect(b.x - vw / 2 + 2, b.y - vh / 2 + 2, vw - 4, 4, 2)
        .fill({ color: v.stroke, alpha: occupied ? 0.25 : 0.7 })
    }

    node.occupiedX.clear()
    if (occupied && !isPlayerBed) {
      node.occupiedX
        .moveTo(b.x - vw / 2, b.y + vh / 2)
        .lineTo(b.x + vw / 2, b.y - vh / 2)
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
      const fy = b.y - vh / 2 - 12
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
      node.multLabel.y = b.y - vh / 2 - (showFee ? 23 : 11)
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
      const ty = b.y - vh / 2 - 12
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
    node.label.y = b.y + vh / 2 + 4
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
      const bsv = s.visual
      const w = bsv.w ?? 18
      const h = bsv.h ?? 14
      const occupied = s.occupied
      node.root.alpha = occupied ? 0.4 : 1
      node.body.clear()
        .roundRect(s.x - w / 2, s.y - h / 2, w, h, 2)
        .fill(bsv.fill)
        .stroke({ color: bsv.stroke, width: 2 })
      node.pillow.clear()
        .roundRect(s.x - w / 2, s.y - h / 2, w, 3, 1)
        .fill(bsv.stroke)

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
    const c = it.visual
    const isRough = it.kind === 'tap' || it.kind === 'scavenge' || it.kind === 'rough'
    node.root.alpha = it.benchOccupied ? 0.45 : 1

    const cw = c.w ?? 28
    const ch = c.h ?? 28
    const halfW = cw / 2
    const halfH = ch / 2
    node.rect.clear()
      .roundRect(it.x - halfW, it.y - halfH, cw, ch, 4)
      .fill(c.fill)
    if (isRough) {
      drawDashedRect(node.rect, it.x - halfW, it.y - halfH, cw, ch, 4, 3, 0xfacc15, 2, 4)
    } else {
      node.rect.stroke({ color: c.stroke, width: 2 })
    }
    // Set hitArea to the rect for accurate hit-test (default is the bounding box,
    // which is fine for our shapes but explicit for clarity).
    node.root.hitArea = new Rectangle(it.x - halfW, it.y - halfH, cw, ch)

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
    if (it.gate?.isSign) {
      // Hangar gate sign — three-line label centered over the rect:
      //   line 1: Gate id (always visible, even when vacant)
      //   line 2: bound ship name or '空泊位'
      //   line 3: owner label or '—'
      const line2 = it.gate.shipName || '空泊位'
      const line3 = it.gate.ownerLabel || '—'
      const signText = `${it.gate.gateNumber}\n${line2}\n${line3}`
      if (node.label.text !== signText) node.label.text = signText
      node.label.style.fontSize = 10
      node.label.style.align = 'center'
      node.label.anchor.set(0.5, 0.5)
      node.label.x = it.x
      node.label.y = it.y
    } else {
      if (node.label.style.fontSize !== 12) node.label.style.fontSize = 12
      node.label.anchor.set(0.5, 0)
      if (node.label.text !== finalText) node.label.text = finalText
      node.label.x = it.x
      node.label.y = it.y + 18
    }
  }

  private syncNpcs(npcs: NpcSnap[], animTick: number, gameMs: number): void {
    const seen = new Set<Entity>()
    for (const n of npcs) {
      seen.add(n.ent)
      let node = this.npcNodes.get(n.ent)
      if (!node) {
        node = this.makeNpcNode(n.ent)
        this.npcLayer.addChild(node.root)
        this.npcNodes.set(n.ent, node)
      }
      this.updateNpcNode(node, n, animTick, gameMs)
    }
    for (const [ent, node] of this.npcNodes) {
      if (!seen.has(ent)) {
        node.root.destroy({ children: true })
        this.npcNodes.delete(ent)
        this.emoteStates.delete(ent)
      }
    }
    // Rebuild the public emote registry from this frame's emote state.
    sneezeEmoteRegistry.active = new Set(this.emoteStates.keys())
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

    const emoteBg = new Graphics()
    emoteBg.visible = false
    emoteBg.eventMode = 'none'
    const emoteText = new Text({
      text: '咳',
      style: { fill: 0xfacc15, fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    })
    emoteText.anchor.set(0.5, 0.5)
    emoteText.visible = false
    emoteText.eventMode = 'none'

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
    root.addChild(emoteBg)
    root.addChild(emoteText)

    root.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if ('stopPropagation' in e.nativeEvent) e.nativeEvent.stopPropagation()
      this.latestOnNpcClick(ent)
    })

    return {
      root, speechRect, speechText, actionLabel: actionLabelText,
      progressBg, progressFill, deadCircle, deadCross, nameLabel,
      spriteHost, sprite, emoteBg, emoteText,
    }
  }

  private updateNpcNode(node: NpcNode, n: NpcSnap, animTick: number, gameMs: number): void {
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

    this.updateEmote(node, n, gameMs)
  }

  // Phase 4.2 — drive the cough/sneeze emote glyph for symptomatic
  // infectious NPCs. The pulse cadence is jittered per entity so a
  // crowd of carriers doesn't cough in lockstep. Glyph state is
  // render-only — never written back to ECS — so saves don't churn.
  private updateEmote(node: NpcNode, n: NpcSnap, gameMs: number): void {
    const ent = n.ent
    const eligible = !n.isDead && n.symptomaticInfectious
    if (!eligible) {
      if (this.emoteStates.has(ent)) this.emoteStates.delete(ent)
      node.emoteBg.visible = false
      node.emoteText.visible = false
      return
    }
    let state = this.emoteStates.get(ent)
    const minMs = physiologyConfig.sneezeEmoteMinMs
    const maxMs = physiologyConfig.sneezeEmoteMaxMs
    const displayMs = physiologyConfig.sneezeEmoteDisplayMs
    if (!state) {
      // Initial pulse anywhere in [0, max] so co-located carriers don't
      // cough in unison on first frame.
      state = { nextPulseMs: gameMs + Math.random() * maxMs, hideAtMs: 0 }
      this.emoteStates.set(ent, state)
    }
    if (gameMs >= state.nextPulseMs) {
      state.hideAtMs = gameMs + displayMs
      state.nextPulseMs = gameMs + minMs + Math.random() * (maxMs - minMs)
    }
    const visible = gameMs < state.hideAtMs
    if (visible) {
      const cx = n.x
      const cy = n.y - 40
      node.emoteBg.clear()
        .circle(cx, cy, 9)
        .fill({ color: 0x1f2937, alpha: 0.85 })
        .stroke({ color: 0xfacc15, width: 1, alpha: 0.95 })
      node.emoteText.x = cx
      node.emoteText.y = cy
    }
    node.emoteBg.visible = visible
    node.emoteText.visible = visible
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

// Per-asset once-only sentinel for size-mismatch warnings — the
// renderer paints at native texture dims regardless, but a mismatch
// means the upstream skill policy (PNG === template visual.{w,h})
// was violated and the asset should be regenerated.
const artSizeWarned = new Set<string>()
function warnIfArtSizeMismatch(
  assetId: string, tex: Texture, targetW: number, targetH: number,
): void {
  const tw = tex.width
  const th = tex.height
  if (tw === targetW && th === targetH) return
  if (artSizeWarned.has(assetId)) return
  artSizeWarned.add(assetId)
  // eslint-disable-next-line no-console
  console.warn(
    `[art] '${assetId}' texture is ${tw}×${th} but template footprint is ` +
    `${targetW}×${targetH} — regenerate at the template size to avoid ` +
    `scaling shimmer (see .claude/skills/pixellab-asset/SKILL.md).`,
  )
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
