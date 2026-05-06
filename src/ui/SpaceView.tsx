// Phase 2 of the Konva → Pixi migration. This component is now a thin
// React shell: it owns the PixiCanvas mount, runs the 30Hz snapshot
// loop, and renders the DOM HUD overlays. All world-space drawing
// happens inside PixiSpaceRenderer.

import { useEffect, useRef, useState } from 'react'
import type { Application } from 'pixi.js'
import { PixiCanvas } from '../render/pixi'
import { PixiSpaceRenderer } from '../render/space/PixiSpaceRenderer'
import type { SpaceSnapshot, BodySnapshot, PoiSnapshot, ShipSnapshot } from '../render/spaceSnapshot'
import { getWorld } from '../ecs/world'
import { IsPlayer, Position, Body, PoiTag, Velocity, Course } from '../ecs/traits'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { POIS, type Poi } from '../data/pois'
import { spaceConfig } from '../config'
import { leaveHelm } from '../sim/helm'
import { getShipState } from '../sim/ship'
import { emitSim } from '../sim/events'

const SPACE_SCENE_ID = 'spaceCampaign'

const bodyDataById = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))
const poiDataById = new Map(POIS.map((p) => [p.id, p]))

function readBodies(): BodySnapshot[] {
  const w = getWorld(SPACE_SCENE_ID)
  const out: BodySnapshot[] = []
  for (const e of w.query(Body, Position)) {
    const b = e.get(Body)!
    const p = e.get(Position)!
    const data = bodyDataById.get(b.bodyId)
    if (!data) continue
    out.push({
      x: p.x, y: p.y,
      bodyId: b.bodyId, nameZh: data.nameZh,
      radius: data.bodyRadius, kind: data.kind,
    })
  }
  return out
}

function readPois(): PoiSnapshot[] {
  const w = getWorld(SPACE_SCENE_ID)
  const out: PoiSnapshot[] = []
  for (const e of w.query(PoiTag, Position)) {
    const t = e.get(PoiTag)!
    const p = e.get(Position)!
    const data = poiDataById.get(t.poiId)
    if (!data) continue
    out.push({ x: p.x, y: p.y, poi: data })
  }
  return out
}

function readShip(): ShipSnapshot | null {
  const w = getWorld(SPACE_SCENE_ID)
  const playerEnt = w.queryFirst(IsPlayer, Position, Velocity)
  if (!playerEnt) return null
  const pp = playerEnt.get(Position)!
  const vv = playerEnt.get(Velocity)!
  const cc = playerEnt.get(Course) ?? null
  return {
    x: pp.x, y: pp.y, vx: vv.vx, vy: vv.vy,
    course: cc ? { tx: cc.tx, ty: cc.ty, destPoiId: cc.destPoiId, active: cc.active } : null,
  }
}

function fitTransform(bodies: BodySnapshot[], pois: PoiSnapshot[], ship: ShipSnapshot | null, viewW: number, viewH: number) {
  const points: { x: number; y: number; r: number }[] = []
  for (const b of bodies) points.push({ x: b.x, y: b.y, r: b.radius })
  for (const p of pois) points.push({ x: p.x, y: p.y, r: 8 })
  if (ship) points.push({ x: ship.x, y: ship.y, r: 8 })
  if (points.length === 0) return { scale: 1, cx: 0, cy: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x - p.r)
    minY = Math.min(minY, p.y - p.r)
    maxX = Math.max(maxX, p.x + p.r)
    maxY = Math.max(maxY, p.y + p.r)
  }
  const pad = spaceConfig.fitSystemPaddingPx
  const w = (maxX - minX) + pad * 2
  const h = (maxY - minY) + pad * 2
  const scale = Math.min(viewW / w, viewH / h, 1)
  return { scale, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

function findNearbyPoi(pois: PoiSnapshot[], wx: number, wy: number): Poi | null {
  let best: Poi | null = null
  let bestD2 = spaceConfig.dockSnapRadius * spaceConfig.dockSnapRadius
  for (const ps of pois) {
    const dx = ps.x - wx
    const dy = ps.y - wy
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) {
      bestD2 = d2
      best = ps.poi
    }
  }
  return best
}

interface PanelState { poiId: string }

interface FuelHud { current: number; max: number }

// Fuel below this is treated as empty: spaceSim drops thrust as soon as
// the per-frame fuel demand exceeds fuelCurrent, which happens long
// before fuelCurrent reaches strict zero. 0.05 is a few frames of full
// thrust — effectively unusable for actual maneuver.
const FUEL_EMPTY_THRESHOLD = 0.05

export function SpaceView() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [fitMode, setFitMode] = useState(false)
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [fuelHud, setFuelHud] = useState<FuelHud | null>(null)

  // Latest panel/fitMode in refs so the render loop can read them without
  // restarting the loop on every state change.
  const fitModeRef = useRef(fitMode)
  fitModeRef.current = fitMode
  const panelRef = useRef<PanelState | null>(panel)
  panelRef.current = panel

  const rendererRef = useRef<PixiSpaceRenderer | null>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size

  // Snapshot kept on the ref so canvas-click handlers see the same data the
  // last frame rendered without re-snapping.
  const lastPoisRef = useRef<PoiSnapshot[]>([])

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const r = rendererRef.current
    if (r) r.resize(size.w, size.h)
  }, [size])

  // Per-RAF snapshot + render. Sim ticks at full RAF rate via loop.ts and
  // body positions are smoothed by the clock's sub-minute accumulator, so
  // sampling at 60Hz here is what makes orbital motion visibly smooth.
  // RAF tick complexity is O(B + P) at B≈30 bodies and P≈30 POIs — well
  // inside the <3ms/frame budget. Fuel HUD has its own 250ms gate to avoid
  // setState churn on a per-frame cadence.
  useEffect(() => {
    let raf = 0
    let last = 0
    let lastFuelPoll = 0
    const FUEL_POLL_MS = 250
    const loop = (now: number) => {
      const dtSec = last === 0 ? 1 / 60 : (now - last) / 1000
      last = now
      if (now - lastFuelPoll >= FUEL_POLL_MS) {
        lastFuelPoll = now
        const s = getShipState()
        if (s) setFuelHud({ current: s.fuelCurrent, max: s.fuelMax })
      }
      const r = rendererRef.current
      if (r) {
        const bodies = readBodies()
        const pois = readPois()
        const ship = readShip()
        lastPoisRef.current = pois
        const sz = sizeRef.current
        const fitOn = fitModeRef.current
        const fit = fitOn ? fitTransform(bodies, pois, ship, sz.w, sz.h) : null
        let coursePreview: SpaceSnapshot['coursePreview'] = null
        if (ship && ship.course?.active) {
          let tx = ship.course.tx
          let ty = ship.course.ty
          if (ship.course.destPoiId) {
            const found = pois.find((p) => p.poi.id === ship.course!.destPoiId)
            if (found) { tx = found.x; ty = found.y }
          }
          coursePreview = { fromX: ship.x, fromY: ship.y, toX: tx, toY: ty }
        }
        r.update({
          bodies, pois, ship,
          dockSnapRadius: spaceConfig.dockSnapRadius,
          fitMode: fitOn,
          fit,
          coursePreview,
          hoveredPoiId: panelRef.current?.poiId ?? null,
          dtSec,
        })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'KeyM') {
        e.preventDefault()
        setFitMode((m) => !m)
      } else if (e.key === 'Escape') {
        if (panelRef.current) setPanel(null)
        else if (fitModeRef.current) setFitMode(false)
        else leaveHelm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onReady = (app: Application) => {
    const sz = sizeRef.current
    rendererRef.current = new PixiSpaceRenderer(app, sz.w, sz.h)
  }

  // Click handling at the host-div level. Pixi's per-DisplayObject pointer
  // events would force POI hit-testing to round-trip through Pixi's hit
  // tree, but we already have a screen→world transform + linear scan that
  // honors the snap-radius semantics — keep it simple.
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = rendererRef.current
    if (!r) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const wp = r.screenToWorld(sx, sy)
    const isRight = e.button === 2
    if (isRight) {
      e.preventDefault()
      const w = getWorld(SPACE_SCENE_ID)
      const player = w.queryFirst(IsPlayer, Course)
      if (!player) return
      // Without this guard, the click silently sets a Course the
      // autopilot can't act on (spaceSim drops thrust whenever a frame's
      // fuel demand exceeds Ship.fuelCurrent, which fires well before the
      // value reaches strict zero), which the player perceives as
      // "navigation ignored."
      const ship = getShipState()
      if (ship && ship.fuelCurrent < FUEL_EMPTY_THRESHOLD) {
        emitSim('toast', { textZh: '燃料耗尽 · 需返回补给站' })
        return
      }
      const near = findNearbyPoi(lastPoisRef.current, wp.x, wp.y)
      if (near) {
        let targetX = wp.x
        let targetY = wp.y
        for (const pe of w.query(PoiTag, Position)) {
          if (pe.get(PoiTag)!.poiId === near.id) {
            const tp = pe.get(Position)!
            targetX = tp.x
            targetY = tp.y
            break
          }
        }
        player.set(Course, { tx: targetX, ty: targetY, destPoiId: near.id, active: true })
      } else {
        player.set(Course, { tx: wp.x, ty: wp.y, destPoiId: null, active: true })
      }
    } else {
      const near = findNearbyPoi(lastPoisRef.current, wp.x, wp.y)
      if (near) setPanel({ poiId: near.id })
      else setPanel(null)
    }
  }

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const panelPoi = panel ? poiDataById.get(panel.poiId) ?? null : null

  return (
    <div
      className="space-view"
      style={{ position: 'fixed', inset: 0, background: '#020617', zIndex: 5 }}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={onContextMenu}
    >
      <PixiCanvas width={size.w} height={size.h} background={0x020617} onReady={onReady} />
      {fuelHud && (() => {
        const empty = fuelHud.current < FUEL_EMPTY_THRESHOLD
        return (
          <div
            style={{
              position: 'absolute', bottom: 12, left: 12,
              background: 'rgba(15, 23, 42, 0.92)',
              border: `1px solid ${empty ? '#dc2626' : '#475569'}`,
              color: empty ? '#fca5a5' : '#e2e8f0',
              padding: '8px 14px',
              fontFamily: 'system-ui, sans-serif', fontSize: 13,
              borderRadius: 4, minWidth: 140,
            }}
          >
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>燃料</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {fuelHud.current.toFixed(1)} / {fuelHud.max}
            </div>
            {empty && (
              <div style={{ fontSize: 11, marginTop: 4 }}>耗尽 · 无法机动</div>
            )}
          </div>
        )
      })()}
      <button
        onClick={() => leaveHelm()}
        style={{
          position: 'absolute', bottom: 12, right: 12,
          background: 'rgba(15, 23, 42, 0.92)', border: '1px solid #475569',
          color: '#e2e8f0', padding: '8px 14px',
          fontFamily: 'system-ui, sans-serif', fontSize: 13,
          borderRadius: 4, cursor: 'pointer',
        }}
      >
        离开操舵台 (ESC)
      </button>
      {panelPoi && (
        <div
          style={{
            position: 'absolute', top: 12, right: 12, width: 280,
            background: 'rgba(15, 23, 42, 0.92)', border: '1px solid #334155',
            color: '#e2e8f0', padding: '12px 14px',
            fontFamily: 'system-ui, sans-serif', fontSize: 13, borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{panelPoi.nameZh}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>类型: {panelPoi.type}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>母星: {bodyDataById.get(panelPoi.bodyId)?.nameZh ?? panelPoi.bodyId}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>势力: {panelPoi.factionControlPre}</div>
          <div style={{ color: '#94a3b8', marginBottom: 6 }}>服务: {panelPoi.services.join(', ') || '无'}</div>
          {panelPoi.description && (
            <div style={{ color: '#cbd5e1', marginTop: 8, lineHeight: 1.5 }}>{panelPoi.description}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
            右键空间 = 设置航向 · M = 缩放至全景 · ESC = 关闭
          </div>
        </div>
      )}
    </div>
  )
}
