// Phase 5 of the Konva → Pixi migration. Game.tsx is now a thin React
// shell: it owns the PixiCanvas mount, runs the per-frame snapshot loop
// in a useEffect, and renders the DOM HUD overlay. All world-space
// drawing happens inside PixiGroundRenderer.
//
// React rules:
// - No useQuery / useTrait subscriptions for visual marks. The renderer
//   reads ECS state via per-frame snapshots from world.query() — koota's
//   React hooks are reserved for DOM HUD components.
// - The component remounts on scene swap (App is keyed by activeId), so
//   a fresh PixiGroundRenderer is created each time.
//
// Click flow:
// - NPCs and interactables register per-DisplayObject 'pointerdown' on
//   their Pixi nodes (eventMode='static'). Those handlers stop both the
//   Pixi federated chain AND the underlying nativeEvent so the host-div
//   pointerdown below only fires for empty-space clicks.
// - Background clicks reach a host-level pointerdown that walks the
//   player to the world-space click position.
// - This kills the O(N) linear scan in the legacy Konva implementation.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Application } from 'pixi.js'
import type { Entity } from 'koota'
import { useQueryFirst, useTrait } from 'koota/react'
import { PixiCanvas } from './pixi'
import { PixiGroundRenderer } from './ground/PixiGroundRenderer'
import type {
  GroundSnapshot,
  RoadSnap,
  BuildingSnap,
  WallSnap,
  DoorSnap,
  BedSnap,
  BarSeatSnap,
  InteractableSnap,
  NpcSnap,
  PlayerSnap,
} from './groundSnapshot'
import {
  Position, IsPlayer, Interactable, MoveTarget, QueuedInteract, Action,
  Vitals, Health, Building, Character, Bed, BarSeat, RoughSpot, Job, Workstation, Wall, Door, ChatLine,
  Active, Road, Appearance,
} from '../ecs/traits'
import { useCamera } from './cameraStore'
import { BED_MULTIPLIERS, bedActiveOccupant } from '../systems/bed'
import { getJobSpec } from '../data/jobs'
import { MapWarnings } from '../ui/MapWarnings'
import { useUI } from '../ui/uiStore'
import { useClock } from '../sim/clock'
import { worldConfig } from '../config'
import { getActiveSceneDimensions, world } from '../ecs/world'
import { startAnimTicker, useAnimTick } from './sprite/animTick'
import type { LpcDirection } from './sprite/types'
import type { BedTier } from '../ecs/traits'

const TILE = worldConfig.tilePx

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function Game() {
  // Game remounts on scene swap (App is keyed by activeId), so a static
  // read here is correct — no useScene subscription needed.
  const { tilesX: COLS, tilesY: ROWS } = getActiveSceneDimensions()
  const W = COLS * TILE
  const H = ROWS * TILE

  const wrapRef = useRef<HTMLDivElement>(null)
  const [canvas, setCanvas] = useState(() => ({
    w: Math.min(window.innerWidth, W),
    h: Math.min(window.innerHeight, H),
  }))

  // The renderer instance is created in onReady; the per-frame loop reads it
  // through this ref so we don't restart RAF on every render.
  const rendererRef = useRef<PixiGroundRenderer | null>(null)

  // Camera coordinates kept in a ref so the snapshot loop has the latest value
  // without re-running the loop effect.
  const camRef = useRef({ x: 0, y: 0 })
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas

  // Stable facing ref keyed by entity id — sprites preserve facing when stopped.
  // Map<Entity, LpcDirection>. We also store player facing under a sentinel key.
  const facingRef = useRef(new Map<Entity, LpcDirection>())

  useEffect(() => {
    startAnimTicker()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const update = () => {
      const r = wrap.getBoundingClientRect()
      setCanvas({
        w: Math.min(Math.floor(r.width), W),
        h: Math.min(Math.floor(r.height), H),
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [W, H])

  // DOM HUD overlay (MapWarnings) reads player vitals via koota — keep that
  // path. The visual-mark renderer doesn't need react-state subscriptions.
  // The HUD overlay also needs the player ring color, but that's computed
  // per-frame in the renderer below from a fresh ECS read.

  // Mirror viewport into the camera store for activeZoneSystem. Effect-based
  // to avoid a side-effect during render; the store coalesces no-op writes.
  const playerPosForCam = useTrait(useQueryFirst(IsPlayer, Position) ?? null, Position)
  const camX = playerPosForCam ? clamp(playerPosForCam.x - canvas.w / 2, 0, Math.max(0, W - canvas.w)) : 0
  const camY = playerPosForCam ? clamp(playerPosForCam.y - canvas.h / 2, 0, Math.max(0, H - canvas.h)) : 0
  useEffect(() => {
    useCamera.getState().setCamera({ canvasW: canvas.w, canvasH: canvas.h, camX, camY })
    camRef.current = { x: camX, y: camY }
  }, [canvas.w, canvas.h, camX, camY])

  // Snapshot-and-render loop. RAF-paced; cheap to drive every frame because
  // the renderer is incremental.
  useEffect(() => {
    let raf = 0
    const onNpcClick = (ent: Entity) => {
      // Mirror the legacy click priority: dialog opens for the clicked NPC.
      // Dead NPCs are filtered upstream (the renderer disables their
      // eventMode), so by the time we get here it's a living NPC.
      useUI.getState().setDialogNPC(ent)
    }
    const onInteractableClick = (ent: Entity, _sx: number, _sy: number) => {
      // Resolve player + interactable position from ECS at click time.
      const player = world.queryFirst(IsPlayer, Position)
      if (!player) return
      const playerAction = player.get(Action)
      const isWorking = playerAction?.kind === 'working'
      if (
        playerAction
        && playerAction.kind !== 'idle'
        && playerAction.kind !== 'walking'
        && !isWorking
      ) {
        return
      }
      const ipos = ent.get(Position)
      if (!ipos) return
      // If the player is currently working, clicking the workstation is a
      // no-op (don't restart). Off-station = leave job, dispatched by the
      // background-click path; here we ignore the workstation click silently.
      if (isWorking) {
        const it = ent.get(Interactable)
        if (it?.kind === 'work') return
      }
      player.set(MoveTarget, { x: ipos.x, y: ipos.y })
      if (!player.has(QueuedInteract)) player.add(QueuedInteract)
    }

    const loop = () => {
      const r = rendererRef.current
      if (r) {
        const snap = buildSnapshot(canvasRef.current, camRef.current, facingRef.current, onNpcClick, onInteractableClick)
        if (snap) r.update(snap)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Force re-snapshot when animation tick advances even between RAF cycles —
  // useAnimTick already drives at 12Hz, the RAF loop above naturally picks
  // it up via getState(). No subscription needed.
  // (We still subscribe here to keep DOM-HUD components in sync if any
  //  ever depend on the tick.)
  useAnimTick((s) => s.tick)

  const onReady = (app: Application) => {
    rendererRef.current = new PixiGroundRenderer(app, canvasRef.current.w, canvasRef.current.h)
  }

  useEffect(() => {
    const r = rendererRef.current
    if (r) r.resize(canvas.w, canvas.h)
  }, [canvas.w, canvas.h])

  // Background click → move-to. Pixi's per-DisplayObject events stopPropagation
  // when an NPC/interactable is hit, so this only fires on empty space.
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const player = world.queryFirst(IsPlayer, Position)
    if (!player) return
    const playerAction = player.get(Action)
    const isWorking = playerAction?.kind === 'working'
    if (
      playerAction
      && playerAction.kind !== 'idle'
      && playerAction.kind !== 'walking'
      && !isWorking
    ) {
      return
    }
    if (isWorking) {
      // Off-station background click leaves the job (matches legacy behavior).
      player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const lx = sx + camRef.current.x
    const ly = sy + camRef.current.y
    const x = clamp(lx, 0, W)
    const y = clamp(ly, 0, H)
    player.set(MoveTarget, { x, y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
  }

  return (
    <div className="game-wrap" ref={wrapRef}>
      <div
        className="game-stage"
        style={{ width: canvas.w, height: canvas.h, position: 'relative' }}
        onPointerDown={onCanvasPointerDown}
      >
        <div className="game-canvas" style={{ width: canvas.w, height: canvas.h }}>
          <PixiCanvas
            width={canvas.w}
            height={canvas.h}
            background={0x0a0a0d}
            hostStyle={{ width: '100%', height: '100%' }}
            onReady={onReady}
          />
        </div>
        <MapWarnings />
      </div>
    </div>
  )
}

// ── Snapshot builder ───────────────────────────────────────────────

const RENDER_PAD_PX = 2 * TILE

function buildSnapshot(
  canvas: { w: number; h: number },
  cam: { x: number; y: number },
  facingMap: Map<Entity, LpcDirection>,
  onNpcClick: GroundSnapshot['onNpcClick'],
  onInteractableClick: GroundSnapshot['onInteractableClick'],
): GroundSnapshot | null {
  const { tilesX, tilesY } = getActiveSceneDimensions()
  const worldW = tilesX * TILE
  const worldH = tilesY * TILE

  const camX = cam.x
  const camY = cam.y
  const vx0 = camX - RENDER_PAD_PX
  const vy0 = camY - RENDER_PAD_PX
  const vx1 = camX + canvas.w + RENDER_PAD_PX
  const vy1 = camY + canvas.h + RENDER_PAD_PX
  const rectInView = (x: number, y: number, w: number, h: number) =>
    x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1
  const ptInView = (x: number, y: number) =>
    x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1

  // Roads.
  const roads: RoadSnap[] = []
  for (const ent of world.query(Road)) {
    const r = ent.get(Road)
    if (!r) continue
    if (!rectInView(r.x, r.y, r.w, r.h)) continue
    roads.push({ ent, x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind })
  }
  // Buildings.
  const buildings: BuildingSnap[] = []
  for (const ent of world.query(Building)) {
    const b = ent.get(Building)
    if (!b) continue
    if (!rectInView(b.x, b.y, b.w, b.h)) continue
    buildings.push({ ent, x: b.x, y: b.y, w: b.w, h: b.h, label: b.label })
  }
  // Walls.
  const walls: WallSnap[] = []
  for (const ent of world.query(Wall)) {
    const w = ent.get(Wall)
    if (!w) continue
    if (!rectInView(w.x, w.y, w.w, w.h)) continue
    walls.push({ ent, x: w.x, y: w.y, w: w.w, h: w.h })
  }
  // Doors.
  const doors: DoorSnap[] = []
  for (const ent of world.query(Door)) {
    const d = ent.get(Door)
    if (!d) continue
    if (!rectInView(d.x, d.y, d.w, d.h)) continue
    doors.push({
      ent, x: d.x, y: d.y, w: d.w, h: d.h,
      factionGated: d.factionGate !== null,
      bedKeyed: d.bedEntity !== null,
    })
  }

  const player = world.queryFirst(IsPlayer, Position)
  const playerEnt = player ?? null

  const gameMs = useClock.getState().gameDate.getTime()

  // Beds.
  const beds: BedSnap[] = []
  for (const ent of world.query(Bed, Position)) {
    const pos = ent.get(Position)
    if (!pos) continue
    if (!ptInView(pos.x, pos.y)) continue
    const bed = ent.get(Bed)
    if (!bed) continue
    const it = ent.get(Interactable)
    const v = BED_VISUAL_FALLBACK[bed.tier as BedTier]
    if (!v) continue
    const active = bedActiveOccupant(bed, gameMs)
    const occupied = active !== null
    const isPlayerBed = active !== null && active === playerEnt
    const labelText = it?.label ?? v.label
    const mult = BED_MULTIPLIERS[bed.tier as BedTier] ?? 1.0
    beds.push({
      ent,
      x: pos.x, y: pos.y,
      tier: bed.tier as BedTier,
      occupied, isPlayerBed,
      ownedByPlayer: bed.owned && isPlayerBed,
      fee: it?.fee ?? 0,
      label: labelText,
      multiplier: mult,
    })
  }

  // Bar seats.
  const barSeats: BarSeatSnap[] = []
  for (const ent of world.query(BarSeat, Position)) {
    const pos = ent.get(Position)
    if (!pos) continue
    if (!ptInView(pos.x, pos.y)) continue
    const seat = ent.get(BarSeat)
    if (!seat) continue
    const it = ent.get(Interactable)
    barSeats.push({
      ent,
      x: pos.x, y: pos.y,
      occupied: seat.occupant !== null,
      fee: it?.fee ?? 0,
    })
  }

  // Interactables (excluding NPC/bed/barseat duplicates).
  const interactables: InteractableSnap[] = []
  for (const ent of world.query(Interactable, Position)) {
    const pos = ent.get(Position)
    if (!pos) continue
    if (!ptInView(pos.x, pos.y)) continue
    const it = ent.get(Interactable)
    if (!it) continue
    if (ent.get(Character)) continue
    if (ent.get(Bed)) continue
    if (ent.get(BarSeat)) continue
    const rough = ent.get(RoughSpot)
    interactables.push({
      ent,
      x: pos.x, y: pos.y,
      kind: it.kind,
      label: it.label,
      fee: it.fee,
      benchOccupied: !!rough && rough.occupant !== null,
    })
  }

  // NPCs.
  const npcs: NpcSnap[] = []
  const gameDate = useClock.getState().gameDate
  for (const ent of world.query(Active, Character, Position)) {
    if (ent === playerEnt) continue
    const pos = ent.get(Position)
    const info = ent.get(Character)
    if (!pos || !info) continue
    if (!ptInView(pos.x, pos.y)) continue
    const action = ent.get(Action)
    const vitals = ent.get(Vitals)
    const health = ent.get(Health)
    const job = ent.get(Job)
    const chatLine = ent.get(ChatLine)
    const appearance = ent.get(Appearance)
    if (!appearance) continue

    const isDead = !!health?.dead
    const kind = action?.kind ?? 'idle'
    const wsTrait = job?.workstation?.get(Workstation)
    const wsSpec = wsTrait ? getJobSpec(wsTrait.specId) : null
    const workTitle = wsSpec?.jobTitle ?? null

    let progress = -1
    if (vitals) {
      if (kind === 'eating') progress = 1 - vitals.hunger / 100
      else if (kind === 'drinking') progress = 1 - vitals.thirst / 100
      else if (kind === 'sleeping') progress = 1 - vitals.fatigue / 100
      else if (kind === 'washing') progress = 1 - vitals.hygiene / 100
    }
    if (kind === 'working' && wsSpec) {
      const minute = gameDate.getHours() * 60 + gameDate.getMinutes()
      const ws = wsSpec.shiftStart * 60
      const we = wsSpec.shiftEnd * 60
      const span = we - ws
      progress = span > 0 ? Math.max(0, Math.min(1, (minute - ws) / span)) : -1
    }
    progress = Math.max(-1, Math.min(1, progress))

    const facingHint = computeFacing(ent, pos, action?.kind === 'walking', facingMap)

    npcs.push({
      ent,
      x: pos.x, y: pos.y,
      appearance,
      name: info.name,
      staticTitle: info.title,
      workTitle,
      actionKind: kind,
      facingHint,
      vitalsProgress: progress,
      speech: chatLine?.text || null,
      isDead,
    })
  }

  // Player.
  let playerSnap: PlayerSnap | null = null
  if (playerEnt) {
    const pos = playerEnt.get(Position)
    const appearance = playerEnt.get(Appearance)
    if (pos && appearance) {
      const action = playerEnt.get(Action)
      const vitals = playerEnt.get(Vitals)
      const health = playerEnt.get(Health)
      const worstVital = vitals && health
        ? Math.max(vitals.hunger, vitals.thirst, vitals.fatigue, 100 - health.hp)
        : 0
      const ringStroke = worstVital >= 90 ? 0xef4444
        : worstVital >= 75 ? 0xf97316
        : worstVital >= 50 ? 0xfacc15
        : 0x22c55e
      const ringWidth = worstVital >= 75 ? 3 : 2
      const facingHint = computeFacing(playerEnt, pos, action?.kind === 'walking', facingMap)
      playerSnap = {
        ent: playerEnt,
        x: pos.x, y: pos.y,
        appearance,
        actionKind: action?.kind ?? 'idle',
        facingHint,
        ringStroke,
        ringWidth,
        ringOpacity: 0.85,
      }
    }
  }

  // Move-target marker.
  let moveTarget: GroundSnapshot['moveTarget'] = null
  if (playerEnt) {
    const mt = playerEnt.get(MoveTarget)
    const pos = playerEnt.get(Position)
    if (mt && pos && Math.hypot(mt.x - pos.x, mt.y - pos.y) > 2) {
      moveTarget = { x: mt.x, y: mt.y }
    }
  }

  return {
    camX, camY,
    canvasW: canvas.w, canvasH: canvas.h,
    worldW, worldH,
    tilePx: TILE,
    roads, buildings, walls, doors,
    beds, barSeats, interactables,
    npcs,
    player: playerSnap,
    moveTarget,
    animTick: useAnimTick.getState().tick,
    onNpcClick,
    onInteractableClick,
  }
}

function computeFacing(
  ent: Entity,
  pos: { x: number; y: number },
  isWalking: boolean,
  facingMap: Map<Entity, LpcDirection>,
): LpcDirection | null {
  if (!isWalking) return null
  const mt = ent.get(MoveTarget)
  if (!mt) return null
  const dx = mt.x - pos.x
  const dy = mt.y - pos.y
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null
  const dir: LpcDirection = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up')
  facingMap.set(ent, dir)
  return dir
}

// Local fallback for bed visual sizes (mirrors PixiGroundRenderer's BED_VISUAL).
// Used here for the snapshot builder to read sizing/labels without coupling to
// the renderer's internal table.
const BED_VISUAL_FALLBACK: Record<BedTier, { w: number; h: number; label: string }> = {
  luxury:    { w: 28, h: 18, label: '高级床' },
  apartment: { w: 26, h: 16, label: '床' },
  dorm:      { w: 22, h: 14, label: '宿舍床' },
  lounge:    { w: 26, h: 14, label: '员工沙发' },
  flop:      { w: 20, h: 14, label: '投币床' },
}
