// Phase 2 of the Konva → Pixi migration. This component is now a thin
// React shell: it owns the PixiCanvas mount, runs the 30Hz snapshot
// loop, and renders the DOM HUD overlays. All world-space drawing
// happens inside PixiSpaceRenderer.

import { useEffect, useRef, useState } from 'react'
import type { Application } from 'pixi.js'
import { PixiCanvas } from '../render/pixi'
import { PixiSpaceRenderer } from '../render/space/PixiSpaceRenderer'
import type { SpaceSnapshot, BodySnapshot, PoiSnapshot, ShipSnapshot, EnemyShipSnapshot } from '../render/spaceSnapshot'
import { getWorld } from '../ecs/world'
import { IsPlayer, Position, Body, PoiTag, Velocity, Course, EnemyAI, EntityKey } from '../ecs/traits'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { POIS, type Poi } from '../data/pois'
import { spaceConfig } from '../config'
import { leaveHelm } from '../sim/helm'
import { getShipState } from '../sim/ship'
import { navigateTo, dockAt } from '../sim/navigation'
import { emitSim } from '../sim/events'
import { playUi } from '../audio/player'

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

function readEnemies(): EnemyShipSnapshot[] {
  const w = getWorld(SPACE_SCENE_ID)
  const out: EnemyShipSnapshot[] = []
  for (const e of w.query(EnemyAI, Position, Velocity)) {
    const ai = e.get(EnemyAI)!
    const p = e.get(Position)!
    const v = e.get(Velocity)!
    const k = e.get(EntityKey)
    out.push({
      key: k?.key ?? `enemy-anon-${out.length}`,
      x: p.x, y: p.y, vx: v.vx, vy: v.vy,
      shipClassId: ai.shipClassId, mode: ai.mode,
    })
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

function fitTransform(bodies: BodySnapshot[], pois: PoiSnapshot[], enemies: EnemyShipSnapshot[], ship: ShipSnapshot | null, viewW: number, viewH: number) {
  const points: { x: number; y: number; r: number }[] = []
  for (const b of bodies) points.push({ x: b.x, y: b.y, r: b.radius })
  for (const p of pois) points.push({ x: p.x, y: p.y, r: 8 })
  for (const e of enemies) points.push({ x: e.x, y: e.y, r: 8 })
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

// Starsector-style: a small floating menu anchored at the cursor when the
// player left-clicks a POI. screenX/screenY are the click coords, used to
// position the absolute-div; poiId names the target. Closing the menu just
// nulls this state — clicking a menu item commits the action then closes.
interface ContextMenuState {
  poiId: string
  screenX: number
  screenY: number
}

interface FuelHud { current: number; max: number }

// Fuel below this is treated as empty: spaceSim drops thrust as soon as
// the per-frame fuel demand exceeds fuelCurrent, which happens long
// before fuelCurrent reaches strict zero. 0.05 is a few frames of full
// thrust — effectively unusable for actual maneuver.
const FUEL_EMPTY_THRESHOLD = 0.05

export function SpaceView() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [fitMode, setFitMode] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [fuelHud, setFuelHud] = useState<FuelHud | null>(null)

  // Latest menu/fitMode in refs so the render loop and key handlers can
  // read them without restarting the loop on every state change.
  const fitModeRef = useRef(fitMode)
  fitModeRef.current = fitMode
  const menuRef = useRef<ContextMenuState | null>(menu)
  menuRef.current = menu

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
        const enemies = readEnemies()
        const ship = readShip()
        lastPoisRef.current = pois
        const sz = sizeRef.current
        const fitOn = fitModeRef.current
        const fit = fitOn ? fitTransform(bodies, pois, enemies, ship, sz.w, sz.h) : null
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
          bodies, pois, enemies, ship,
          dockSnapRadius: spaceConfig.dockSnapRadius,
          fitMode: fitOn,
          fit,
          coursePreview,
          hoveredPoiId: menuRef.current?.poiId ?? null,
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
        if (menuRef.current) setMenu(null)
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
  //
  // Left-click on a POI opens the Starsector-style context menu near the
  // cursor (Navigate / Dock). Left-click on empty space closes any open
  // menu. Right-click anywhere is the quick-navigate shortcut: targets a
  // POI if hovered, otherwise the raw click point. Both navigation paths
  // funnel through navigateTo()/dockAt() so takeoff is paid exactly once.
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = rendererRef.current
    if (!r) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const wp = r.screenToWorld(sx, sy)
    const isRight = e.button === 2

    // Empty-fuel guard: spaceSim drops thrust whenever a frame's fuel
    // demand exceeds Ship.fuelCurrent (well before strict zero), which
    // would silently ignore any course committed below.
    const fuelEmpty = (() => {
      const ship = getShipState()
      return ship && ship.fuelCurrent < FUEL_EMPTY_THRESHOLD
    })()

    if (isRight) {
      e.preventDefault()
      if (fuelEmpty) {
        emitSim('toast', { textZh: '燃料耗尽 · 需返回补给站' })
        return
      }
      playUi('ui.space.right-navigate')
      const near = findNearbyPoi(lastPoisRef.current, wp.x, wp.y)
      const res = near
        ? navigateTo({ kind: 'poi', poiId: near.id })
        : navigateTo({ kind: 'point', x: wp.x, y: wp.y })
      if (!res.ok && res.message) emitSim('toast', { textZh: res.message })
      setMenu(null)
      return
    }

    // Left-click. Hits a POI ⇒ open context menu; empty space ⇒ close.
    const near = findNearbyPoi(lastPoisRef.current, wp.x, wp.y)
    if (near) {
      playUi('ui.space.left-poi')
      setMenu({ poiId: near.id, screenX: e.clientX, screenY: e.clientY })
    } else {
      playUi('ui.space.left-empty')
      setMenu(null)
    }
  }

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const menuPoi = menu ? poiDataById.get(menu.poiId) ?? null : null
  const onNavigate = () => {
    if (!menu) return
    playUi('ui.space.menu-navigate')
    const res = navigateTo({ kind: 'poi', poiId: menu.poiId })
    if (!res.ok && res.message) emitSim('toast', { textZh: res.message })
    setMenu(null)
  }
  const onDock = () => {
    if (!menu) return
    playUi('ui.space.menu-dock')
    const res = dockAt(menu.poiId)
    if (!res.ok && res.message) emitSim('toast', { textZh: res.message })
    setMenu(null)
  }

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
        onClick={() => { playUi('ui.space.leave-helm'); leaveHelm() }}
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
      {menu && menuPoi && (() => {
        // Clamp the menu inside the viewport so a click near the right/bottom
        // edge doesn't push half the menu off-screen. 180×~92 covers the
        // current item set; refresh if the menu grows.
        const W = 180
        const H = 92
        const left = Math.min(menu.screenX + 6, window.innerWidth - W - 8)
        const top = Math.min(menu.screenY + 6, window.innerHeight - H - 8)
        return (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left, top, width: W,
              background: 'rgba(15, 23, 42, 0.96)', border: '1px solid #475569',
              color: '#e2e8f0', borderRadius: 4,
              fontFamily: 'system-ui, sans-serif', fontSize: 13,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              userSelect: 'none',
            }}
          >
            <div style={{
              padding: '6px 10px', borderBottom: '1px solid #334155',
              color: '#cbd5e1', fontSize: 12, fontWeight: 600,
            }}>
              {menuPoi.nameZh}
            </div>
            <ContextMenuItem label="前往" onClick={onNavigate} />
            <ContextMenuItem label="停泊" onClick={onDock} />
          </div>
        )
      })()}
    </div>
  )
}

function ContextMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        padding: '6px 10px',
        background: hover ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      {label}
    </div>
  )
}
